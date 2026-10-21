#!/usr/bin/env -S node --experimental-strip-types
// hl-tax-export: Hyperliquid + Polymarket -> Koinly CSV, raw CSV, summary.
//
//   hl-tax-export --hl 0xYourWallet --year 2026 --out ./export
//   hl-tax-export --hl 0x... --pm 0xProxyWallet --from 2026-01-01 --to 2026-12-31 --funding income/cost --fees inline
//   hl-tax-export --hl 0x... --year 2026 --license HLTAXE-XXXX-XXXX-XXXX-XXXX
//
// Without a license the export is capped at FREE_ROWS rows; the summary is always complete.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "./csv.ts";
import { exportHyperliquid, makeFetcher } from "./hyperliquid.ts";
import { DEFAULT_KOINLY, KOINLY_COLUMNS, toKoinlyRows, type KoinlyOptions } from "./koinly.ts";
import { fetchPolymarketTrades, polymarketToEvents } from "./polymarket.ts";
import { renderSummaryText, summarize } from "./summary.ts";
import type { TaxEvent } from "./types.ts";

const FREE_ROWS = 300;
const LICENSE_API = process.env.HL_TAX_LICENSE_API ?? "https://pay.example.com/api/license/verify";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    [
      "usage: hl-tax-export --hl <wallet> [--pm <polymarket proxy wallet>] (--year YYYY | --from YYYY-MM-DD --to YYYY-MM-DD) [--out dir]",
      "       [--funding realized-gain|income/cost] [--fees separate|inline] [--hourly-funding] [--license KEY]",
    ].join("\n"),
  );
  process.exit(2);
}

async function verifyLicense(key: string | undefined): Promise<boolean> {
  if (!key) return false;
  try {
    const res = await fetch(`${LICENSE_API}?key=${encodeURIComponent(key)}`);
    const j = (await res.json()) as { valid?: boolean; reason?: string };
    if (!j.valid) console.error(`license not accepted: ${j.reason ?? "unknown"}`);
    return Boolean(j.valid);
  } catch (e) {
    console.error(`license check failed: ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  const hl = arg("hl");
  const pm = arg("pm");
  if (!hl && !pm) usage("need --hl and/or --pm wallet");
  if (hl && !/^0x[0-9a-fA-F]{40}$/.test(hl)) usage("--hl must be a 0x address");
  if (pm && !/^0x[0-9a-fA-F]{40}$/.test(pm)) usage("--pm must be a 0x address");

  let fromMs: number, toMs: number;
  const year = arg("year");
  if (year) {
    fromMs = Date.UTC(+year, 0, 1);
    toMs = Date.UTC(+year, 11, 31, 23, 59, 59, 999);
  } else {
    const from = arg("from"),
      to = arg("to");
    if (!from || !to) usage("need --year or --from/--to");
    fromMs = Date.parse(`${from}T00:00:00Z`);
    toMs = Date.parse(`${to}T23:59:59.999Z`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) usage("bad --from/--to");
  }
  const out = arg("out", "./export")!;
  const opts: KoinlyOptions = {
    ...DEFAULT_KOINLY,
    fundingLabel: arg("funding", "realized-gain") === "income/cost" ? "income/cost" : "realized gain",
    fees: arg("fees", "separate") === "inline" ? "inline" : "separate",
    groupFundingByDay: arg("hourly-funding") !== "true",
  };
  const licensed = await verifyLicense(arg("license") ?? process.env.HL_TAX_LICENSE);

  const log = (s: string) => console.error(s);
  const events: TaxEvent[] = [];
  const raw: Record<string, unknown> = {};
  if (hl) {
    const ex = await exportHyperliquid(makeFetcher(process.env.HL_API_URL), hl, fromMs, toMs, log);
    events.push(...ex.events);
    raw.hyperliquid = { fills: ex.fills, funding: ex.funding, ledger: ex.ledger };
  }
  if (pm) {
    log("fetching Polymarket trades");
    const trades = await fetchPolymarketTrades(pm, fromMs, toMs);
    log(`  ${trades.length} trades`);
    events.push(...polymarketToEvents(trades));
    raw.polymarket = { trades };
  }
  events.sort((a, b) => a.timeMs - b.timeMs);

  const summary = summarize(events, fromMs, toMs);
  let koinly = toKoinlyRows(events, opts);
  let capped = false;
  if (!licensed && koinly.length > FREE_ROWS) {
    koinly = koinly.slice(0, FREE_ROWS);
    capped = true;
  }

  mkdirSync(out, { recursive: true });
  const stem = `${hl ?? pm}-${summary.from}_${summary.to}`;
  writeFileSync(join(out, `${stem}-koinly.csv`), toCsv(KOINLY_COLUMNS, koinly));
  const rawCols = ["venue", "kind", "time", "asset", "size", "price", "pnlUsdc", "feeUsdc", "feeToken", "amountUsdc", "hash", "note"];
  const rawRows = (licensed ? events : events.slice(0, FREE_ROWS)).map((e) => ({ ...e, time: new Date(e.timeMs).toISOString() }));
  writeFileSync(join(out, `${stem}-events.csv`), toCsv(rawCols, rawRows));
  writeFileSync(join(out, `${stem}-summary.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(out, `${stem}-summary.txt`), renderSummaryText(summary));
  if (licensed) writeFileSync(join(out, `${stem}-raw.json`), JSON.stringify(raw));

  console.log(renderSummaryText(summary));
  console.log(``);
  console.log(`Koinly rows: ${koinly.length}${capped ? ` (free preview capped at ${FREE_ROWS}; full export needs a license)` : ""}`);
  console.log(`Files written to ${out}/${stem}-*`);
}

main().catch((e) => {
  console.error(`failed: ${(e as Error).message}`);
  process.exit(1);
});
