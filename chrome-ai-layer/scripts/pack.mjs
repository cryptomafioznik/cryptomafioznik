// Builds dist/ai-chat-layer.zip for the Chrome Web Store, with the checkout URL baked into options.js.
// Usage: node scripts/pack.mjs [checkoutUrl]
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const checkoutUrl = process.argv[2] ?? process.env.CHECKOUT_URL ?? "";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/pkg", { recursive: true });
for (const f of ["manifest.json", "popup.html", "popup.js", "options.html", "options.js", "src", "icons"]) cpSync(f, `dist/pkg/${f}`, { recursive: true });
for (const f of ["dist/pkg/options.js", "dist/pkg/src/content.js"]) {
  const src = readFileSync(f, "utf8").replace('const DEFAULT_CHECKOUT = "";', `const DEFAULT_CHECKOUT = ${JSON.stringify(checkoutUrl)};`);
  writeFileSync(f, src);
}
execSync("cd dist/pkg && zip -qr ../ai-chat-layer.zip .", { stdio: "inherit" });
console.log(`dist/ai-chat-layer.zip ready (checkout ${JSON.stringify(checkoutUrl)})`);

// Firefox build: same code, manifest adjusted for Gecko (addons.mozilla.org has no developer fee).
const m = JSON.parse(readFileSync("dist/pkg/manifest.json", "utf8"));
m.browser_specific_settings = { gecko: { id: "ai-chat-layer@kaushynskyi.dev", strict_min_version: "115.0" } };
m.options_ui = { page: "options.html", open_in_tab: true };
delete m.options_page;
mkdirSync("dist/firefox", { recursive: true });
cpSync("dist/pkg", "dist/firefox", { recursive: true });
writeFileSync("dist/firefox/manifest.json", JSON.stringify(m, null, 2));
execSync("cd dist/firefox && zip -qr ../ai-chat-layer-firefox.zip .", { stdio: "inherit" });
console.log("dist/ai-chat-layer-firefox.zip ready");
