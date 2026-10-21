// Pure logic: parse Hyperliquid clearinghouseState, diff two snapshots, format alerts.

export interface Position {
  coin: string;
  szi: number; // signed size, + long / - short
  entryPx: number;
  positionValue: number; // USD notional (abs)
  unrealizedPnl: number;
  leverage: number;
  liquidationPx: number | null;
}

export type Snapshot = Record<string, Position>; // by coin

export interface ClearinghouseState {
  marginSummary?: { accountValue: string };
  assetPositions: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string | null;
      positionValue: string;
      unrealizedPnl: string;
      leverage: { type: string; value: number };
      liquidationPx: string | null;
    };
  }>;
}

export function parseState(s: ClearinghouseState): Snapshot {
  const out: Snapshot = {};
  for (const ap of s.assetPositions ?? []) {
    const p = ap.position;
    const szi = Number(p.szi);
    if (!szi) continue;
    out[p.coin] = {
      coin: p.coin,
      szi,
      entryPx: Number(p.entryPx ?? 0),
      positionValue: Math.abs(Number(p.positionValue)),
      unrealizedPnl: Number(p.unrealizedPnl),
      leverage: Number(p.leverage?.value ?? 0),
      liquidationPx: p.liquidationPx === null || p.liquidationPx === undefined ? null : Number(p.liquidationPx),
    };
  }
  return out;
}

export type ChangeKind = "opened" | "closed" | "increased" | "decreased" | "flipped";

export interface Change {
  kind: ChangeKind;
  coin: string;
  before: Position | null;
  after: Position | null;
  deltaUsd: number; // absolute notional change
}

const SMALL = 0.02; // ignore size drift under 2% (funding, partial fills of the same order)

export function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = [];
  const coins = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const coin of coins) {
    const b = before[coin] ?? null;
    const a = after[coin] ?? null;
    if (!b && a) changes.push({ kind: "opened", coin, before: b, after: a, deltaUsd: a.positionValue });
    else if (b && !a) changes.push({ kind: "closed", coin, before: b, after: a, deltaUsd: b.positionValue });
    else if (b && a) {
      if (Math.sign(b.szi) !== Math.sign(a.szi)) changes.push({ kind: "flipped", coin, before: b, after: a, deltaUsd: b.positionValue + a.positionValue });
      else {
        const rel = Math.abs(a.szi - b.szi) / Math.abs(b.szi);
        if (rel < SMALL) continue;
        // Notional change at current price: size delta × (positionValue / size)
        const px = a.positionValue / Math.abs(a.szi);
        const deltaUsd = Math.abs(a.szi - b.szi) * px;
        changes.push({ kind: Math.abs(a.szi) > Math.abs(b.szi) ? "increased" : "decreased", coin, before: b, after: a, deltaUsd });
      }
    }
  }
  changes.sort((x, y) => y.deltaUsd - x.deltaUsd);
  return changes;
}

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const side = (p: Position) => (p.szi > 0 ? "LONG" : "SHORT");
const px = (n: number) => (n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));

export function formatChange(label: string, wallet: string, c: Change): string {
  const w = label ? `${label} (${wallet.slice(0, 6)}…${wallet.slice(-4)})` : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const a = c.after,
    b = c.before;
  switch (c.kind) {
    case "opened":
      return `🟢 ${w} opened ${side(a!)} ${c.coin}\n${usd(a!.positionValue)} · ${a!.leverage}x · entry ${px(a!.entryPx)}${a!.liquidationPx ? ` · liq ${px(a!.liquidationPx)}` : ""}`;
    case "closed":
      return `⚪️ ${w} closed ${side(b!)} ${c.coin}\n${usd(b!.positionValue)} · entry ${px(b!.entryPx)} · uPnL at last check ${b!.unrealizedPnl >= 0 ? "+" : ""}${usd(Math.abs(b!.unrealizedPnl)).replace("$", "$")}`;
    case "flipped":
      return `🔄 ${w} flipped ${c.coin}: ${side(b!)} ${usd(b!.positionValue)} → ${side(a!)} ${usd(a!.positionValue)}\n${a!.leverage}x · entry ${px(a!.entryPx)}`;
    case "increased":
      return `➕ ${w} added ${usd(c.deltaUsd)} to ${side(a!)} ${c.coin}\nnow ${usd(a!.positionValue)} · ${a!.leverage}x · entry ${px(a!.entryPx)}`;
    case "decreased":
      return `➖ ${w} cut ${side(a!)} ${c.coin} by ${usd(c.deltaUsd)}\nnow ${usd(a!.positionValue)} · uPnL ${a!.unrealizedPnl >= 0 ? "+" : "-"}${usd(Math.abs(a!.unrealizedPnl))}`;
  }
}

export function formatPositions(label: string, wallet: string, snap: Snapshot): string {
  const list = Object.values(snap).sort((x, y) => y.positionValue - x.positionValue);
  const head = `${label || wallet.slice(0, 6) + "…" + wallet.slice(-4)}`;
  if (list.length === 0) return `${head}: no open positions`;
  return `${head}\n` + list.map((p) => `${side(p)} ${p.coin} ${usd(p.positionValue)} ${p.leverage}x · entry ${px(p.entryPx)} · uPnL ${p.unrealizedPnl >= 0 ? "+" : "-"}${usd(Math.abs(p.unrealizedPnl))}`).join("\n");
}

export function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}
