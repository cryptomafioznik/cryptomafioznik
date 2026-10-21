// Koinly universal CSV (https://help.koinly.io/en/articles/3662999-how-to-create-a-custom-csv-file-with-your-data)
// Columns: Date, Sent Amount, Sent Currency, Received Amount, Received Currency, Fee Amount, Fee Currency,
//          Net Worth Amount, Net Worth Currency, Label, Description, TxHash
//
// Mapping choices (documented in README, override with options):
//  - perp close with PnL>0  -> Received USDC, label "realized gain"
//  - perp close with PnL<0  -> Sent USDC, label "realized gain" (Koinly treats negative realized gain rows as losses)
//  - fees on fills          -> Sent USDC, label "cost"  (unless --fees=inline, which attaches them to the PnL row)
//  - funding received       -> Received USDC, label "realized gain"  (option: "income")
//  - funding paid           -> Sent USDC, label "realized gain"      (option: "cost")
//  - deposits / withdrawals -> plain transfer rows, no label; Koinly matches them to the other side
//  - spot fills             -> Sent/Received pairs (real swaps)
//  - Polymarket trades      -> Sent USDC / Received outcome token (and reverse). Outcome token named "PM:<market>/<outcome>"
import type { TaxEvent } from "./types.ts";

export interface KoinlyOptions {
  fundingLabel: "realized gain" | "income/cost";
  fees: "separate" | "inline";
  groupFundingByDay: boolean; // 8760 hourly rows per position per year otherwise
}

export const DEFAULT_KOINLY: KoinlyOptions = { fundingLabel: "realized gain", fees: "separate", groupFundingByDay: true };

export interface KoinlyRow {
  Date: string;
  "Sent Amount": string;
  "Sent Currency": string;
  "Received Amount": string;
  "Received Currency": string;
  "Fee Amount": string;
  "Fee Currency": string;
  "Net Worth Amount": string;
  "Net Worth Currency": string;
  Label: string;
  Description: string;
  TxHash: string;
}

export const KOINLY_COLUMNS: Array<keyof KoinlyRow> = [
  "Date",
  "Sent Amount",
  "Sent Currency",
  "Received Amount",
  "Received Currency",
  "Fee Amount",
  "Fee Currency",
  "Net Worth Amount",
  "Net Worth Currency",
  "Label",
  "Description",
  "TxHash",
];

export function koinlyDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

const fmt = (x: number, dp = 8): string => {
  if (!Number.isFinite(x)) return "0";
  const s = Math.abs(x).toFixed(dp).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
};

function row(p: Partial<KoinlyRow> & { Date: string }): KoinlyRow {
  return {
    Date: p.Date,
    "Sent Amount": p["Sent Amount"] ?? "",
    "Sent Currency": p["Sent Currency"] ?? "",
    "Received Amount": p["Received Amount"] ?? "",
    "Received Currency": p["Received Currency"] ?? "",
    "Fee Amount": p["Fee Amount"] ?? "",
    "Fee Currency": p["Fee Currency"] ?? "",
    "Net Worth Amount": p["Net Worth Amount"] ?? "",
    "Net Worth Currency": p["Net Worth Currency"] ?? "",
    Label: p.Label ?? "",
    Description: p.Description ?? "",
    TxHash: p.TxHash ?? "",
  };
}

export function pmTokenName(asset: string): string {
  return "PM:" + asset.replace(/[^A-Za-z0-9/?.-]+/g, "_").replace(/_*\/_*/g, "/").slice(0, 60);
}

export function toKoinlyRows(events: TaxEvent[], opts: KoinlyOptions = DEFAULT_KOINLY): KoinlyRow[] {
  const rows: KoinlyRow[] = [];
  const fundingByDay = new Map<string, { usdc: number; count: number; coin: string; timeMs: number }>();

  for (const e of events) {
    const Date_ = koinlyDate(e.timeMs);
    switch (e.kind) {
      case "perp_open":
      case "perp_close": {
        const hasPnl = e.pnlUsdc !== 0;
        if (hasPnl) {
          const r = row({
            Date: Date_,
            ...(e.pnlUsdc > 0 ? { "Received Amount": fmt(e.pnlUsdc), "Received Currency": "USDC" } : { "Sent Amount": fmt(e.pnlUsdc), "Sent Currency": "USDC" }),
            Label: "realized gain",
            Description: `Hyperliquid ${e.note}`,
            TxHash: e.hash,
          });
          if (opts.fees === "inline" && e.feeUsdc > 0) {
            r["Fee Amount"] = fmt(e.feeUsdc);
            r["Fee Currency"] = "USDC";
          }
          rows.push(r);
        }
        if (e.feeUsdc > 0 && (opts.fees === "separate" || !hasPnl)) {
          rows.push(
            row({
              Date: Date_,
              "Sent Amount": fmt(e.feeUsdc),
              "Sent Currency": "USDC",
              Label: "cost",
              Description: `Hyperliquid trading fee: ${e.note}`,
              TxHash: e.hash,
            }),
          );
        }
        break;
      }
      case "spot_buy":
      case "spot_sell": {
        const quoteAmt = e.size * e.price;
        rows.push(
          row({
            Date: Date_,
            ...(e.kind === "spot_buy"
              ? { "Sent Amount": fmt(quoteAmt), "Sent Currency": "USDC", "Received Amount": fmt(e.size), "Received Currency": e.asset }
              : { "Sent Amount": fmt(e.size), "Sent Currency": e.asset, "Received Amount": fmt(quoteAmt), "Received Currency": "USDC" }),
            ...(e.feeUsdc > 0 ? { "Fee Amount": fmt(e.feeUsdc), "Fee Currency": "USDC" } : {}),
            Description: `Hyperliquid ${e.note}`,
            TxHash: e.hash,
          }),
        );
        break;
      }
      case "funding": {
        if (opts.groupFundingByDay) {
          const day = new Date(e.timeMs).toISOString().slice(0, 10);
          const k = `${day}|${e.asset}`;
          const cur = fundingByDay.get(k) ?? { usdc: 0, count: 0, coin: e.asset, timeMs: Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 23, 59, 59) };
          cur.usdc += e.amountUsdc;
          cur.count++;
          fundingByDay.set(k, cur);
        } else {
          rows.push(fundingRow(e.timeMs, e.amountUsdc, `Hyperliquid ${e.note}`, e.hash, opts));
        }
        break;
      }
      case "deposit":
        rows.push(row({ Date: Date_, "Received Amount": fmt(e.amountUsdc), "Received Currency": "USDC", Description: `Hyperliquid ${e.note}`, TxHash: e.hash }));
        break;
      case "withdraw":
        rows.push(
          row({
            Date: Date_,
            "Sent Amount": fmt(-e.amountUsdc),
            "Sent Currency": "USDC",
            ...(e.feeUsdc > 0 ? { "Fee Amount": fmt(e.feeUsdc), "Fee Currency": "USDC" } : {}),
            Description: `Hyperliquid ${e.note}`,
            TxHash: e.hash,
          }),
        );
        break;
      case "transfer_in":
      case "transfer_out": {
        if (/not taxable|unknown ledger/.test(e.note)) break; // internal moves stay out of Koinly; they are in the raw CSV
        const amt = Math.abs(e.amountUsdc);
        if (amt === 0) break;
        rows.push(
          row({
            Date: Date_,
            ...(e.kind === "transfer_in" ? { "Received Amount": fmt(amt), "Received Currency": e.asset || "USDC" } : { "Sent Amount": fmt(amt), "Sent Currency": e.asset || "USDC" }),
            ...(e.feeUsdc > 0 ? { "Fee Amount": fmt(e.feeUsdc), "Fee Currency": "USDC" } : {}),
            Description: `Hyperliquid ${e.note}`,
            TxHash: e.hash,
          }),
        );
        break;
      }
      case "liquidation":
        // Liquidation PnL arrives through the liquidation fill (closedPnl); the ledger entry is informational.
        break;
      case "pm_buy":
      case "pm_sell": {
        const cost = e.size * e.price;
        const token = pmTokenName(e.asset);
        rows.push(
          row({
            Date: Date_,
            ...(e.kind === "pm_buy"
              ? { "Sent Amount": fmt(cost), "Sent Currency": "USDC", "Received Amount": fmt(e.size), "Received Currency": token }
              : { "Sent Amount": fmt(e.size), "Sent Currency": token, "Received Amount": fmt(cost), "Received Currency": "USDC" }),
            Description: `Polymarket ${e.note}`,
            TxHash: e.hash,
          }),
        );
        break;
      }
    }
  }

  for (const g of fundingByDay.values()) {
    if (Math.abs(g.usdc) < 1e-9) continue;
    rows.push(fundingRow(g.timeMs, g.usdc, `Hyperliquid funding ${g.coin}, ${g.count} hourly payments summed for the day`, "", opts));
  }
  rows.sort((a, b) => a.Date.localeCompare(b.Date));
  return rows;
}

function fundingRow(timeMs: number, usdc: number, desc: string, hash: string, opts: KoinlyOptions): KoinlyRow {
  const received = usdc > 0;
  const label = opts.fundingLabel === "realized gain" ? "realized gain" : received ? "income" : "cost";
  return row({
    Date: koinlyDate(timeMs),
    ...(received ? { "Received Amount": fmt(usdc), "Received Currency": "USDC" } : { "Sent Amount": fmt(usdc), "Sent Currency": "USDC" }),
    Label: label,
    Description: desc,
    TxHash: hash,
  });
}
