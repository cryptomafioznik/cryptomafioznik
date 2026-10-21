import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, formatChange, formatPositions, parseState, type ClearinghouseState } from "../src/positions.ts";

const state = (positions: Array<[string, string, string, string]>): ClearinghouseState => ({
  assetPositions: positions.map(([coin, szi, positionValue, entryPx]) => ({
    position: { coin, szi, entryPx, positionValue, unrealizedPnl: "10", leverage: { type: "cross", value: 5 }, liquidationPx: "1000" },
  })),
});

test("parseState drops zero positions and keeps sign", () => {
  const s = parseState(state([["ETH", "2", "6000", "3000"], ["BTC", "-0.5", "45000", "90000"], ["SOL", "0", "0", "0"]]));
  assert.deepEqual(Object.keys(s).sort(), ["BTC", "ETH"]);
  assert.equal(s.BTC.szi, -0.5);
  assert.equal(s.BTC.positionValue, 45000);
});

test("diff detects opened, closed, increased, decreased, flipped and ignores drift", () => {
  const before = parseState(state([["ETH", "2", "6000", "3000"], ["BTC", "-0.5", "45000", "90000"], ["SOL", "100", "20000", "200"], ["DOGE", "1000", "100", "0.1"], ["HYPE", "100", "2500", "25"]]));
  const after = parseState(state([["ETH", "4", "12000", "3000"], ["BTC", "-0.25", "22500", "90000"], ["SOL", "-100", "20000", "200"], ["DOGE", "1010", "101", "0.1"], ["ARB", "1000", "1000", "1"]]));
  const d = diffSnapshots(before, after);
  const byCoin = Object.fromEntries(d.map((c) => [c.coin, c]));
  assert.equal(byCoin.ETH.kind, "increased");
  assert.equal(byCoin.ETH.deltaUsd, 6000);
  assert.equal(byCoin.BTC.kind, "decreased");
  assert.equal(byCoin.BTC.deltaUsd, 22500);
  assert.equal(byCoin.SOL.kind, "flipped");
  assert.equal(byCoin.HYPE.kind, "closed");
  assert.equal(byCoin.ARB.kind, "opened");
  assert.ok(!byCoin.DOGE, "1% drift ignored");
  assert.equal(d[0].coin, "SOL", "largest change first");
});

test("formatting is compact and mentions side, size, leverage", () => {
  const after = parseState(state([["ETH", "2", "6000", "3000"]]));
  const [c] = diffSnapshots({}, after);
  const text = formatChange("whale1", "0xabcdef1234567890abcdef1234567890abcdef12", c);
  assert.match(text, /whale1 \(0xabcd…ef12\) opened LONG ETH/);
  assert.match(text, /\$6\.0K · 5x · entry 3000 · liq 1000/);
  assert.match(formatPositions("", "0xabcdef1234567890abcdef1234567890abcdef12", {}), /no open positions/);
});
