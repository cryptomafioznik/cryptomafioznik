# Reply and post templates

Replace the bracketed parts. Keep the disclosure. One link per reply.

## Koinly forum: missing Hyperliquid history

> The sync misses this because Koinly models perp closes as disposals of the underlying, and funding arrives as thousands of tiny USDC rows. What worked for me: export the wallet to Koinly's universal CSV with every close as a realized gain/loss, fees as cost, and funding summed per day, then import it as a file instead of the sync. I built the exporter (free up to 300 rows, runs in the browser, no keys): [link to hyperliquid-koinly.html]. The mapping table is on that page if you want to build the CSV yourself.

## r/CryptoTax: "how do I report Hyperliquid perps"

> Perps aren't sales of ETH, they're contracts, so what you report is the realized PnL per close plus net funding and fees. Hyperliquid's API gives all three for any wallet. Practical steps: (1) pull fills, funding and ledger for the year, (2) sum funding per day, (3) feed your tax tool realized gains, not "sold 1 ETH". If you use Koinly, there's a guide with the exact label mapping [link]. Disclosure: I made the exporter on that page; the summary and the first 300 rows are free.

## r/Polymarket: "taxes?"

> Every buy or sell of outcome shares is a USDC swap on Polygon, so each one is a disposal. Polymarket doesn't export, but the data API is public: your proxy wallet's trades can be pulled and written as USDC ↔ "market/outcome" swaps for Koinly or a spreadsheet. Redemptions show up in your Polygon wallet. Guide + free exporter [link], mine.

## Hyperliquid Discord, one-time post (December)

> Built a free tax export for HL wallets because Koinly kept mangling my perps. It pulls fills, hourly funding and deposits for a tax year straight from the public API in your browser, sums funding per day, and writes a Koinly CSV plus a per-asset PnL summary. Free preview covers the summary and 300 rows. [link]. Happy to add formats people need.

## X replies (tax season)

- "Koinly + Hyperliquid = pain" → "Same. The fix was a CSV with closes as realized gains and funding per day instead of the sync. Free exporter + mapping here [link]"
- "how do you even do taxes on polymarket" → "Each trade is a USDC↔share swap. Public data API has them all; this pulls them into Koinly format [link]"

## Whale channel screenshot post (X / Telegram groups)

> [screenshot of the alert]
> Top-20 leaderboard wallet just flipped $4.2M ETH long → short at 3,110. The channel posts every move above $250K from the top 40 wallets, free: [channel link]

## r/ChatGPT: "how do you organize your chats"

> I ended up making a small extension: folders for ChatGPT/Claude/Gemini links, a prompt library you click to insert, and Markdown export that keeps code blocks and tables. Local only, no account. [store link]. Free tier is 3 folders and 10 prompts, which is enough for most people.

## r/ObsidianMD: "export ChatGPT to Obsidian"

> Markdown export with headings, lists, code fences with language and tables intact: [store link] (mine). Download the .md and drop it into your vault; the title becomes the note name.

## Product Hunt (extension, after reviews)

Tagline: Folders, prompts and Markdown export for ChatGPT, Claude and Gemini.
First comment: why it exists (lost threads, retyped prompts, exports that mangle code), what is free, what Pro costs, that it is local-only.

## Accountant outreach (email, tax export)

Subject: Hyperliquid perps for your clients: events CSV + per-asset summary
> Hi [name], you wrote about Hyperliquid taxes at [post]. I built an exporter that turns any HL wallet into a normalized events CSV (fills, hourly funding summed per day, deposits, liquidations) and a per-asset realized PnL summary, plus a Koinly file. If useful for your clients, I can add a white-label summary with your firm's name and a bulk mode. Free to try: [link].
