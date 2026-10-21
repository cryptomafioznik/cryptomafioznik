// Polymarket public data API. Trades per proxy wallet; redemptions/payouts are on-chain and not included here (see README).
import type { PmTrade, TaxEvent } from "./types.ts";

const API = "https://data-api.polymarket.com";
const PAGE = 500;

export async function fetchPolymarketTrades(user: string, startMs: number, endMs: number, apiUrl = API): Promise<PmTrade[]> {
  const out: PmTrade[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const url = `${apiUrl}/trades?user=${user}&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`polymarket trades http ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as PmTrade[];
    if (!Array.isArray(page) || page.length === 0) break;
    for (const t of page) {
      const k = `${t.transactionHash ?? ""}|${t.asset}|${t.timestamp}|${t.side}|${t.size}|${t.price}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    if (page.length < PAGE) break;
  }
  return out.filter((t) => t.timestamp * 1000 >= startMs && t.timestamp * 1000 <= endMs).sort((a, b) => a.timestamp - b.timestamp);
}

export function polymarketToEvents(trades: PmTrade[]): TaxEvent[] {
  return trades.map((t) => {
    const name = `${t.title ?? t.conditionId.slice(0, 10)}/${t.outcome ?? t.asset.slice(0, 8)}`;
    return {
      venue: "polymarket",
      kind: t.side === "BUY" ? "pm_buy" : "pm_sell",
      timeMs: t.timestamp * 1000,
      asset: name,
      size: Math.abs(t.size),
      price: t.price,
      pnlUsdc: 0,
      feeUsdc: 0, // Polymarket CLOB charges no taker/maker fee on most markets as of 2026; fee markets are rare and not in the API response
      feeToken: "USDC",
      amountUsdc: 0,
      hash: t.transactionHash ?? "",
      note: `${t.side} ${t.size} shares @ ${t.price} ${name}`,
    };
  });
}
