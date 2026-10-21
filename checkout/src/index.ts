import { Hono } from "hono";
import { CHAINS, INVOICE_TTL_SECONDS, getProduct, type ChainId } from "./config.ts";
import { getInvoice, getLicense, insertInvoice, listInvoices, now, takenAmounts } from "./db.ts";
import { randomId } from "./license.ts";
import { runWatchers, settle, type Env } from "./matcher.ts";
import { allocateAmount, unitsToDisplay, usdToUnits } from "./money.ts";
import { adminPage, buyPage, catalogPage, intakePage, intakesTable, payPage } from "./pages.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.html(catalogPage()));

app.get("/buy/:productId", (c) => {
  const p = getProduct(c.req.param("productId"));
  if (!p) return c.notFound();
  return c.html(buyPage(p));
});

app.post("/api/invoice", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  const data = ct.includes("application/json") ? await c.req.json<Record<string, string>>() : Object.fromEntries((await c.req.formData()).entries()) as Record<string, string>;
  const product = getProduct(String(data.product_id ?? ""));
  const email = String(data.email ?? "").trim().toLowerCase();
  const chain = String(data.chain ?? "") as ChainId;
  const wantsJson = ct.includes("application/json");
  const fail = (msg: string, status = 400) => (wantsJson ? c.json({ error: msg }, status as 400) : product ? c.html(buyPage(product, msg), status as 400) : c.text(msg, status as 400));

  if (!product) return fail("Unknown product");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail("Enter a valid email");
  if (!(chain in CHAINS)) return fail("Choose a payment network");

  const cfg = CHAINS[chain];
  const priceUnits = usdToUnits(product.priceUsd, cfg.decimals);
  let amountUnits: number;
  try {
    amountUnits = allocateAmount(priceUnits, await takenAmounts(c.env.DB, chain), cfg.decimals);
  } catch {
    return fail("Too many open payments right now, try again in a few minutes", 503);
  }
  const id = randomId(10);
  const t = now();
  await insertInvoice(c.env.DB, {
    id,
    product_id: product.id,
    email,
    chain,
    price_units: priceUnits,
    amount_units: amountUnits,
    status: "pending",
    created_at: t,
    expires_at: t + INVOICE_TTL_SECONDS,
  });
  if (wantsJson) {
    return c.json({ id, url: `${c.env.PUBLIC_URL}/pay/${id}`, chain, address: cfg.receiver, amount: unitsToDisplay(amountUnits, cfg.decimals), token: cfg.token, expires_at: t + INVOICE_TTL_SECONDS });
  }
  return c.redirect(`/pay/${id}`, 303);
});

app.get("/pay/:id", async (c) => {
  const inv = await getInvoice(c.env.DB, c.req.param("id"));
  if (!inv) return c.notFound();
  return c.html(payPage(inv, getProduct(inv.product_id), c.env.PUBLIC_URL));
});

app.get("/api/invoice/:id", async (c) => {
  const inv = await getInvoice(c.env.DB, c.req.param("id"));
  if (!inv) return c.json({ error: "not found" }, 404);
  const cfg = CHAINS[inv.chain];
  return c.json({
    id: inv.id,
    status: inv.status,
    chain: inv.chain,
    amount: unitsToDisplay(inv.amount_units, cfg.decimals),
    token: cfg.token,
    address: cfg.receiver,
    expires_at: inv.expires_at,
    paid_at: inv.paid_at,
    tx_hash: inv.tx_hash,
    license_key: inv.status === "paid" ? inv.license_key : null,
  });
});

// Products call this to validate a key. Public, rate-limit at the edge if abused.
app.get("/api/license/verify", async (c) => {
  const key = (c.req.query("key") ?? "").trim().toUpperCase();
  if (!key) return c.json({ valid: false, reason: "missing key" }, 400);
  const lic = await getLicense(c.env.DB, key);
  if (!lic) return c.json({ valid: false, reason: "unknown" });
  if (lic.revoked_at) return c.json({ valid: false, reason: "revoked" });
  if (lic.expires_at && lic.expires_at < now()) return c.json({ valid: false, reason: "expired", expires_at: lic.expires_at });
  return c.json({ valid: true, product_id: lic.product_id, issued_at: lic.issued_at, expires_at: lic.expires_at });
});

app.get("/admin", async (c) => {
  const token = c.req.query("token") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) return c.text("forbidden", 403);
  const report = c.req.query("run") ? await runWatchers(c.env) : null;
  const rows = await listInvoices(c.env.DB);
  const { results: unmatched } = await c.env.DB.prepare(
    "SELECT chain, tx_hash, from_addr, amount_units, memo, seen_at FROM transfers WHERE invoice_id IS NULL ORDER BY seen_at DESC LIMIT 100",
  ).all<{ chain: string; tx_hash: string; from_addr: string | null; amount_units: number; memo: string | null; seen_at: number }>();
  const { results: intakes } = await c.env.DB.prepare("SELECT id, product_id, invoice_id, email, answers, created_at FROM intakes ORDER BY created_at DESC LIMIT 50").all<{ id: number; product_id: string; invoice_id: string | null; email: string; answers: string; created_at: number }>();
  return c.html(adminPage(rows, unmatched, report, c.env.ADMIN_TOKEN).replace("</main>", `<h2>Intake forms</h2>${intakesTable(intakes)}</main>`));
});

// Email capture for launch notices (used by the tax exporter's "notify me" form). CORS open: it is called from Pages.
app.options("/api/subscribe", (c) => c.body(null, 204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST" }));
app.post("/api/subscribe", async (c) => {
  const data = await c.req.json<{ email?: string; source?: string }>().catch(() => ({}) as { email?: string; source?: string });
  const email = String(data.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return c.json({ error: "bad email" }, 400, { "Access-Control-Allow-Origin": "*" });
  await c.env.DB.prepare("INSERT OR IGNORE INTO subscribers (email, source, created_at) VALUES (?, ?, ?)").bind(email, String(data.source ?? "").slice(0, 40), now()).run();
  return c.json({ ok: true }, 200, { "Access-Control-Allow-Origin": "*" });
});

app.get("/admin/subscribers.csv", async (c) => {
  const token = c.req.query("token");
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) return c.text("forbidden", 403);
  const { results } = await c.env.DB.prepare("SELECT email, source, created_at FROM subscribers ORDER BY created_at").all<{ email: string; source: string; created_at: number }>();
  return c.text("email,source,created_at\n" + results.map((r) => `${r.email},${r.source ?? ""},${new Date(r.created_at * 1000).toISOString()}`).join("\n"), 200, { "Content-Type": "text/csv" });
});

app.get("/intake/:productId", (c) => {
  const p = getProduct(c.req.param("productId"));
  if (!p || p.delivery.kind !== "intake") return c.notFound();
  return c.html(intakePage(p, c.req.query("invoice") ?? "", c.req.query("done") === "1"));
});

app.post("/api/intake", async (c) => {
  const form = Object.fromEntries((await c.req.formData()).entries()) as Record<string, string>;
  const p = getProduct(String(form.product_id ?? ""));
  if (!p || p.delivery.kind !== "intake") return c.text("unknown product", 400);
  const email = String(form.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.html(intakePage(p, String(form.invoice_id ?? ""), false, "Enter a valid email"), 400);
  const answers: Record<string, string> = {};
  p.delivery.fields.forEach((q, i) => (answers[q] = String(form[`q${i}`] ?? "").slice(0, 4000)));
  await c.env.DB.prepare("INSERT INTO intakes (product_id, invoice_id, email, answers, created_at) VALUES (?, ?, ?, ?, ?)").bind(p.id, String(form.invoice_id ?? "") || null, email, JSON.stringify(answers), now()).run();
  return c.redirect(`/intake/${p.id}?done=1`, 303);
});

// Admin: settle an invoice without a real transfer. For end-to-end testing of license delivery and emails.
app.post("/admin/simulate", async (c) => {
  const token = c.req.query("token");
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) return c.text("forbidden", 403);
  const inv = await getInvoice(c.env.DB, c.req.query("invoice") ?? "");
  if (!inv) return c.json({ error: "invoice not found" }, 404);
  if (inv.status !== "pending") return c.json({ error: `invoice is ${inv.status}` }, 409);
  await settle(c.env, inv, { chain: inv.chain, txHash: `simulated-${inv.id}-${now()}`, logIndex: 0, from: "admin-simulated", amountUnits: inv.amount_units, memo: inv.id });
  if ((c.req.header("accept") ?? "").includes("text/html")) return c.redirect(`/admin?token=${encodeURIComponent(token!)}`, 303);
  return c.json(await getInvoice(c.env.DB, inv.id));
});

app.get("/health", (c) => c.json({ ok: true, chains: Object.keys(CHAINS) }));

export default {
  fetch: app.fetch,
  // Cron: every minute. Cloudflare invokes this with the schedule; we scan all chains.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runWatchers(env).then((r) => console.log(JSON.stringify(r))),
    );
  },
};
