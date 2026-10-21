// Browser version of the exporter. Everything runs client-side: wallet addresses go to the public
// Hyperliquid / Polymarket APIs straight from the visitor's browser, never to our server.
import { toCsv } from "../src/csv.ts";
import { exportHyperliquid, makeFetcher } from "../src/hyperliquid.ts";
import { DEFAULT_KOINLY, KOINLY_COLUMNS, toKoinlyRows, type KoinlyOptions } from "../src/koinly.ts";
import { fetchPolymarketTrades, polymarketToEvents } from "../src/polymarket.ts";
import { renderSummaryText, summarize } from "../src/summary.ts";
import type { TaxEvent } from "../src/types.ts";

declare const CHECKOUT_URL: string; // injected at build time; "" disables license checks (everything free)
const FREE_ROWS = 300;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (s: string) => {
  const el = $("log");
  el.textContent += s + "\n";
  el.scrollTop = el.scrollHeight;
};

async function verifyLicense(key: string): Promise<boolean> {
  if (!key) return false;
  if (!CHECKOUT_URL) return true;
  try {
    const r = await fetch(`${CHECKOUT_URL}/api/license/verify?key=${encodeURIComponent(key)}`);
    const j = (await r.json()) as { valid?: boolean; reason?: string };
    if (!j.valid) log(`License not accepted: ${j.reason ?? "unknown"}`);
    return Boolean(j.valid);
  } catch (e) {
    log(`License check failed: ${(e as Error).message}`);
    return false;
  }
}

function download(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.textContent = name;
  a.className = "dl";
  $("downloads").appendChild(a);
}

async function run() {
  const btn = $<HTMLButtonElement>("run");
  btn.disabled = true;
  $("log").textContent = "";
  $("downloads").innerHTML = "";
  $("summary").textContent = "";
  try {
    const hl = $<HTMLInputElement>("hl").value.trim();
    const pm = $<HTMLInputElement>("pm").value.trim();
    const year = Number($<HTMLSelectElement>("year").value);
    const key = $<HTMLInputElement>("license").value.trim();
    const opts: KoinlyOptions = {
      ...DEFAULT_KOINLY,
      fundingLabel: $<HTMLSelectElement>("funding").value === "income/cost" ? "income/cost" : "realized gain",
      fees: $<HTMLSelectElement>("fees").value === "inline" ? "inline" : "separate",
      groupFundingByDay: !$<HTMLInputElement>("hourly").checked,
    };
    if (!/^0x[0-9a-fA-F]{40}$/.test(hl) && !/^0x[0-9a-fA-F]{40}$/.test(pm)) throw new Error("Enter a valid 0x wallet address");
    const fromMs = Date.UTC(year, 0, 1),
      toMs = Date.UTC(year, 11, 31, 23, 59, 59, 999);
    const licensed = await verifyLicense(key);
    const events: TaxEvent[] = [];
    if (/^0x[0-9a-fA-F]{40}$/.test(hl)) {
      const ex = await exportHyperliquid(makeFetcher(undefined, 300), hl, fromMs, toMs, log);
      events.push(...ex.events);
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(pm)) {
      log("fetching Polymarket trades");
      const trades = await fetchPolymarketTrades(pm, fromMs, toMs);
      log(`  ${trades.length} trades`);
      events.push(...polymarketToEvents(trades));
    }
    events.sort((a, b) => a.timeMs - b.timeMs);
    const summary = summarize(events, fromMs, toMs);
    $("summary").textContent = renderSummaryText(summary);
    let rows = toKoinlyRows(events, opts);
    const total = rows.length;
    const capped = !licensed && rows.length > FREE_ROWS;
    if (capped) rows = rows.slice(0, FREE_ROWS);
    const stem = `${hl || pm}-${year}`;
    download(`${stem}-koinly.csv`, toCsv(KOINLY_COLUMNS, rows));
    const rawCols = ["venue", "kind", "time", "asset", "size", "price", "pnlUsdc", "feeUsdc", "feeToken", "amountUsdc", "hash", "note"];
    download(`${stem}-events.csv`, toCsv(rawCols, (licensed ? events : events.slice(0, FREE_ROWS)).map((e) => ({ ...e, time: new Date(e.timeMs).toISOString() }))));
    download(`${stem}-summary.txt`, renderSummaryText(summary), "text/plain");
    log(`Done. Koinly rows: ${rows.length} of ${total}.`);
    $("cap").hidden = !capped;
    if (capped) $("cap-count").textContent = String(total);
  } catch (e) {
    log(`Failed: ${(e as Error).message}`);
  } finally {
    btn.disabled = false;
  }
}

$("run").addEventListener("click", run);
const y = $<HTMLSelectElement>("year");
const thisYear = new Date().getUTCFullYear();
for (let yy = thisYear; yy >= 2023; yy--) y.add(new Option(String(yy), String(yy), yy === thisYear - 0, yy === thisYear - 0));
if (CHECKOUT_URL) ($("buy") as HTMLAnchorElement).href = `${CHECKOUT_URL}/buy/hl-tax-export-${thisYear}`;
else $("buy").hidden = true;

// "Notify me" form: stores the address through the checkout worker. Hidden when no checkout is configured.
if (!CHECKOUT_URL) $("notify").hidden = true;
$("notify-btn").addEventListener("click", async () => {
  const email = $<HTMLInputElement>("notify-email").value.trim();
  const out = $("notify-msg");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void (out.textContent = "Enter a valid email");
  try {
    const r = await fetch(`${CHECKOUT_URL}/api/subscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, source: "hl-tax-export" }) });
    out.textContent = r.ok ? "Done. One email when the tax-season version ships, nothing else." : "Could not save, try again later";
  } catch {
    out.textContent = "Could not save, try again later";
  }
});

$("copy-summary").addEventListener("click", () => {
  const t = $("summary").textContent ?? "";
  if (!t.includes("TOTAL")) return;
  navigator.clipboard.writeText(t + "\n\nvia " + location.origin).then(() => ($("copy-summary").textContent = "copied"));
});
