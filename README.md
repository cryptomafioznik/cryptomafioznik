# Monorepo

Products built to be found organically and paid for without a payment processor.

| Folder | What it is | Status |
|---|---|---|
| `checkout/` | Non-custodial stablecoin checkout on Cloudflare Workers: USDC on Base and Solana, USDT on TON. Watcher, license keys, receipts. Shared by every product below. | ready, auto-deploys |
| `hl-tax-export/` | Hyperliquid and Polymarket trade, funding and PnL export for Koinly, Awaken and CSV. CLI plus a browser version that doubles as the SEO landing page. Sold per tax year through `checkout/`. | ready, auto-deploys |
| `hl-whale-bot/` | Telegram bot: follow Hyperliquid wallets, alerts on position changes. Free tier plus Stars. Top of the funnel for `hl-tax-export/`. | ready, auto-deploys |
| `chrome-ai-layer/` | Chrome extension: folders, prompt library and Markdown export for ChatGPT, Claude and Gemini. | ready to submit |

Each folder is self-contained with its own README and can be split into its own repository later with `git subtree split`.

## Deploy

GitHub Actions in `.github/workflows/` deploy on push. One-time setup, repo → Settings → Secrets and variables → Actions:

| Secret | Used by | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | all | Cloudflare → My Profile → API Tokens → Create → template "Edit Cloudflare Workers" + permission "D1: Edit" |
| `CLOUDFLARE_ACCOUNT_ID` | all | Cloudflare → Workers & Pages, right column |
| `ADMIN_TOKEN` | checkout, bot | any long random string |
| `TELEGRAM_BOT_TOKEN` | bot | @BotFather → /newbot |
| `RESEND_API_KEY` | checkout, optional | resend.com, enables receipt emails |

Variable `CHECKOUT_URL` (same screen, Variables tab) wires the exporter's buy button and the extension to the deployed checkout. Without secrets the workflows still run tests and skip the deploy.
