// Base (EVM): scan ERC-20 Transfer logs to our address via JSON-RPC eth_getLogs.
import { CHAINS } from "../config.ts";
import type { IncomingTransfer } from "../db.ts";
import { hexToUnits } from "../money.ts";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_RANGE = 2000; // blocks per scan; Base makes ~30 blocks/min, this is a 1-hour backlog cap
const FIRST_RUN_LOOKBACK = 0; // first run only sets the cursor; deploy before you start selling

interface Log {
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  data: string;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`base rpc ${method} http ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`base rpc ${method}: ${json.error.message}`);
  return json.result as T;
}

function padAddress(addr: string): string {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export async function scanBase(rpcUrl: string, cursor: string | null): Promise<{ transfers: IncomingTransfer[]; cursor: string }> {
  const cfg = CHAINS.base;
  const head = Number(await rpc<string>(rpcUrl, "eth_blockNumber", []));
  const safeHead = head - cfg.confirmations;
  if (cursor === null) {
    return { transfers: [], cursor: String(safeHead - FIRST_RUN_LOOKBACK) };
  }
  const from = Number(cursor) + 1;
  const to = Math.min(safeHead, from + MAX_RANGE - 1);
  if (from > to) return { transfers: [], cursor };

  const logs = await rpc<Log[]>(rpcUrl, "eth_getLogs", [
    {
      fromBlock: "0x" + from.toString(16),
      toBlock: "0x" + to.toString(16),
      address: cfg.tokenAddress,
      topics: [TRANSFER_TOPIC, null, padAddress(cfg.receiver)],
    },
  ]);

  const transfers: IncomingTransfer[] = [];
  for (const log of logs) {
    let amountUnits: number;
    try {
      amountUnits = hexToUnits(log.data);
    } catch {
      continue; // absurdly large amount, not a real payment
    }
    transfers.push({
      chain: "base",
      txHash: log.transactionHash,
      logIndex: Number(log.logIndex),
      from: "0x" + log.topics[1].slice(26),
      amountUnits,
      memo: null,
    });
  }
  return { transfers, cursor: String(to) };
}
