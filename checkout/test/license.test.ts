import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLicenseKey, productCode, randomId } from "../src/license.ts";

test("license key format and determinism", async () => {
  const k1 = await makeLicenseKey("secret", "hl-tax-export-2026", "abc123");
  const k2 = await makeLicenseKey("secret", "hl-tax-export-2026", "abc123");
  assert.equal(k1, k2);
  assert.match(k1, /^HLTAXE-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test("different secret or invoice gives a different key", async () => {
  const a = await makeLicenseKey("secret", "p", "inv1");
  const b = await makeLicenseKey("secret", "p", "inv2");
  const c = await makeLicenseKey("other", "p", "inv1");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("productCode strips punctuation", () => {
  assert.equal(productCode("aso-audit"), "ASOAUD");
  assert.equal(productCode("x"), "XXX");
});

test("randomId is lowercase, unambiguous alphabet", () => {
  const id = randomId(10);
  assert.match(id, /^[a-hj-np-z2-9]{10}$/);
});
