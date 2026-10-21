import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("/opt/node-tools/node_modules/playwright/index.js");
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
const dist = process.argv[2], fixture = JSON.parse(readFileSync(process.argv[3], "utf8"));
const srv = http.createServer((req, res) => {
  const f = req.url === "/" ? "index.html" : req.url.slice(1);
  try { res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : "text/html"); res.end(readFileSync(path.join(dist, f))); }
  catch { res.statusCode = 404; res.end(); }
}).listen(18090);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("https://api.hyperliquid.xyz/info", async (route) => {
  const q = JSON.parse(route.request().postData() || "{}");
  const pick = { spotMeta: fixture.spotMeta, userFillsByTime: fixture.fills, userFunding: fixture.funding, userNonFundingLedgerUpdates: fixture.ledger }[q.type] ?? [];
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pick) });
});
await page.goto("http://127.0.0.1:18090/");
await page.fill("#hl", "0xc8569245f529d02491482378e05AFe792a14A83B");
await page.selectOption("#year", "2026");
await page.click("#run");
await page.waitForFunction(() => document.querySelectorAll("#downloads a.dl").length === 3, null, { timeout: 15000 });
const summary = await page.textContent("#summary");
const log = await page.textContent("#log");
const links = await page.$$eval("#downloads a.dl", (as) => as.map((a) => a.textContent));
console.log("links:", links);
console.log("log tail:", log.trim().split("\n").slice(-2).join(" | "));
console.log("summary has TOTAL:", summary.includes("TOTAL"), "| page errors:", errors.length ? errors : "none");
await page.screenshot({ path: process.argv[4], fullPage: true });
await browser.close(); srv.close();
