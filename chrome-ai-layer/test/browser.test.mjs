// Loads the content scripts into a ChatGPT-like fixture page with a fake chrome.storage and checks
// message detection, Markdown export, prompt insertion and the free-plan limit end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  try {
    ({ chromium } = require("/opt/node-tools/node_modules/playwright/index.js"));
  } catch {
    chromium = null;
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(path.join(root, f), "utf8");

const FAKE_CHROME = `
  window.chrome = { storage: { local: {
    _d: {}, async get(k){ return { [k]: this._d[k] }; }, async set(o){ Object.assign(this._d, o); } },
    onChanged: { addListener(){} } } };
`;

test("content script on a ChatGPT-like page", { skip: !chromium && "playwright not available" }, async () => {
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setContent(src("test/fixtures/chatgpt-like.html"));
  await page.addScriptTag({ content: FAKE_CHROME });
  await page.addStyleTag({ content: src("src/content.css") });
  for (const f of ["src/adapters.js", "src/markdown.js", "src/store.js", "src/content.js"]) await page.addScriptTag({ content: src(f) });

  // The page is about:blank, so the hostname adapter does not match; use the ChatGPT selectors directly.
  const md = await page.evaluate(() => {
    const messages = [...document.querySelectorAll("[data-message-author-role]")].map((el) => ({ role: el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant", el }));
    return window.AICL_MD.conversationToMarkdown("Plan a trip", messages, "https://chatgpt.com/c/abc123");
  });
  assert.match(md, /^# Plan a trip/);
  assert.match(md, /## You\n\nPlan a 3 day trip to \*\*Prague\*\*\./);
  assert.match(md, /### Day 1/);
  assert.match(md, /\[castle\]\(https:\/\/example\.com\/castle\)/);
  assert.match(md, /- Charles Bridge\n- Old Town \*square\*\n  - Astronomical clock/);
  assert.match(md, /```python\nprint\("ahoj"\)\n```/);
  assert.match(md, /\| Item \| CZK \|\n\| --- \| --- \|\n\| Tram \| 40 \|/);
  assert.ok(!md.includes("Copy"), "buttons are dropped");

  // Prompt insertion into a contenteditable input.
  const inserted = await page.evaluate(() => {
    const el = document.querySelector("#prompt-textarea");
    window.AICL_ADAPTERS.insertIntoInput(el, "Hello {{x}}");
    return el.textContent;
  });
  assert.equal(inserted, "Hello {{x}}");

  // Free-plan limit through the model with the fake storage.
  const limitMsg = await page.evaluate(async () => {
    const { model, io } = window.AICL_STORE;
    let s = await io.load();
    for (let i = 0; i < model.FREE.folders; i++) s = model.addFolder(s, "f" + i);
    await io.save(s);
    try {
      model.addFolder(s, "extra");
      return "no error";
    } catch (e) {
      return e.message;
    }
  });
  assert.match(limitMsg, /Free plan/);
  assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
