// Renders Chrome Web Store screenshots (1280x800) of the panel on a ChatGPT-like fixture page.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright/index.js")); }
const src = (f) => readFileSync(f, "utf8");
mkdirSync("store-assets", { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
// Serve the fixture at chatgpt.com so the hostname adapter activates and the panel is injected.
const html = src("test/fixtures/chatgpt-like.html").replace("<body>", '<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;line-height:1.6">');
await p.route("https://chatgpt.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
await p.goto("https://chatgpt.com/c/demo");
await p.addScriptTag({ content: `window.chrome={runtime:{id:"demo"},storage:{local:{_d:{},async get(k){return {[k]:this._d[k]}},async set(o){Object.assign(this._d,o)}},onChanged:{addListener(){}}}};` });
await p.addStyleTag({ content: src("src/content.css") });
for (const f of ["src/adapters.js", "src/markdown.js", "src/store.js"]) await p.addScriptTag({ content: src(f) });
// Seed data through the model before the UI script loads, so the panel opens with content.
await p.evaluate(async () => {
  const { model, io } = window.AICL_STORE;
  let s = await io.load();
  s = model.addFolder(s, "Work"); s = model.addFolder(s, "Travel");
  s = model.saveConvo(s, { url: "https://chatgpt.com/c/1", title: "Q3 report outline", site: "chatgpt", folderId: s.folders[0].id });
  s = model.saveConvo(s, { url: "https://claude.ai/chat/2", title: "Refactor plan for the API", site: "claude", folderId: s.folders[0].id });
  s = model.saveConvo(s, { url: "https://gemini.google.com/app/3", title: "Prague 3-day itinerary", site: "gemini", folderId: s.folders[1].id });
  s = model.addPrompt(s, { title: "Summarize selection", body: "Summarize the following in 5 bullets:\n\n{{selection}}" });
  s = model.addPrompt(s, { title: "Explain like a senior engineer", body: "Explain this to a senior engineer, focus on trade-offs:" });
  s = model.addPrompt(s, { title: "Rewrite shorter", body: "Rewrite the text below at half the length, keep every fact:" });
  await io.save(s);
});
await p.addScriptTag({ content: src("src/content.js") });
await p.click("#aicl-toggle"); await p.waitForTimeout(300);
await p.screenshot({ path: "store-assets/1-folders.png" });
await p.click("#aicl-panel .aicl-tabs button:nth-child(2)"); await p.waitForTimeout(200);
await p.screenshot({ path: "store-assets/2-prompts.png" });
await p.click("#aicl-panel .aicl-tabs button:nth-child(3)"); await p.waitForTimeout(200);
await p.screenshot({ path: "store-assets/3-export.png" });
await b.close(); console.log("store-assets/*.png");
