# hl-whale-bot

Telegram bot that follows Hyperliquid wallets and sends an alert when a followed wallet opens, closes, adds to, cuts or flips a perp position. Free tier follows 3 wallets; Pro (paid in Telegram Stars) follows 25. Every message carries a link to the tax exporter, so the bot is the free top of that funnel.

Commands: `/follow 0x… [name]`, `/unfollow`, `/list`, `/positions 0x…`, `/threshold 50000`, `/pro`.

## How it works

- Webhook worker handles commands and Stars payments (`sendInvoice` with currency `XTR`, `pre_checkout_query`, `successful_payment`).
- A cron runs every minute, takes the least recently checked followed wallets (30 per run on the free Workers plan, configurable), reads `clearinghouseState` from the public Hyperliquid API, diffs against the stored snapshot and sends alerts to followers above their threshold.
- D1 stores users, follows, wallet snapshots, payments and an alert log.

With 30 wallets per run, each wallet is checked every `ceil(followed_wallets / 30)` minutes. The paid Workers plan ($5/month) lifts subrequests to 1 000 per run; set `WALLETS_PER_RUN = "400"`.

## Growth engine: the public channel

Set `CHANNEL` in `wrangler.toml` to a public channel (for example `@hlwhalemoves`) where the bot is an admin, and `BOT_USERNAME` to the bot's handle. Then open `/seed?token=<ADMIN_TOKEN>` once: the bot pulls the Hyperliquid leaderboard, follows the top 40 wallets by monthly PnL on behalf of the channel, and from then on posts every move above `CHANNEL_MIN_USD` with a Hypurrscan link and a "Follow any wallet: @bot" footer. The list refreshes itself every Monday. The channel is discoverable in Telegram search and spreads by forwards; it costs nothing to run and needs no posting by a human.

## Setup

1. Create the bot with @BotFather in Telegram: `/newbot`, copy the token. This is the only step that cannot be automated.
2. GitHub repo → Settings → Secrets and variables → Actions: `TELEGRAM_BOT_TOKEN`. The Cloudflare secrets and `ADMIN_TOKEN` are shared with the checkout workflow; `WEBHOOK_SECRET` is generated automatically.
3. Push. The workflow creates the D1 database, applies the schema, deploys, and registers the webhook by calling `/setup`.
4. Optional growth engine: create a public channel, add the bot as admin, set `CHANNEL` and `BOT_USERNAME`, push, open `/seed?token=…` once.

Manual alternative: `npm install`, `wrangler d1 create whalebot`, paste the id into `wrangler.toml`, `npm run db:init`, `wrangler secret put` for `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_TOKEN`, then `npm run deploy` and open `https://<worker>/setup?token=<ADMIN_TOKEN>` once.

## Stars payouts

Stars accumulate on the bot owner's account. Withdraw via Fragment after a 21-day hold, 1 000 Stars minimum, with Fragment's identity check. Telegram pays about $0.013 per Star. 150 Stars for 30 days is therefore about $2 net per Pro user per month; raise `PRO_PRICE_STARS` once the bot has traction.

## Development

```bash
npm test          # snapshot diff and message formatting
npm run typecheck
```
