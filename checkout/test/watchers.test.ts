import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSolana, GENESIS } from "../src/watchers/solana.ts";
import { scanTon } from "../src/watchers/ton.ts";
import { scanBase } from "../src/watchers/base.ts";
import { CHAINS } from "../src/config.ts";

// Replace global fetch with a scripted responder.
function mockFetch(handler: (url: string, body: any) => unknown) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    const result = handler(String(url), body);
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  return () => (globalThis.fetch = orig);
}

test("solana: first run with no token account yields GENESIS, and the first payment afterwards is processed", async () => {
  const sol = CHAINS.solana;
  let hasAta = false;
  const sigs: string[] = [];
  const restore = mockFetch((_url, body) => {
    switch (body.method) {
      case "getTokenAccountsByOwner":
        return { result: { value: hasAta ? [{ pubkey: "ATA" }] : [] } };
      case "getSignaturesForAddress":
        return { result: sigs.map((s) => ({ signature: s, err: null })) };
      case "getTransaction":
        return {
          result: {
            meta: {
              err: null,
              preTokenBalances: [{ accountIndex: 1, mint: sol.tokenAddress, owner: "payer", uiTokenAmount: { amount: "100000000", decimals: 6 } }],
              postTokenBalances: [
                { accountIndex: 0, mint: sol.tokenAddress, owner: sol.receiver, uiTokenAmount: { amount: "39170000", decimals: 6 } },
                { accountIndex: 1, mint: sol.tokenAddress, owner: "payer", uiTokenAmount: { amount: "60830000", decimals: 6 } },
              ],
            },
            transaction: { message: { instructions: [{ program: "spl-memo", parsed: "abc123" }] } },
          },
        };
    }
    return {};
  });
  try {
    const r1 = await scanSolana("http://rpc", null);
    assert.equal(r1.cursor, GENESIS);
    assert.equal(r1.transfers.length, 0);
    hasAta = true;
    sigs.push("sig1");
    const r2 = await scanSolana("http://rpc", r1.cursor);
    assert.equal(r2.transfers.length, 1, "first ever payment must not be skipped");
    assert.equal(r2.transfers[0].amountUnits, 39_170_000);
    assert.equal(r2.transfers[0].from, "payer");
    assert.equal(r2.transfers[0].memo, "abc123");
    assert.equal(r2.cursor, "sig1");
  } finally {
    restore();
  }
});

test("solana: first run with existing history skips it and only processes newer signatures", async () => {
  const restore = mockFetch((_url, body) => {
    if (body.method === "getTokenAccountsByOwner") return { result: { value: [{ pubkey: "ATA" }] } };
    if (body.method === "getSignaturesForAddress") return { result: [{ signature: "old2", err: null }, { signature: "old1", err: null }] };
    return {};
  });
  try {
    const r = await scanSolana("http://rpc", null);
    assert.equal(r.cursor, "old2");
    assert.equal(r.transfers.length, 0);
  } finally {
    restore();
  }
});

test("ton: first run with no history yields cursor 0 and the first transfer afterwards is processed", async () => {
  let list: any[] = [];
  const restore = mockFetch(() => ({ jetton_transfers: list }));
  try {
    const r1 = await scanTon("", null);
    assert.equal(r1.cursor, "0");
    list = [{ transaction_hash: "h1", transaction_lt: "5000", transaction_now: 1, source: "0:abc", destination: "0:me", amount: "39170000", jetton_master: "x", comment: "abc123" }];
    const r2 = await scanTon("", r1.cursor);
    assert.equal(r2.transfers.length, 1);
    assert.equal(r2.transfers[0].memo, "abc123");
    assert.equal(r2.cursor, "5000");
    const r3 = await scanTon("", r2.cursor);
    assert.equal(r3.transfers.length, 0, "already processed");
  } finally {
    restore();
  }
});

test("base: first run sets the cursor below the head, next run reads logs and advances", async () => {
  const base = CHAINS.base;
  let head = 1000;
  const restore = mockFetch((_url, body) => {
    if (body.method === "eth_blockNumber") return { result: "0x" + head.toString(16) };
    if (body.method === "eth_getLogs") {
      const from = Number(body.params[0].fromBlock);
      assert.equal(from, 1000 - base.confirmations + 1);
      assert.equal(body.params[0].topics[2], "0x" + base.receiver.toLowerCase().slice(2).padStart(64, "0"));
      return { result: [{ blockNumber: "0x3e4", transactionHash: "0xtx", logIndex: "0x2", topics: ["t", "0x" + "11".repeat(12) + "ab".repeat(20)], data: "0x" + (39_170_000).toString(16) }] };
    }
    return {};
  });
  try {
    const r1 = await scanBase("http://rpc", null);
    assert.equal(r1.cursor, String(1000 - base.confirmations));
    assert.equal(r1.transfers.length, 0);
    const same = await scanBase("http://rpc", r1.cursor);
    assert.equal(same.transfers.length, 0, "no new safe blocks at the same head");
    head = 1020; // chain advanced: scan (990, 1010], find one transfer, advance the cursor
    const r2 = await scanBase("http://rpc", r1.cursor);
    assert.equal(r2.transfers.length, 1);
    assert.equal(r2.transfers[0].amountUnits, 39_170_000);
    assert.equal(r2.transfers[0].from, "0x" + "ab".repeat(20));
    assert.equal(r2.transfers[0].logIndex, 2);
    assert.equal(r2.cursor, String(1020 - base.confirmations));
  } finally {
    restore();
  }
});
