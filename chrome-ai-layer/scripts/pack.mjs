// Builds dist/ai-chat-layer.zip for the Chrome Web Store, with the checkout URL baked into options.js.
// Usage: node scripts/pack.mjs [checkoutUrl]
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const checkoutUrl = process.argv[2] ?? process.env.CHECKOUT_URL ?? "";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/pkg", { recursive: true });
for (const f of ["manifest.json", "popup.html", "popup.js", "options.html", "options.js", "src", "icons"]) cpSync(f, `dist/pkg/${f}`, { recursive: true });
const opt = readFileSync("dist/pkg/options.js", "utf8").replace('const DEFAULT_CHECKOUT = "";', `const DEFAULT_CHECKOUT = ${JSON.stringify(checkoutUrl)};`);
writeFileSync("dist/pkg/options.js", opt);
execSync("cd dist/pkg && zip -qr ../ai-chat-layer.zip .", { stdio: "inherit" });
console.log(`dist/ai-chat-layer.zip ready (checkout ${JSON.stringify(checkoutUrl)})`);
