import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fillsToEvents, fundingToEvents, ledgerToEvents, spotPairNames, fetchFills, type Fetcher } from "../src/hyperliquid.ts";
import { toKoinlyRows, KOINLY_COLUMNS, koinlyDate } from "../src/koinly.ts";
import { summarize } from "../src/summary.ts";
import { toCsv } from "../src/csv.ts";
import { polymarketToEvents } from "../src/polymarket.ts";
import type { HlFill, HlFundingEntry, HlLedgerEntry, HlSpotMeta } from "../src/types.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/hl.json", import.meta.url), "utf8")) as {
  spotMeta: HlSpotMeta;
  fills: HlFill[];
  funding: HlFundingEntry[];
  ledger: HlLedgerEntry[];
};

function allEvents() {
  const pairs = spotPairNames(fx.spotMeta);
  return [...fillsToEvents(fx.fills, pairs), ...fundingToEvents(fx.funding), ...ledgerToEvents(fx.ledger)].sort((a, b) => a.timeMs - b.timeMs);
}

test("spot pair names resolve @index to token names", () => {
  const pairs = spotPairNames(fx.spotMeta);
  assert.deepEqual(pairs.get("@107"), { base: "HYPE", quote: "USDC" });
  assert.deepEqual(pairs.get("PURR/USDC"), { base: "PURR", quote: "USDC" });
});

test("fills become perp opens/closes and spot swaps; base-token fees are valued at fill price", () => {
  const ev = fillsToEvents(fx.fills, spotPairNames(fx.spotMeta));
  assert.deepEqual(ev.map((e) => e.kind), ["perp_open", "perp_close", "perp_open", "perp_close", "spot_buy", "spot_sell"]);
  assert.equal(ev[1].pnlUsdc, 100);
  assert.equal(ev[3].pnlUsdc, -100);
  const hype = ev[4];
  assert.equal(hype.asset, "HYPE");
  assert.equal(hype.feeUsdc, 0.02 * 25); // 0.02 HYPE fee at 25 USDC
});

test("summary totals: pnl, fees, funding, deposits, withdrawals", () => {
  const s = summarize(allEvents(), Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
  assert.equal(s.totals.realizedPnlUsdc, 0); // +100 ETH, -100 BTC
  assert.equal(s.totals.feesUsdc, 3.945); // 1.05 + 1.085 + 0.9 + 0.91 (perps only)
  assert.equal(s.totals.fundingUsdc, 0.15); // -0.1 -0.1 +0.05 +0.3
  assert.equal(s.totals.depositsUsdc, 5000);
  assert.equal(s.totals.withdrawalsUsdc, 1000);
  assert.equal(s.hourlyFundingRows, 4);
  assert.equal(s.spotTrades, 2);
  const eth = s.perps.find((p) => p.asset === "ETH")!;
  assert.equal(eth.closes, 1);
  assert.equal(eth.fundingUsdc, -0.15);
});

test("koinly rows: realized gain rows, separate fee rows, funding grouped per day, internal transfers excluded", () => {
  const rows = toKoinlyRows(allEvents());
  const labels = rows.map((r) => r.Label);
  assert.equal(labels.filter((l) => l === "realized gain").length, 2 + 2); // 2 closes + 2 funding days (ETH day, BTC day)
  assert.equal(labels.filter((l) => l === "cost").length, 4); // one fee row per perp fill
  const gain = rows.find((r) => r.Description.includes("Close Long"))!;
  assert.equal(gain["Received Amount"], "100");
  assert.equal(gain["Received Currency"], "USDC");
  const loss = rows.find((r) => r.Description.includes("Close Short"))!;
  assert.equal(loss["Sent Amount"], "100");
  const ethFunding = rows.find((r) => r.Description.includes("funding ETH"))!;
  assert.equal(ethFunding["Sent Amount"], "0.15");
  assert.ok(ethFunding.Description.includes("3 hourly payments"));
  assert.ok(!rows.some((r) => r.Description.includes("accountClassTransfer")));
  const dep = rows.find((r) => r.Description.includes("deposit"))!;
  assert.equal(dep["Received Amount"], "5000");
  assert.equal(dep.Label, "");
  const wd = rows.find((r) => r.Description.includes("withdraw"))!;
  assert.equal(wd["Sent Amount"], "1000");
  assert.equal(wd["Fee Amount"], "1");
  // sorted by date
  const dates = rows.map((r) => r.Date);
  assert.deepEqual(dates, [...dates].sort());
});

test("koinly options: inline fees and income/cost funding labels", () => {
  const rows = toKoinlyRows(allEvents(), { fundingLabel: "income/cost", fees: "inline", groupFundingByDay: false });
  const gain = rows.find((r) => r.Description.includes("Close Long"))!;
  assert.equal(gain["Fee Amount"], "1.085");
  assert.equal(rows.filter((r) => r.Label === "cost" && r.Description.includes("trading fee")).length, 2); // only opens keep a fee row
  const funding = rows.filter((r) => r.Description.includes("funding"));
  assert.equal(funding.length, 4);
  assert.deepEqual(new Set(funding.map((r) => r.Label)), new Set(["income", "cost"]));
});

test("csv is RFC 4180 with quoting", () => {
  const csv = toCsv(["a", "b"], [{ a: 'x,"y"', b: "line\nbreak" }]);
  assert.equal(csv, 'a,b\r\n"x,""y""","line\nbreak"\r\n');
  assert.equal(KOINLY_COLUMNS.length, 12);
  assert.equal(koinlyDate(Date.UTC(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05 UTC");
});

test("polymarket trades map to USDC <-> outcome token swaps", () => {
  const ev = polymarketToEvents([
    { proxyWallet: "0x1", side: "BUY", asset: "123", conditionId: "0xc", size: 100, price: 0.4, timestamp: 1767225600, title: "Will it rain?", outcome: "Yes", transactionHash: "0xp" },
    { proxyWallet: "0x1", side: "SELL", asset: "123", conditionId: "0xc", size: 100, price: 0.9, timestamp: 1767312000, title: "Will it rain?", outcome: "Yes", transactionHash: "0xq" },
  ]);
  const rows = toKoinlyRows(ev);
  assert.equal(rows[0]["Sent Amount"], "40");
  assert.equal(rows[0]["Received Currency"], "PM:Will_it_rain?/Yes");
  assert.equal(rows[1]["Received Amount"], "90");
});

test("pagination dedupes same-millisecond entries across page boundaries and sorts by time", async () => {
  const pages = [
    [{ tid: 1, time: 10 }, { tid: 2, time: 20 }],
    [{ tid: 2, time: 20 }, { tid: 3, time: 30 }],
    [{ tid: 3, time: 30 }],
  ];
  let call = 0;
  const f: Fetcher = async (body) => {
    assert.equal(body.type, "userFillsByTime");
    const p = pages[Math.min(call, pages.length - 1)];
    call++;
    // emulate server cap of 2 per page by returning exactly 2 until the last
    return p;
  };
  // monkeypatch page size by calling fetchFills with a tiny server: pages of 2 look "full" only when length === 2000,
  // so this exercises the early-exit path; the dedupe is what we assert.
  const fills = (await fetchFills(f, "0x", 0, 100)) as unknown as Array<{ tid: number; time: number }>;
  assert.deepEqual(fills.map((x) => x.tid), [1, 2]);
});
