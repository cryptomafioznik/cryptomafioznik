// Hyperliquid info API client with time-window pagination and polite rate limiting.
import type { HlFill, HlFundingEntry, HlLedgerEntry, HlSpotMeta, TaxEvent } from "./types.ts";

const API = "https://api.hyperliquid.xyz/info";
const PAGE_FILLS = 2000; // server cap for userFillsByTime
const PAGE_SMALL = 500; // server cap for userFunding / ledger updates

export interface Fetcher {
  (body: Record<string, unknown>): Promise<unknown>;
}

export function makeFetcher(apiUrl: string | undefined = API, minIntervalMs = 250): Fetcher {
  apiUrl = apiUrl ?? API;
  let last = 0;
  return async (body) => {
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`hyperliquid ${body.type} http ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    }
    throw new Error(`hyperliquid ${body.type}: gave up after retries`);
  };
}

/** Page through a time-windowed endpoint. Entries must carry `time` (ms) and a unique id derived by `key`. */
async function paginate<T extends { time: number }>(
  fetcher: Fetcher,
  body: Record<string, unknown>,
  startMs: number,
  endMs: number,
  pageSize: number,
  key: (t: T) => string,
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let cursor = startMs;
  for (let guard = 0; guard < 10_000; guard++) {
    const page = (await fetcher({ ...body, startTime: cursor, endTime: endMs })) as T[];
    if (!Array.isArray(page) || page.length === 0) break;
    let added = 0;
    for (const e of page) {
      const k = key(e);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
      added++;
    }
    const maxTime = page.reduce((m, e) => Math.max(m, e.time), 0);
    if (page.length < pageSize) break;
    // Same-millisecond entries can straddle a page boundary, so restart at maxTime (not +1) and rely on dedupe.
    if (maxTime <= cursor && added === 0) break;
    cursor = maxTime;
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export async function fetchFills(f: Fetcher, user: string, startMs: number, endMs: number): Promise<HlFill[]> {
  return paginate<HlFill>(f, { type: "userFillsByTime", user, aggregateByTime: false }, startMs, endMs, PAGE_FILLS, (x) => String(x.tid));
}

export async function fetchFunding(f: Fetcher, user: string, startMs: number, endMs: number): Promise<HlFundingEntry[]> {
  return paginate<HlFundingEntry>(f, { type: "userFunding", user }, startMs, endMs, PAGE_SMALL, (x) => `${x.time}|${x.delta.coin}|${x.hash}`);
}

export async function fetchLedger(f: Fetcher, user: string, startMs: number, endMs: number): Promise<HlLedgerEntry[]> {
  return paginate<HlLedgerEntry>(f, { type: "userNonFundingLedgerUpdates", user }, startMs, endMs, PAGE_SMALL, (x) => `${x.time}|${x.hash}|${x.delta.type}`);
}

export async function fetchSpotMeta(f: Fetcher): Promise<HlSpotMeta> {
  return (await f({ type: "spotMeta" })) as HlSpotMeta;
}

/** "@142" -> "HYPE/USDC" using spotMeta; pairs already named pass through. */
export function spotPairNames(meta: HlSpotMeta): Map<string, { base: string; quote: string }> {
  const tokenName = new Map(meta.tokens.map((t) => [t.index, t.name]));
  const m = new Map<string, { base: string; quote: string }>();
  for (const u of meta.universe) {
    const base = tokenName.get(u.tokens[0]) ?? `token${u.tokens[0]}`;
    const quote = tokenName.get(u.tokens[1]) ?? `token${u.tokens[1]}`;
    m.set(`@${u.index}`, { base, quote });
    m.set(u.name, { base, quote });
  }
  return m;
}

export function isSpotCoin(coin: string): boolean {
  return coin.includes("/") || coin.startsWith("@");
}

const n = (s: string | number | undefined | null): number => (s === undefined || s === null || s === "" ? 0 : Number(s));

export function fillsToEvents(fills: HlFill[], pairs: Map<string, { base: string; quote: string }>): TaxEvent[] {
  const events: TaxEvent[] = [];
  for (const fl of fills) {
    const size = Math.abs(n(fl.sz));
    const price = n(fl.px);
    const fee = n(fl.fee) + n(fl.builderFee);
    if (isSpotCoin(fl.coin)) {
      const pair = pairs.get(fl.coin) ?? { base: fl.coin.split("/")[0] ?? fl.coin, quote: "USDC" };
      events.push({
        venue: "hyperliquid",
        kind: fl.side === "B" ? "spot_buy" : "spot_sell",
        timeMs: fl.time,
        asset: pair.base,
        size,
        price,
        pnlUsdc: 0,
        feeUsdc: fl.feeToken === "USDC" ? fee : fee * price, // fee charged in base token: value it at fill price
        feeToken: fl.feeToken,
        amountUsdc: 0,
        hash: fl.hash,
        note: `spot ${fl.side === "B" ? "buy" : "sell"} ${pair.base}/${pair.quote} @ ${fl.px}`,
      });
      continue;
    }
    const pnl = n(fl.closedPnl);
    const isClose = /close|>/i.test(fl.dir) || pnl !== 0; // "Close Long", "Long > Short" (flip) both realize PnL
    events.push({
      venue: "hyperliquid",
      kind: isClose ? "perp_close" : "perp_open",
      timeMs: fl.time,
      asset: fl.coin,
      size,
      price,
      pnlUsdc: pnl,
      feeUsdc: fee,
      feeToken: fl.feeToken,
      amountUsdc: 0,
      hash: fl.hash,
      note: `${fl.dir} ${fl.coin} ${fl.sz} @ ${fl.px}`,
    });
  }
  return events;
}

export function fundingToEvents(entries: HlFundingEntry[]): TaxEvent[] {
  return entries.map((e) => ({
    venue: "hyperliquid",
    kind: "funding",
    timeMs: e.time,
    asset: e.delta.coin,
    size: Math.abs(n(e.delta.szi)),
    price: 0,
    pnlUsdc: 0,
    feeUsdc: 0,
    feeToken: "USDC",
    amountUsdc: n(e.delta.usdc),
    hash: e.hash,
    note: `funding ${e.delta.coin} rate ${e.delta.fundingRate} position ${e.delta.szi}`,
  }));
}

export function ledgerToEvents(entries: HlLedgerEntry[]): TaxEvent[] {
  const out: TaxEvent[] = [];
  for (const e of entries) {
    const d = e.delta as Record<string, unknown> & { type: string };
    const base = { venue: "hyperliquid" as const, timeMs: e.time, asset: "USDC", size: 0, price: 1, pnlUsdc: 0, feeToken: "USDC", hash: e.hash };
    switch (d.type) {
      case "deposit":
        out.push({ ...base, kind: "deposit", amountUsdc: n(d.usdc as string), feeUsdc: 0, note: "deposit to Hyperliquid" });
        break;
      case "withdraw":
        out.push({ ...base, kind: "withdraw", amountUsdc: -n(d.usdc as string), feeUsdc: n(d.fee as string), note: "withdraw from Hyperliquid" });
        break;
      case "internalTransfer":
      case "subAccountTransfer": {
        const amt = n(d.usdc as string);
        out.push({ ...base, kind: amt >= 0 ? "transfer_in" : "transfer_out", amountUsdc: amt, feeUsdc: n(d.fee as string), note: `${d.type} ${d.user} -> ${d.destination}` });
        break;
      }
      case "spotTransfer": {
        const amt = n(d.amount as string);
        out.push({ ...base, kind: amt >= 0 ? "transfer_in" : "transfer_out", asset: String(d.token), size: Math.abs(amt), price: amt ? n(d.usdcValue as string) / Math.abs(amt) : 0, amountUsdc: n(d.usdcValue as string) * Math.sign(amt || 1), feeUsdc: n(d.fee as string), note: `spot transfer ${d.token}` });
        break;
      }
      case "liquidation":
        out.push({ ...base, kind: "liquidation", amountUsdc: 0, feeUsdc: 0, note: `liquidation ${JSON.stringify(d.liquidatedPositions ?? [])}` });
        break;
      case "accountClassTransfer":
      case "vaultDeposit":
      case "vaultWithdraw":
      case "vaultCreate":
        // Movements between your own perp/spot/vault balances are not taxable events; kept in the raw export only.
        out.push({ ...base, kind: (n(d.usdc as string) >= 0 ? "transfer_in" : "transfer_out"), amountUsdc: n(d.usdc as string), feeUsdc: 0, note: `${d.type} (internal, not taxable)` });
        break;
      default:
        out.push({ ...base, kind: "transfer_in", amountUsdc: 0, feeUsdc: 0, note: `unknown ledger type ${d.type}: ${JSON.stringify(d).slice(0, 200)}` });
    }
  }
  return out;
}

export interface HlExport {
  fills: HlFill[];
  funding: HlFundingEntry[];
  ledger: HlLedgerEntry[];
  events: TaxEvent[];
}

export async function exportHyperliquid(f: Fetcher, user: string, startMs: number, endMs: number, log: (s: string) => void = () => {}): Promise<HlExport> {
  log("fetching spot metadata");
  const pairs = spotPairNames(await fetchSpotMeta(f));
  log("fetching fills");
  const fills = await fetchFills(f, user, startMs, endMs);
  log(`  ${fills.length} fills`);
  log("fetching funding payments");
  const funding = await fetchFunding(f, user, startMs, endMs);
  log(`  ${funding.length} funding entries`);
  log("fetching deposits, withdrawals and transfers");
  const ledger = await fetchLedger(f, user, startMs, endMs);
  log(`  ${ledger.length} ledger entries`);
  const events = [...fillsToEvents(fills, pairs), ...fundingToEvents(funding), ...ledgerToEvents(ledger)].sort((a, b) => a.timeMs - b.timeMs);
  return { fills, funding, ledger, events };
}
