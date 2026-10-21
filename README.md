# Monorepo

Products built to be found organically and paid for without a payment processor.

| Folder | What it is | Status |
|---|---|---|
| `checkout/` | Non-custodial stablecoin checkout on Cloudflare Workers: USDC on Base and Solana, USDT on TON. Watcher, license keys, receipts. Shared by every product below. | ready to deploy |
| `hl-tax-export/` | Hyperliquid and Polymarket trade, funding and PnL export for Koinly, Awaken and CSV. Sold per tax year through `checkout/`. | CLI ready, web UI next |
| `hl-whale-bot/` | Telegram bot with Hyperliquid large-position and liquidation alerts. Free tier plus Stars. Top of the funnel for `hl-tax-export/`. | planned |
| `chrome-ai-layer/` | Chrome extension: folders, export and prompt library for ChatGPT, Claude and Gemini web UIs. | planned |

Each folder is self-contained with its own README and can be split into its own repository later with `git subtree split`.
