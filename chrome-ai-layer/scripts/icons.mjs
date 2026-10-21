// Renders icons/16.png, 48.png, 128.png from an inline SVG with headless Chromium (preinstalled for Playwright).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/opt/node-tools/node_modules/playwright/index.js"));
}
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 128 128">
<rect width="128" height="128" rx="28" fill="#111"/>
<text x="64" y="84" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" font-size="58" font-weight="700" fill="#fff" text-anchor="middle">AI</text>
<rect x="22" y="98" width="84" height="8" rx="4" fill="#4ade80"/>
</svg>`;
mkdirSync("icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const s of [16, 48, 128]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(s)}</body></html>`);
  await page.screenshot({ path: `icons/${s}.png`, omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await browser.close();
console.log("icons written");
