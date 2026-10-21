// Bundles web/app.ts into dist/ with the checkout URL injected. Usage: node build-web.mjs [checkoutUrl]
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync } from "node:fs";

const checkoutUrl = process.argv[2] ?? process.env.CHECKOUT_URL ?? "";
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["web/app.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022"],
  outfile: "dist/app.js",
  define: { CHECKOUT_URL: JSON.stringify(checkoutUrl) },
});
for (const f of readdirSync("web")) if (!f.endsWith(".ts")) cpSync(`web/${f}`, `dist/${f}`);
console.log(`built dist/ with CHECKOUT_URL=${JSON.stringify(checkoutUrl)}`);
