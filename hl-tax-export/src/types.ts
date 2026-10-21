// Raw shapes returned by the Hyperliquid info API (https://api.hyperliquid.xyz/info).
// Numbers come back as strings; we keep them as strings until conversion to avoid float surprises.

export interface HlFill {
  coin: string; // perp: "ETH"; spot: "PURR/USDC" or "@142"
  px: string;
  sz: string;
  side: "B" | "A"; // B = buy/bid, A = sell/ask
  time: number; // ms
  startPosition: string;
  dir: string; // "Open Long", "Close Short", "Buy", "Sell", "Long > Short", ...
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  feeToken: string; // "USDC" or a spot token
  tid: number;
  builderFee?: string;
}

export interface HlFundingEntry {
  time: number;
  hash: string;
  delta: {
    type: "funding";
    coin: string;
    usdc: string; // positive = received, negative = paid
    szi: string;
    fundingRate: string;
    nSamples: number;
  };
}

export type HlLedgerDelta =
  | { type: "deposit"; usdc: string }
  | { type: "withdraw"; usdc: string; nonce: number; fee: string }
  | { type: "internalTransfer"; usdc: string; user: string; destination: string; fee: string }
  | { type: "subAccountTransfer"; usdc: string; user: string; destination: string }
  | { type: "accountClassTransfer"; usdc: string; toPerp: boolean }
  | { type: "spotTransfer"; token: string; amount: string; usdcValue: string; user: string; destination: string; fee: string }
  | { type: "liquidation"; liquidatedPositions?: Array<{ coin: string; szi: string }>; accountValue?: string; leverageType?: string }
  | { type: "vaultDeposit" | "vaultWithdraw" | "vaultCreate"; vault: string; usdc: string }
  | { type: string; [k: string]: unknown };

export interface HlLedgerEntry {
  time: number;
  hash: string;
  delta: HlLedgerDelta;
}

export interface HlSpotMeta {
  tokens: Array<{ name: string; index: number; szDecimals: number }>;
  universe: Array<{ name: string; tokens: [number, number]; index: number }>;
}

// Polymarket data API (https://data-api.polymarket.com/trades?user=...)
export interface PmTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string; // outcome token id
  conditionId: string;
  size: number; // shares
  price: number; // USDC per share
  timestamp: number; // seconds
  title?: string;
  slug?: string;
  outcome?: string;
  transactionHash?: string;
}

// Normalized event, the single shape every exporter consumes.
export type EventKind =
  | "perp_open"
  | "perp_close"
  | "spot_buy"
  | "spot_sell"
  | "funding"
  | "deposit"
  | "withdraw"
  | "transfer_in"
  | "transfer_out"
  | "liquidation"
  | "pm_buy"
  | "pm_sell";

export interface TaxEvent {
  venue: "hyperliquid" | "polymarket";
  kind: EventKind;
  timeMs: number;
  asset: string; // ETH, PURR, "Will X happen? / Yes"
  size: number; // absolute size in asset units
  price: number; // USDC per unit
  pnlUsdc: number; // realized PnL, 0 if not a close
  feeUsdc: number; // fee in USDC terms (>= 0)
  feeToken: string;
  amountUsdc: number; // cash movement for deposits/withdrawals/funding, signed (+ in, - out)
  hash: string;
  note: string;
}
