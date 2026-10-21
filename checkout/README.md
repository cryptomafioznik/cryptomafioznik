# crypto-checkout

Non-custodial stablecoin checkout on Cloudflare Workers. Buyers pay USDC on Base, USDC on Solana or USDT on TON straight to your own wallets. A cron-driven watcher reads the chains, matches payments to invoices by exact amount (and memo where the wallet supports it), issues HMAC-signed license keys and emails a receipt. No payment processor, no custody, no KYC, no monthly fee on the free tiers.

## How a payment flows

1. Buyer opens `/buy/<product>`, enters email, picks a network.
2. Server creates an invoice with a unique amount: price + 1..99 cents that no other open invoice on that chain uses. Amount is reserved for 1 hour and still accepted for 24 hours after.
3. `/pay/<id>` shows the amount, address, QR and a deep link (Solana Pay, `ton://transfer`, EIP-681). The page polls every 5 seconds.
4. Every minute the cron scans new blocks/signatures/jetton transfers to the receive addresses, records each transfer, and settles the matching invoice: license key, `licenses` row, receipt email via Resend.
5. Unmatched transfers (wrong amount, other network, tips) are listed in `/admin` for manual settlement.

Products call `GET /api/license/verify?key=...` to validate keys; revoke by setting `revoked_at` in D1.

## Deploy, automatic (recommended)

A GitHub Actions workflow (`.github/workflows/deploy-checkout.yml`) deploys on every push that touches `checkout/`. One-time setup in the GitHub repo under Settings → Secrets and variables → Actions:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → template "Edit Cloudflare Workers", add "D1: Edit" |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages, right column |
| `ADMIN_TOKEN` | any long random string, the password for `/admin` |
| `RESEND_API_KEY` | optional, enables receipt emails |

The workflow creates the D1 database, applies the schema, generates the license signing secret once, uploads the secrets and deploys. The worker URL is printed at the end of the run. Email is optional: without Resend, the license key is shown on the `/pay/<id>` page, which the buyer can reopen any time.

## Deploy, manual (about 20 minutes)

Prerequisites: Cloudflare account, optionally a Resend account with a verified sending domain, Node 20+.

```bash
npm install
npx wrangler login
npx wrangler d1 create checkout          # paste database_id into wrangler.toml
npm run db:init                          # creates tables
npx wrangler secret put LICENSE_SECRET   # e.g. openssl rand -hex 32
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ADMIN_TOKEN      # any long random string
# edit [vars] in wrangler.toml: PUBLIC_URL, EMAIL_FROM, optional TONCENTER_API_KEY and a dedicated BASE_RPC_URL
npm run deploy
```

Then open `https://<worker>/admin?token=<ADMIN_TOKEN>&run=1` once. The first watcher run only records the current chain positions and processes nothing, so old transfers are never charged to new invoices. From the next minute on, payments are detected.

Custom domain: Workers → Settings → Domains & Routes → add `pay.yourdomain.com`, then set `PUBLIC_URL` accordingly and redeploy.

## Before taking real money

- Verify the three token contract addresses in `src/config.ts` against Circle (USDC) and Tether (USDT on TON). They are the canonical mainnet addresses as of writing, but confirm.
- Send yourself one small test payment on each chain and watch it settle in `/admin`.
- The public Base and Solana RPCs are rate limited. For steady volume, put a free Alchemy/Helius/QuickNode endpoint into `BASE_RPC_URL` / `SOLANA_RPC_URL`.
- toncenter without an API key allows 1 request/second; the watcher makes 1 per minute, which is fine. Get a free key from @tonapibot if you add more workers.
- Receipts come from Resend's free tier (3 000 emails/month). Until `RESEND_API_KEY` is set, paid invoices stay marked `email_error` and are retried every minute, and the `/pay/<id>` page still shows the license.

## Testing a deployment without spending crypto

`/admin?token=…` has a **simulate** button next to every pending invoice (or `POST /admin/simulate?token=…&invoice=<id>`). It settles the invoice as if an exact-amount transfer had arrived: license issued, receipt sent, pay page flips to Paid. Use it once per product after deploy, then do one real small payment per chain.

## Services intake

Products with `delivery: { kind: "intake", fields: [...] }` get a form at `/intake/<product>`; the paid page and the receipt link to it, answers show up at the bottom of `/admin`. No external form tool needed.

## Email list

`POST /api/subscribe` with `{ "email", "source" }` (CORS open) stores addresses for launch notices; export at `/admin/subscribers.csv?token=…`.

## Products

Edit `PRODUCTS` in `src/config.ts`. Two delivery kinds:

- `license`: a key like `HLTAXE-K7M2-P9Q4-RS6T-W3X8`, lifetime (`days: null`) or time-limited.
- `link`: an access URL sent in the receipt (intake form, download, calendar).

Prices are whole USD; all three stablecoins are treated as 1 USD.

## Embedding in another site

`POST /api/invoice` with JSON `{ "product_id", "email", "chain" }` returns `{ id, url, address, amount, token, expires_at }`. Redirect the buyer to `url`, or render your own page and poll `GET /api/invoice/:id`.

## Limits and known trade-offs

- Matching by exact amount means at most 99 concurrent open invoices per price per chain. Fine for a solo store; for more, add a second receive address per chain.
- Subscriptions are not automatic on-chain. Sell prepaid periods (`days: 90 / 365`) and let the product re-verify the key.
- A buyer who rounds the amount or pays from an exchange that deducts a fee shows up under "Unmatched transfers". Settle by hand: insert the license and update the invoice, or refund.
- TON comments are decoded from the forward payload on a best-effort basis; matching falls back to the amount.

## Development

```bash
npm test          # pure-function tests (amounts, license keys, TON comment decoding)
npm run typecheck
npm run dev       # local worker; use `npm run db:init:local` first
```
