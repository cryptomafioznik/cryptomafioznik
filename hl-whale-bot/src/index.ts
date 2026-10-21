// Hyperliquid wallet alerts for Telegram. Webhook for commands, cron for position checks, Stars for Pro.
import { diffSnapshots, formatChange, formatPositions, isAddress, parseState, type ClearinghouseState, type Snapshot } from "./positions.ts";
import { send, sendStarsInvoice, tg, type TgEnv, type TgUpdate } from "./telegram.ts";

export interface Env extends TgEnv {
  DB: D1Database;
  WEBHOOK_SECRET: string;
  ADMIN_TOKEN?: string;
  WALLETS_PER_RUN: string;
  FREE_WALLETS: string;
  PRO_WALLETS: string;
  PRO_PRICE_STARS: string;
  PRO_DAYS: string;
  TAX_EXPORT_URL: string;
  CHANNEL: string;
  CHANNEL_MIN_USD: string;
  BOT_USERNAME: string;
}

const LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

interface LeaderboardRow {
  ethAddress: string;
  accountValue: string;
  displayName?: string | null;
  windowPerformances?: Array<[string, { pnl: string; roi: string; vlm: string }]>;
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

/** Resolve CHANNEL ("@name" or id) to a numeric chat id once and cache it. */
async function channelChatId(env: Env): Promise<number | null> {
  if (!env.CHANNEL) return null;
  const cached = await getSetting(env, "channel_chat_id");
  if (cached) return Number(cached);
  const chat = await tg<{ id: number }>(env, "getChat", { chat_id: env.CHANNEL });
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('channel_chat_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(chat.id)).run();
  return chat.id;
}

/**
 * Growth engine: follow the top leaderboard wallets on behalf of the public channel, so every big move
 * is posted there with a "follow any wallet" footer. Called by /seed (admin) and re-run weekly by the cron.
 */
export async function seedChannel(env: Env, n = 40): Promise<{ channel: number | null; added: number }> {
  const chatId = await channelChatId(env);
  if (!chatId) return { channel: null, added: 0 };
  const res = await fetch(LEADERBOARD);
  if (!res.ok) throw new Error(`leaderboard http ${res.status}`);
  const json = (await res.json()) as { leaderboardRows?: LeaderboardRow[] };
  const rows = (json.leaderboardRows ?? [])
    .map((r) => {
      const month = r.windowPerformances?.find(([w]) => w === "month")?.[1];
      return { wallet: r.ethAddress.toLowerCase(), label: (r.displayName || "").slice(0, 24), accountValue: Number(r.accountValue), monthPnl: Number(month?.pnl ?? 0), vlm: Number(month?.vlm ?? 0) };
    })
    .filter((r) => r.accountValue >= 1_000_000 && r.vlm > 0)
    .sort((a, b) => b.monthPnl - a.monthPnl)
    .slice(0, n);
  await env.DB.prepare(
    "INSERT INTO users (chat_id, username, threshold_usd, created_at, last_seen) VALUES (?, 'channel', ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET threshold_usd = excluded.threshold_usd",
  )
    .bind(chatId, Number(env.CHANNEL_MIN_USD), now(), now())
    .run();
  let added = 0;
  for (const r of rows) {
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO follows (chat_id, wallet, label, created_at) VALUES (?, ?, ?, ?)").bind(chatId, r.wallet, r.label || null, now()).run();
    if ((ins.meta.changes ?? 0) > 0) added++;
    await env.DB.prepare("INSERT OR IGNORE INTO wallets (wallet, last_checked) VALUES (?, 0)").bind(r.wallet).run();
  }
  return { channel: chatId, added };
}

const HL = "https://api.hyperliquid.xyz/info";
const now = () => Math.floor(Date.now() / 1000);

interface User {
  chat_id: number;
  username: string | null;
  pro_until: number | null;
  threshold_usd: number;
}

async function getUser(env: Env, chatId: number, username?: string): Promise<User> {
  await env.DB.prepare(
    "INSERT INTO users (chat_id, username, created_at, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET last_seen = excluded.last_seen, username = COALESCE(excluded.username, users.username)",
  )
    .bind(chatId, username ?? null, now(), now())
    .run();
  return (await env.DB.prepare("SELECT chat_id, username, pro_until, threshold_usd FROM users WHERE chat_id = ?").bind(chatId).first<User>())!;
}

const isPro = (u: User) => Boolean(u.pro_until && u.pro_until > now());

const HELP = (env: Env) =>
  [
    "I watch Hyperliquid wallets and tell you when their positions change.",
    "",
    "/follow 0x… [name]   follow a wallet",
    "/unfollow 0x…        stop following",
    "/list                your wallets and their open positions",
    "/positions 0x…       open positions of any wallet",
    "/threshold 50000     only alert on changes above $50,000",
    "/pro                 Pro: up to " + env.PRO_WALLETS + " wallets for " + env.PRO_PRICE_STARS + " Stars / " + env.PRO_DAYS + " days",
    "",
    `Free: ${env.FREE_WALLETS} wallets. Checks run about every minute.`,
    `Tax season? Export your own Hyperliquid trades for Koinly: ${env.TAX_EXPORT_URL}`,
  ].join("\n");

async function fetchState(wallet: string): Promise<ClearinghouseState> {
  const res = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "clearinghouseState", user: wallet }) });
  if (!res.ok) throw new Error(`hyperliquid http ${res.status}`);
  return (await res.json()) as ClearinghouseState;
}

async function handleCommand(env: Env, chatId: number, text: string, username?: string): Promise<void> {
  const user = await getUser(env, chatId, username);
  const [cmdRaw, ...args] = text.trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, "");

  switch (cmd) {
    case "/start":
    case "/help":
      return send(env, chatId, HELP(env));

    case "/follow": {
      const wallet = (args[0] ?? "").toLowerCase();
      if (!isAddress(wallet)) return send(env, chatId, "Usage: /follow 0x… [name]");
      const label = args.slice(1).join(" ").slice(0, 32) || null;
      const limit = Number(isPro(user) ? env.PRO_WALLETS : env.FREE_WALLETS);
      const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM follows WHERE chat_id = ?").bind(chatId).first<{ n: number }>())!.n;
      const exists = await env.DB.prepare("SELECT 1 FROM follows WHERE chat_id = ? AND wallet = ?").bind(chatId, wallet).first();
      if (!exists && count >= limit) return send(env, chatId, `You follow ${count} wallets, the ${isPro(user) ? "Pro" : "free"} limit. ${isPro(user) ? "" : "/pro raises it to " + env.PRO_WALLETS + "."}`);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO follows (chat_id, wallet, label, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, wallet) DO UPDATE SET label = COALESCE(excluded.label, follows.label)").bind(chatId, wallet, label, now()),
        env.DB.prepare("INSERT OR IGNORE INTO wallets (wallet, last_checked) VALUES (?, 0)").bind(wallet),
      ]);
      // Show current positions right away and seed the snapshot so the first cron run does not alert on everything.
      try {
        const snap = parseState(await fetchState(wallet));
        await env.DB.prepare("UPDATE wallets SET snapshot = COALESCE(snapshot, ?), last_checked = CASE WHEN snapshot IS NULL THEN ? ELSE last_checked END WHERE wallet = ?").bind(JSON.stringify(snap), now(), wallet).run();
        return send(env, chatId, `Following. ${formatPositions(label ?? "", wallet, snap)}`);
      } catch (e) {
        return send(env, chatId, `Following ${wallet}. Could not read positions right now (${(e as Error).message}); alerts start with the next check.`);
      }
    }

    case "/unfollow": {
      const wallet = (args[0] ?? "").toLowerCase();
      if (!isAddress(wallet)) return send(env, chatId, "Usage: /unfollow 0x…");
      const r = await env.DB.prepare("DELETE FROM follows WHERE chat_id = ? AND wallet = ?").bind(chatId, wallet).run();
      return send(env, chatId, (r.meta.changes ?? 0) > 0 ? "Unfollowed." : "You were not following that wallet.");
    }

    case "/list": {
      const { results } = await env.DB.prepare("SELECT f.wallet, f.label, w.snapshot FROM follows f LEFT JOIN wallets w ON w.wallet = f.wallet WHERE f.chat_id = ? ORDER BY f.created_at").bind(chatId).all<{ wallet: string; label: string | null; snapshot: string | null }>();
      if (results.length === 0) return send(env, chatId, "You follow no wallets yet. /follow 0x… [name]");
      const blocks = results.map((r) => formatPositions(r.label ?? "", r.wallet, r.snapshot ? (JSON.parse(r.snapshot) as Snapshot) : {}));
      return send(env, chatId, `${isPro(user) ? "Pro until " + new Date(user.pro_until! * 1000).toISOString().slice(0, 10) + "\n\n" : ""}${blocks.join("\n\n")}`);
    }

    case "/positions": {
      const wallet = (args[0] ?? "").toLowerCase();
      if (!isAddress(wallet)) return send(env, chatId, "Usage: /positions 0x…");
      try {
        return send(env, chatId, formatPositions("", wallet, parseState(await fetchState(wallet))));
      } catch (e) {
        return send(env, chatId, `Could not read positions: ${(e as Error).message}`);
      }
    }

    case "/threshold": {
      const v = Math.max(0, Math.floor(Number(args[0] ?? "0")));
      if (!Number.isFinite(v)) return send(env, chatId, "Usage: /threshold 50000");
      await env.DB.prepare("UPDATE users SET threshold_usd = ? WHERE chat_id = ?").bind(v, chatId).run();
      return send(env, chatId, v ? `Alerting only on changes above $${v.toLocaleString("en-US")}.` : "Alerting on every change.");
    }

    case "/pro": {
      if (isPro(user)) return send(env, chatId, `You are Pro until ${new Date(user.pro_until! * 1000).toISOString().slice(0, 10)}. Paying again extends it.`);
      await sendStarsInvoice(env, chatId, `Pro, ${env.PRO_DAYS} days`, `Follow up to ${env.PRO_WALLETS} wallets. Alerts every minute.`, `pro:${chatId}`, Number(env.PRO_PRICE_STARS));
      return;
    }

    default:
      return send(env, chatId, HELP(env));
  }
}

async function handleUpdate(env: Env, u: TgUpdate): Promise<void> {
  if (u.pre_checkout_query) {
    await tg(env, "answerPreCheckoutQuery", { pre_checkout_query_id: u.pre_checkout_query.id, ok: true });
    return;
  }
  const m = u.message;
  if (!m || m.chat.type !== "private") return;
  if (m.successful_payment) {
    const p = m.successful_payment;
    const user = await getUser(env, m.chat.id, m.from?.username);
    const base = Math.max(now(), user.pro_until ?? 0);
    const until = base + Number(env.PRO_DAYS) * 86400;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO payments (charge_id, chat_id, stars, paid_at) VALUES (?, ?, ?, ?)").bind(p.telegram_payment_charge_id, m.chat.id, p.total_amount, now()),
      env.DB.prepare("UPDATE users SET pro_until = ? WHERE chat_id = ?").bind(until, m.chat.id),
    ]);
    await send(env, m.chat.id, `Thank you. Pro is active until ${new Date(until * 1000).toISOString().slice(0, 10)}. Follow up to ${env.PRO_WALLETS} wallets.`);
    return;
  }
  if (m.text) await handleCommand(env, m.chat.id, m.text, m.from?.username);
}

/** Cron: check the least recently checked wallets, alert followers on changes. */
export async function checkWallets(env: Env): Promise<{ checked: number; alerts: number; errors: number }> {
  const perRun = Number(env.WALLETS_PER_RUN);
  const { results: wallets } = await env.DB.prepare(
    "SELECT w.wallet, w.snapshot FROM wallets w WHERE EXISTS (SELECT 1 FROM follows f WHERE f.wallet = w.wallet) ORDER BY w.last_checked ASC LIMIT ?",
  )
    .bind(perRun)
    .all<{ wallet: string; snapshot: string | null }>();
  let alerts = 0,
    errors = 0;
  for (const w of wallets) {
    try {
      const after = parseState(await fetchState(w.wallet));
      const before: Snapshot | null = w.snapshot ? (JSON.parse(w.snapshot) as Snapshot) : null;
      await env.DB.prepare("UPDATE wallets SET snapshot = ?, last_checked = ?, error = NULL WHERE wallet = ?").bind(JSON.stringify(after), now(), w.wallet).run();
      if (!before) continue; // first observation seeds the snapshot
      const changes = diffSnapshots(before, after);
      if (changes.length === 0) continue;
      const { results: followers } = await env.DB.prepare(
        "SELECT f.chat_id, f.label, u.threshold_usd FROM follows f JOIN users u ON u.chat_id = f.chat_id WHERE f.wallet = ?",
      )
        .bind(w.wallet)
        .all<{ chat_id: number; label: string | null; threshold_usd: number }>();
      const channelId = await channelChatId(env).catch(() => null);
      for (const fo of followers) {
        const relevant = changes.filter((c) => c.deltaUsd >= fo.threshold_usd);
        if (relevant.length === 0) continue;
        let text = relevant.map((c) => formatChange(fo.label ?? "", w.wallet, c)).join("\n\n");
        if (channelId !== null && fo.chat_id === channelId) {
          text += `\n\nhypurrscan.io/address/${w.wallet}` + (env.BOT_USERNAME ? `\nFollow any wallet: @${env.BOT_USERNAME}` : "");
        }
        await send(env, fo.chat_id, text);
        await env.DB.prepare("INSERT INTO alerts_log (chat_id, wallet, text, sent_at) VALUES (?, ?, ?, ?)").bind(fo.chat_id, w.wallet, text.slice(0, 500), now()).run();
        alerts++;
      }
    } catch (e) {
      errors++;
      await env.DB.prepare("UPDATE wallets SET last_checked = ?, error = ? WHERE wallet = ?").bind(now(), (e as Error).message.slice(0, 200), w.wallet).run();
    }
  }
  return { checked: wallets.length, alerts, errors };
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/tg") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const update = (await req.json()) as TgUpdate;
      ctx.waitUntil(handleUpdate(env, update).catch((e) => console.log(`update failed: ${(e as Error).message}`)));
      return new Response("ok");
    }
    if (url.pathname === "/setup") {
      // One-time: registers the webhook with Telegram. GET /setup?token=<ADMIN_TOKEN>
      if (!env.ADMIN_TOKEN || url.searchParams.get("token") !== env.ADMIN_TOKEN) return new Response("forbidden", { status: 403 });
      const r = await tg(env, "setWebhook", { url: `${url.origin}/tg`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "pre_checkout_query"] });
      await tg(env, "setMyCommands", {
        commands: [
          { command: "follow", description: "Follow a wallet: /follow 0x… [name]" },
          { command: "unfollow", description: "Stop following a wallet" },
          { command: "list", description: "Your wallets and their positions" },
          { command: "positions", description: "Positions of any wallet" },
          { command: "threshold", description: "Minimum change in USD to alert on" },
          { command: "pro", description: "Upgrade with Telegram Stars" },
          { command: "help", description: "Commands" },
        ],
      });
      return Response.json({ webhook: r });
    }
    if (url.pathname === "/seed") {
      if (!env.ADMIN_TOKEN || url.searchParams.get("token") !== env.ADMIN_TOKEN) return new Response("forbidden", { status: 403 });
      try {
        return Response.json(await seedChannel(env, Number(url.searchParams.get("n") ?? "40")));
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 });
      }
    }
    if (url.pathname === "/stats" && env.ADMIN_TOKEN && url.searchParams.get("token") === env.ADMIN_TOKEN) {
      const users = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN pro_until > ? THEN 1 ELSE 0 END) AS pro FROM users").bind(now()).first();
      const follows = await env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT wallet) AS wallets FROM follows").first();
      const stars = await env.DB.prepare("SELECT COALESCE(SUM(stars),0) AS stars FROM payments").first();
      return Response.json({ users, follows, stars });
    }
    if (url.pathname === "/health") return Response.json({ ok: true });
    return new Response("hl-whale-bot", { status: 200 });
  },
  async scheduled(e: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Once a week (Monday 00:00 UTC run) refresh the channel's leaderboard wallets; every run check positions.
    const d = new Date(e.scheduledTime);
    const weekly = env.CHANNEL && d.getUTCDay() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
    ctx.waitUntil(
      (weekly ? seedChannel(env).catch((err) => console.log(`seed failed: ${(err as Error).message}`)) : Promise.resolve()).then(() =>
        checkWallets(env).then((r) => console.log(JSON.stringify(r))),
      ),
    );
  },
};
