// Solana: find our USDC token account, list new signatures on it, read token balance deltas.
// Uses only JSON-RPC with jsonParsed encoding, no web3.js, so the worker stays small.
import { CHAINS } from "../config.ts";
import type { IncomingTransfer } from "../db.ts";

const PAGE = 50;
const MAX_PAGES = 4;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`solana rpc ${method} http ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`solana rpc ${method}: ${json.error.message}`);
  return json.result as T;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

interface ParsedTx {
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { instructions: Array<{ program?: string; parsed?: unknown }> } };
}

async function findTokenAccount(url: string): Promise<string | null> {
  const cfg = CHAINS.solana;
  const r = await rpc<{ value: Array<{ pubkey: string }> }>(url, "getTokenAccountsByOwner", [
    cfg.receiver,
    { mint: cfg.tokenAddress },
    { encoding: "jsonParsed", commitment: "finalized" },
  ]);
  return r.value[0]?.pubkey ?? null;
}

export async function scanSolana(rpcUrl: string, cursor: string | null): Promise<{ transfers: IncomingTransfer[]; cursor: string | null }> {
  const cfg = CHAINS.solana;
  const ata = await findTokenAccount(rpcUrl);
  if (!ata) return { transfers: [], cursor }; // no USDC account yet: nobody has paid, nothing to scan

  // Collect signatures newer than the cursor, oldest first.
  const sigs: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await rpc<Array<{ signature: string; err: unknown }>>(rpcUrl, "getSignaturesForAddress", [
      ata,
      { limit: PAGE, commitment: "finalized", ...(before ? { before } : {}), ...(cursor ? { until: cursor } : {}) },
    ]);
    for (const s of batch) if (!s.err) sigs.push(s.signature);
    if (batch.length < PAGE) break;
    before = batch[batch.length - 1].signature;
  }
  if (cursor === null) {
    // First run: remember the newest signature, process nothing.
    return { transfers: [], cursor: sigs[0] ?? null };
  }
  sigs.reverse();

  const transfers: IncomingTransfer[] = [];
  for (const sig of sigs) {
    const tx = await rpc<ParsedTx | null>(rpcUrl, "getTransaction", [
      sig,
      { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 },
    ]);
    if (!tx?.meta || tx.meta.err) continue;
    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];
    const ours = (list: TokenBalance[]) => list.find((b) => b.mint === cfg.tokenAddress && b.owner === cfg.receiver);
    const preAmt = BigInt(ours(pre)?.uiTokenAmount.amount ?? "0");
    const postAmt = BigInt(ours(post)?.uiTokenAmount.amount ?? "0");
    const delta = postAmt - preAmt;
    if (delta <= 0n || delta > BigInt(Number.MAX_SAFE_INTEGER)) continue;

    // Payer: the token account for the same mint whose balance went down.
    let from: string | null = null;
    for (const p of post) {
      if (p.mint !== cfg.tokenAddress || p.owner === cfg.receiver) continue;
      const before = pre.find((q) => q.accountIndex === p.accountIndex);
      if (before && BigInt(before.uiTokenAmount.amount) > BigInt(p.uiTokenAmount.amount)) {
        from = p.owner ?? null;
        break;
      }
    }
    // Memo (Solana Pay "memo" param) carries the invoice id when the wallet supports it.
    let memo: string | null = null;
    for (const ins of tx.transaction.message.instructions) {
      if (ins.program === "spl-memo" && typeof ins.parsed === "string") memo = ins.parsed;
    }
    transfers.push({ chain: "solana", txHash: sig, logIndex: 0, from, amountUnits: Number(delta), memo });
  }
  const newest = sigs.length ? sigs[sigs.length - 1] : cursor;
  return { transfers, cursor: newest };
}
