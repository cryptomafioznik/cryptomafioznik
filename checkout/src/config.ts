// Static configuration: receiving wallets, token contracts, products.
// Wallet addresses are public receive addresses. No private keys exist anywhere in this project.

export type ChainId = "base" | "solana" | "ton";

export interface ChainConfig {
  id: ChainId;
  label: string;
  token: string; // display symbol
  decimals: number;
  receiver: string; // our receive address
  tokenAddress: string; // ERC-20 contract / SPL mint / jetton master
  confirmations: number;
  explorerTx: (hash: string) => string;
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  base: {
    id: "base",
    label: "USDC on Base",
    token: "USDC",
    decimals: 6,
    receiver: "0xc8569245f529d02491482378e05AFe792a14A83B",
    // Native USDC on Base (Circle). Verify at https://www.circle.com/multi-chain-usdc before deploy.
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    confirmations: 3,
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
  },
  solana: {
    id: "solana",
    label: "USDC on Solana",
    token: "USDC",
    decimals: 6,
    receiver: "Hjw5u2rqvfGcogmcbYRYrLGJvdECMXtaV34JEPFuWk9Q",
    // USDC mint on Solana mainnet (Circle). Verify before deploy.
    tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    confirmations: 1, // we only read finalized transactions
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
  },
  ton: {
    id: "ton",
    label: "USDT on TON",
    token: "USDT",
    decimals: 6,
    receiver: "UQD7Yob1Vbor0ePSISVILwO1ROQy5p_AlDWS-8KFL-_TDUsM",
    // Tether USDT jetton master on TON. Verify at https://tether.to/en/supported-protocols before deploy.
    tokenAddress: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    confirmations: 1,
    explorerTx: (h) => `https://tonviewer.com/transaction/${h}`,
  },
};

export type Delivery =
  | { kind: "license"; days: number | null } // license key, null = lifetime
  | { kind: "link"; url: string } // a download / access link sent by email
  | { kind: "intake"; fields: string[] }; // a form hosted by this worker at /intake/<product>, answers land in /admin

export interface Product {
  id: string;
  name: string;
  description: string;
  priceUsd: number; // whole USD, e.g. 29
  delivery: Delivery;
  active: boolean;
}

// Edit this list to sell things. Price is in USD; all three tokens are treated as 1 USD.
export const PRODUCTS: Product[] = [
  {
    id: "hl-tax-export-2026",
    name: "Hyperliquid & Polymarket Tax Export — tax year 2026",
    description:
      "Unlimited exports of trades, funding and PnL for one tax year, formatted for Koinly, Awaken and CSV.",
    priceUsd: 39,
    delivery: { kind: "license", days: null },
    active: true,
  },
  {
    id: "chrome-ai-layer-pro",
    name: "AI Chat Layer Pro (Chrome extension), lifetime",
    description: "Unlimited folders and prompts for ChatGPT, Claude and Gemini. One key for all your browsers. Activate in the extension options.",
    priceUsd: 19,
    delivery: { kind: "license", days: null },
    active: true,
  },
  {
    id: "app-in-7-days",
    name: "iOS app from idea to App Store in 7 days",
    description: "Native SwiftUI app up to 5 screens, App Store listing, submission under your account, source in your GitHub. Scope call within 24 hours of payment.",
    priceUsd: 1500,
    delivery: { kind: "intake", fields: ["What the app should do (3-5 sentences)", "Apple developer account: yes / no / need help", "Links to similar apps or sketches", "Deadline or launch date"] },
    active: true,
  },
  {
    id: "aso-audit",
    name: "App Store page audit & localization",
    description: "Written audit of your App Store listing plus metadata localized into 5 languages. Delivered in 5 business days.",
    priceUsd: 150,
    delivery: { kind: "intake", fields: ["App Store link", "Target countries", "Monthly downloads now (optional)", "Main competitor", "What you already tried"] },
    active: true,
  },
];

export const INVOICE_TTL_SECONDS = 60 * 60; // amount is reserved for 1 hour
export const LATE_PAYMENT_GRACE_SECONDS = 24 * 60 * 60; // still accept an exact-amount payment for 24 h after expiry

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id && p.active);
}

export function deliveryUrl(publicUrl: string, product: Product, invoiceId: string): string | undefined {
  if (product.delivery.kind === "link") return product.delivery.url;
  if (product.delivery.kind === "intake") return `${publicUrl}/intake/${product.id}?invoice=${invoiceId}`;
  return undefined;
}
