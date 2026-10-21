# hl-tax-export

Turn a Hyperliquid wallet (and optionally a Polymarket proxy wallet) into files a tax tool accepts: a Koinly universal CSV, a flat events CSV, and a reconciliation summary that shows realized PnL, fees and funding per asset so you can check the numbers before importing.

Why this exists: Koinly's own forum documents unmatched Hyperliquid history, perp closes modelled as asset disposals, and staked HYPE missing. Hourly funding creates thousands of rows per open position per year. Polymarket offers no export at all. This tool reads the public APIs directly, needs no API keys, and never touches your private keys.

## Usage

```bash
npm install
npm start -- --hl 0xYourHyperliquidWallet --year 2026 --out ./export
npm start -- --hl 0x... --pm 0xYourPolymarketProxyWallet --from 2026-01-01 --to 2026-06-30
npm start -- --hl 0x... --year 2026 --funding income/cost --fees inline --hourly-funding
```

Output files, named `<wallet>-<from>_<to>-*`:

| File | What |
|---|---|
| `*-koinly.csv` | Koinly universal CSV. Import at Koinly → Wallets → Add wallet → "Hyperliquid" (or a custom wallet) → Import from file. |
| `*-events.csv` | Every normalized event: fills, funding, deposits, withdrawals, transfers, Polymarket trades. For spreadsheets and other tax tools. |
| `*-summary.txt` / `.json` | Per-asset realized PnL, fees, funding and cash flows. Compare this to Hyperliquid's own PnL before trusting the import. |
| `*-raw.json` | Raw API responses (licensed exports only). |

Free preview: first 300 Koinly rows. A license key from the checkout removes the cap for one tax year; pass it with `--license KEY` or `HL_TAX_LICENSE=KEY`.

## How things are mapped

| Hyperliquid event | Koinly row | Label |
|---|---|---|
| Perp close with PnL > 0 | Received PnL USDC | `realized gain` |
| Perp close with PnL < 0 | Sent |PnL| USDC | `realized gain` (Koinly reads a sent realized-gain row as a loss) |
| Trading fee on any fill | Sent fee USDC | `cost` (or attached to the PnL row with `--fees inline`) |
| Funding received / paid | Received / Sent USDC, summed per day per asset | `realized gain` (or `income` / `cost` with `--funding income/cost`) |
| Deposit / withdrawal | Received / Sent USDC, withdrawal fee in the fee column | none, Koinly matches the transfer |
| Spot buy / sell | USDC ↔ token swap, fee valued in USDC | none |
| Spot fee charged in the base token | Valued at the fill price | |
| Perp ↔ spot, vault moves, sub-account moves | Not exported to Koinly (internal), present in events CSV | |
| Liquidation | PnL arrives via the liquidation fill's `closedPnl` | `realized gain` |
| Polymarket BUY / SELL | USDC ↔ `PM:<market>/<outcome>` swap | none |

`--hourly-funding` keeps every hourly funding payment as its own row (8 760 per position per year). The default sums them per UTC day per asset, which Koinly and most accountants prefer.

## Known gaps

- Polymarket redemptions (winning shares paid out at $1) and on-chain USDC deposits are not in the trades API. Import your Polygon wallet into Koinly alongside this file; the outcome tokens then resolve to USDC.
- Hyperliquid data API returns at most 2 000 fills per request; the tool pages by time and dedupes, but very active accounts with thousands of fills in the same millisecond are theoretically possible and would be flagged by a mismatch in the summary.
- Tax treatment of perps and prediction markets differs by country. The mapping above is the most common one used with Koinly; nothing here is tax advice.

## Development

```bash
npm test        # fixture-based tests for mapping, summary, CSV, pagination
npm run typecheck
```

Set `HL_TAX_LICENSE_API` to point license verification at your checkout deployment (`/api/license/verify`).
