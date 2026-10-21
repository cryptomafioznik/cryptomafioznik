# Weekly reply drafts

A scheduled Claude routine runs every Monday morning, searches the web for threads from the last 7 days where people ask about:

- Hyperliquid taxes, Koinly + Hyperliquid, Hyperliquid funding tax, Polymarket taxes or export
- Hyperliquid whale tracking, wallet alerts on Telegram
- organizing ChatGPT / Claude / Gemini chats, exporting chats to Markdown or Obsidian, prompt libraries
- construction daily report apps, change order apps, move-in inspection apps

and writes `YYYY-MM-DD.md` here with, for each thread: the link, the question in one line, a ready-to-paste reply following `../templates.md`, and a priority (high = buyer asking directly). The owner posts the ones that still make sense and marks them done in the file.

Threads already covered are tracked in `seen.json` so they are not drafted twice.
