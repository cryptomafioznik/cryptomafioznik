// Renders web/og.png (1200x630) for social previews with headless Chromium.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright/index.js")); }
const html = `<html><body style="margin:0;width:1200px;height:630px;background:#0f0f10;color:#f2f2f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:72px;box-sizing:border-box">
<div style="font-size:26px;color:#a1a1aa;margin-bottom:18px">hl-tax-export.pages.dev</div>
<div style="font-size:64px;font-weight:700;line-height:1.1">Hyperliquid tax export<br>for Koinly</div>
<div style="font-size:30px;color:#a1a1aa;margin-top:26px">Perp trades · hourly funding summed per day · deposits · Polymarket</div>
<div style="margin-top:44px;font-size:28px;display:flex;gap:28px"><span style="background:#4ade80;color:#0f0f10;padding:10px 22px;border-radius:12px;font-weight:700">Free preview</span><span style="padding:10px 0">Runs in your browser, no API keys</span></div>
</body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html); await p.screenshot({ path: "web/og.png" }); await b.close(); console.log("web/og.png");
