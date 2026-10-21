import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateAmount, hexToUnits, parseUnits, unitsToDisplay, usdToUnits } from "../src/money.ts";

test("usdToUnits uses 6 decimals and rounds", () => {
  assert.equal(usdToUnits(39), 39_000_000);
  assert.equal(usdToUnits(0.1 + 0.2), 300_000);
  assert.throws(() => usdToUnits(-1));
});

test("unitsToDisplay keeps at least two decimals and trims the rest", () => {
  assert.equal(unitsToDisplay(39_000_000), "39.00");
  assert.equal(unitsToDisplay(39_170_000), "39.17");
  assert.equal(unitsToDisplay(39_170_500), "39.1705");
  assert.equal(unitsToDisplay(5), "0.000005");
});

test("allocateAmount returns price plus 1..99 cents, never a taken amount", () => {
  const price = 39_000_000;
  const taken = new Set<number>();
  for (let i = 0; i < 99; i++) {
    const a = allocateAmount(price, taken);
    assert.ok(a > price && a <= price + 990_000, `in range: ${a}`);
    assert.equal((a - price) % 10_000, 0, "whole cents");
    assert.ok(!taken.has(a), "unique");
    taken.add(a);
  }
  assert.equal(taken.size, 99);
  assert.throws(() => allocateAmount(price, taken), /no free amount slot/);
});

test("allocateAmount is deterministic for a fixed random source", () => {
  const a = allocateAmount(10_000_000, new Set(), 6, () => 0.5);
  const b = allocateAmount(10_000_000, new Set(), 6, () => 0.5);
  assert.equal(a, b);
  assert.equal(a, 10_000_000 + 50 * 10_000); // index 49 -> 50 cents
});

test("parseUnits parses decimals exactly", () => {
  assert.equal(parseUnits("39.17"), 39_170_000);
  assert.equal(parseUnits("39"), 39_000_000);
  assert.equal(parseUnits("0.000001"), 1);
  assert.equal(parseUnits("1.1234567"), 1_123_456); // extra digits truncated
  assert.throws(() => parseUnits("abc"));
});

test("hexToUnits converts and guards overflow", () => {
  assert.equal(hexToUnits("0x" + (39_170_000).toString(16)), 39_170_000);
  assert.throws(() => hexToUnits("0xffffffffffffffffffff"));
});
