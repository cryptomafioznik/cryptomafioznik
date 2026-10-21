// Human-readable summaries: per-asset realized PnL, fees, funding, cash flows. This is the reconciliation
// report an accountant reads before trusting the CSV.
import type { TaxEvent } from "./types.ts";

export interface AssetSummary {
  asset: string;
  closes: number;
  realizedPnlUsdc: number;
  feesUsdc: number;
  fundingUsdc: number;
  netUsdc: number;
}

export interface Summary {
  from: string;
  to: string;
  events: number;
  perps: AssetSummary[];
  spotTrades: number;
  polymarketTrades: number;
  totals: { realizedPnlUsdc: number; feesUsdc: number; fundingUsdc: number; depositsUsdc: number; withdrawalsUsdc: number; netTradingUsdc: number };
  hourlyFundingRows: number;
}

const r2 = (x: number) => Math.round(x * 1e6) / 1e6; // six decimals: exact for USDC, text output rounds to cents

export function summarize(events: TaxEvent[], fromMs: number, toMs: number): Summary {
  const perps = new Map<string, AssetSummary>();
  const get = (a: string) => {
    let s = perps.get(a);
    if (!s) perps.set(a, (s = { asset: a, closes: 0, realizedPnlUsdc: 0, feesUsdc: 0, fundingUsdc: 0, netUsdc: 0 }));
    return s;
  };
  let spot = 0,
    pm = 0,
    deposits = 0,
    withdrawals = 0,
    fundingRows = 0;
  for (const e of events) {
    switch (e.kind) {
      case "perp_open":
        get(e.asset).feesUsdc += e.feeUsdc;
        break;
      case "perp_close": {
        const s = get(e.asset);
        s.closes++;
        s.realizedPnlUsdc += e.pnlUsdc;
        s.feesUsdc += e.feeUsdc;
        break;
      }
      case "funding":
        get(e.asset).fundingUsdc += e.amountUsdc;
        fundingRows++;
        break;
      case "spot_buy":
      case "spot_sell":
        spot++;
        break;
      case "pm_buy":
      case "pm_sell":
        pm++;
        break;
      case "deposit":
        deposits += e.amountUsdc;
        break;
      case "withdraw":
        withdrawals += -e.amountUsdc;
        break;
    }
  }
  const list = [...perps.values()].map((s) => ({ ...s, realizedPnlUsdc: r2(s.realizedPnlUsdc), feesUsdc: r2(s.feesUsdc), fundingUsdc: r2(s.fundingUsdc), netUsdc: r2(s.realizedPnlUsdc - s.feesUsdc + s.fundingUsdc) }));
  list.sort((a, b) => Math.abs(b.netUsdc) - Math.abs(a.netUsdc));
  const tot = list.reduce(
    (t, s) => ({ pnl: t.pnl + s.realizedPnlUsdc, fees: t.fees + s.feesUsdc, funding: t.funding + s.fundingUsdc }),
    { pnl: 0, fees: 0, funding: 0 },
  );
  return {
    from: new Date(fromMs).toISOString().slice(0, 10),
    to: new Date(toMs).toISOString().slice(0, 10),
    events: events.length,
    perps: list,
    spotTrades: spot,
    polymarketTrades: pm,
    totals: { realizedPnlUsdc: r2(tot.pnl), feesUsdc: r2(tot.fees), fundingUsdc: r2(tot.funding), depositsUsdc: r2(deposits), withdrawalsUsdc: r2(withdrawals), netTradingUsdc: r2(tot.pnl - tot.fees + tot.funding) },
    hourlyFundingRows: fundingRows,
  };
}

export function renderSummaryText(s: Summary): string {
  const lines = [
    `Period ${s.from} .. ${s.to}   events: ${s.events}`,
    ``,
    `Perpetuals (USDC)`,
    `  asset        closes   realized PnL        fees      funding          net`,
  ];
  for (const p of s.perps) {
    lines.push(`  ${p.asset.padEnd(12)} ${String(p.closes).padStart(6)} ${p.realizedPnlUsdc.toFixed(2).padStart(14)} ${p.feesUsdc.toFixed(2).padStart(11)} ${p.fundingUsdc.toFixed(2).padStart(12)} ${p.netUsdc.toFixed(2).padStart(12)}`);
  }
  const t = s.totals;
  lines.push(
    `  ${"TOTAL".padEnd(12)} ${"".padStart(6)} ${t.realizedPnlUsdc.toFixed(2).padStart(14)} ${t.feesUsdc.toFixed(2).padStart(11)} ${t.fundingUsdc.toFixed(2).padStart(12)} ${t.netTradingUsdc.toFixed(2).padStart(12)}`,
    ``,
    `Spot trades: ${s.spotTrades}    Polymarket trades: ${s.polymarketTrades}`,
    `Deposits: ${t.depositsUsdc.toFixed(2)} USDC    Withdrawals: ${t.withdrawalsUsdc.toFixed(2)} USDC`,
    `Hourly funding payments: ${s.hourlyFundingRows} (grouped per day per asset in the Koinly file)`,
  );
  return lines.join("\n");
}
