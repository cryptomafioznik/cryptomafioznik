# AI Chat Layer (Chrome extension)

Folders, a prompt library and Markdown export for the ChatGPT, Claude and Gemini web apps. Everything is stored in the browser with `chrome.storage.local`; nothing is uploaded. Free: 3 folders, 10 prompts, unlimited exports. Pro: no limits, activated with a license key sold through `checkout/`.

- **Folders**: save the current conversation link into a folder, jump back to it from any of the three sites.
- **Prompts**: save prompts, search them, click to insert into the chat box. `{{selection}}` is replaced with the selected text.
- **Export**: the whole conversation as Markdown (headings, lists, code blocks with language, tables, links). Download or copy.
- Toggle with the `AI` button bottom-right or `Alt+A`.

## Files

| Path | Role |
|---|---|
| `src/adapters.js` | Per-site selectors for messages, input box and title. The only place that needs updating when a site redesigns. Falls back to a heuristic when selectors fail. |
| `src/markdown.js` | HTML → Markdown for chat messages. |
| `src/store.js` | Data model (pure functions, unit-tested in Node) and storage. |
| `src/content.js` | Sidebar UI. |
| `options.html/js` | License activation (verifies against the checkout), JSON backup and import. |
| `popup.html/js` | Stats and link to options. |

## Build and test

```bash
npm test             # model tests in Node + a Playwright test on a ChatGPT-like fixture page
npm run icons        # renders icons/*.png with headless Chromium
npm run pack -- https://your-checkout.workers.dev   # dist/ai-chat-layer.zip for the Web Store
```

Load unpacked for local testing: `chrome://extensions` → Developer mode → Load unpacked → this folder.

## Publishing

1. Chrome Web Store developer account: one-time $5 fee, identity verification. This cannot be automated.
2. Upload `dist/ai-chat-layer.zip`, fill the listing (see `STORE_LISTING.md`), set category Productivity, submit for review. First review takes 1–3 days.
3. After approval, add the product `chrome-ai-layer-pro` to `checkout/src/config.ts` with `delivery: { kind: "license", days: null }` and set the checkout URL at packaging time.

## Known limits

- Site DOMs change without notice. When export shows "No messages found", update the selectors in `src/adapters.js`.
- Prompt insertion uses `document.execCommand("insertText")` on contenteditable inputs; it works in current Chrome, which is the only target.
- Keyboard shortcut is global on the three sites; change it in `src/content.js` if it collides.
