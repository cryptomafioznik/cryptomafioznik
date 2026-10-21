import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeComment } from "../src/watchers/ton.ts";

// Build a minimal single-cell BOC with a text comment: 0x00000000 + utf8 text.
function bocWithComment(text: string): string {
  const body = new TextEncoder().encode(text);
  const data = new Uint8Array(4 + body.length);
  data.set(body, 4);
  const d1 = 0; // no refs, level 0
  const d2 = data.length * 2; // byte-aligned
  const cell = new Uint8Array([d1, d2, ...data]);
  const header = [
    0xb5, 0xee, 0x9c, 0x72, // magic
    0x01, // flags: ref size 1, no index
    0x01, // offset bytes
    0x01, // cells
    0x01, // roots
    0x00, // absent
    cell.length, // total cell size
    0x00, // root index
  ];
  const boc = new Uint8Array([...header, ...cell]);
  return btoa(String.fromCharCode(...boc));
}

test("decodes a plain text comment", () => {
  assert.equal(decodeComment(bocWithComment("k7m2p9q4rs")), "k7m2p9q4rs");
});

test("returns null for empty, garbage, or non-comment payloads", () => {
  assert.equal(decodeComment(null), null);
  assert.equal(decodeComment("not base64!!"), null);
  assert.equal(decodeComment(btoa("\x00\x01\x02")), null);
});
