# Launch checklist

Everything below the line is automatic. The owner's part is the five items at the top, each independent, each once.

## Owner, once

| # | What | Where | Result |
|---|---|---|---|
| 1 | Cloudflare account → API token (template "Edit Cloudflare Workers" + permission "D1: Edit") and Account ID | cloudflare.com → My Profile → API Tokens; Workers & Pages for the Account ID | secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| 2 | Pick a long random string as the admin password | anywhere | secret `ADMIN_TOKEN` |
| 3 | Telegram bot | @BotFather → `/newbot` → copy token. Also `/setuserpic`, `/setdescription` ("Alerts when Hyperliquid wallets open, close or change positions. /top to follow the leaderboard.") | secret `TELEGRAM_BOT_TOKEN`; tell Claude the bot username |
| 4 | Public Telegram channel, e.g. "Hyperliquid Whale Moves", add the bot as admin with "Post messages" | Telegram → New channel → Public → Administrators | tell Claude the channel @name |
| 5 | Chrome Web Store developer account ($5, identity check) | https://chrome.google.com/webstore/devconsole | needed only to upload the extension zip |

Secrets go to GitHub: repository → Settings → Secrets and variables → Actions → New repository secret. Optional: `RESEND_API_KEY` (receipt emails), `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` (bot cross-posts big moves to X).

## Automatic after that

1. Push any change (or re-run the workflows from the Actions tab). `deploy checkout` creates the D1 database, applies the schema, generates the license signing key, deploys. `deploy hl-tax-export web` builds and publishes the exporter and guides to Cloudflare Pages. `deploy hl-whale-bot` deploys the bot and registers the webhook.
2. Claude sets the repo variable `CHECKOUT_URL` to the checkout worker URL and `CHANNEL` / `BOT_USERNAME` in `hl-whale-bot/wrangler.toml`, pushes, and opens `/seed?token=…` once so the channel starts posting.
3. Claude verifies each product with the checkout's **simulate** button, then one real payment per chain is the only money spent.
4. Claude packs the extension with the real checkout URL (`npm run pack -- <url>`); the owner uploads `chrome-ai-layer/dist/ai-chat-layer.zip`, pastes `STORE_LISTING.md`, attaches `store-assets/*.png`.
5. The weekly routine keeps writing reply drafts into `marketing/drafts/`; the owner pastes the ones that fit.

## What runs without anyone

- Checkout watcher: every minute, three chains.
- Bot: position checks every minute, channel posts, daily digest 07:05 UTC, leaderboard refresh Mondays, X cross-posts if keys exist.
- Pages and guides: indexed by Google, sitemap submitted once the domain is in Search Console (owner's Google account, optional).
- Weekly reply drafts: Mondays 06:57 Prague.

## Where to look

- Checkout admin: `<checkout url>/admin?token=<ADMIN_TOKEN>` (invoices, unmatched transfers, intake forms, email list CSV).
- Bot stats: `<bot url>/stats?token=<ADMIN_TOKEN>`.
- Workflow runs: GitHub → Actions.
