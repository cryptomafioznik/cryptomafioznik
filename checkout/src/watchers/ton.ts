// TON: incoming USDT jetton transfers to our wallet via toncenter API v3.
import { CHAINS } from "../config.ts";
import type { IncomingTransfer } from "../db.ts";

interface JettonTransfer {
  transaction_hash: string;
  transaction_lt: string;
  transaction_now: number;
  source: string; // raw "0:hex" owner address of the sender
  destination: string;
  amount: string; // units as decimal string
  jetton_master: string;
  forward_payload?: string | null; // base64 BOC; a text comment is a cell: 0x00000000 + UTF-8
  comment?: string | null; // some toncenter deployments expose the decoded comment
}

/** Best-effort decode of a plain text comment from a forward_payload BOC. Returns null if not a simple comment. */
export function decodeComment(forwardPayloadB64: string | null | undefined): string | null {
  if (!forwardPayloadB64) return null;
  try {
    const bytes = Uint8Array.from(atob(forwardPayloadB64), (c) => c.charCodeAt(0));
    // Serialized BOC: magic(4) flags(1) off_bytes(1) cells(…) roots(…) absent(…) tot_cells_size(…) root_list(…) [index] cell_data
    if (bytes.length < 10 || bytes[0] !== 0xb5 || bytes[1] !== 0xee || bytes[2] !== 0x9c || bytes[3] !== 0x72) return null;
    const flags = bytes[4];
    const refSize = flags & 0b111;
    const hasIndex = (flags & 0b10000000) !== 0;
    const offBytes = bytes[5];
    let p = 6;
    const readN = (n: number) => {
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + bytes[p++];
      return v;
    };
    const cells = readN(refSize);
    const roots = readN(refSize);
    readN(refSize); // absent
    readN(offBytes); // total cell size
    p += roots * refSize; // root list
    if (hasIndex) p += cells * offBytes;
    // First cell descriptor
    p++; // d1: refs/level descriptor, unused
    const d2 = bytes[p++];
    const dataLen = Math.ceil(d2 / 2);
    const data = bytes.slice(p, p + dataLen);
    if (data.length < 4) return null;
    const op = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
    if (op !== 0) return null; // 0x00000000 = text comment
    let text = data.slice(4);
    // A text comment is byte-aligned, so d2 is even. An odd d2 means the last byte carries padding bits.
    if (d2 % 2 === 1 && text.length) text = text.slice(0, -1);
    return new TextDecoder().decode(text).replace(/\0+$/, "").trim() || null;
  } catch {
    return null;
  }
}

export async function scanTon(
  apiKey: string,
  cursor: string | null,
): Promise<{ transfers: IncomingTransfer[]; cursor: string | null }> {
  const cfg = CHAINS.ton;
  const url = new URL("https://toncenter.com/api/v3/jetton/transfers");
  url.searchParams.set("owner_address", cfg.receiver);
  url.searchParams.set("jetton_master", cfg.tokenAddress);
  url.searchParams.set("direction", "in");
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "desc");
  const res = await fetch(url, { headers: apiKey ? { "X-API-Key": apiKey } : {} });
  if (!res.ok) throw new Error(`toncenter http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { jetton_transfers: JettonTransfer[] };
  const list = json.jetton_transfers ?? [];
  // Cursor states: null = never ran; "0" = ran with no history, process everything that appears; else = newest lt processed.
  if (list.length === 0) return { transfers: [], cursor: cursor ?? "0" };

  const newestLt = list.reduce((m, t) => (BigInt(t.transaction_lt) > BigInt(m) ? t.transaction_lt : m), "0");
  if (cursor === null) return { transfers: [], cursor: newestLt }; // first run with existing history: skip the past

  const fresh = list.filter((t) => BigInt(t.transaction_lt) > BigInt(cursor)).reverse(); // oldest first
  const transfers: IncomingTransfer[] = [];
  for (const t of fresh) {
    const amount = BigInt(t.amount);
    if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    transfers.push({
      chain: "ton",
      txHash: t.transaction_hash,
      logIndex: 0,
      from: t.source ?? null,
      amountUnits: Number(amount),
      memo: t.comment ?? decodeComment(t.forward_payload),
    });
  }
  return { transfers, cursor: newestLt };
}
