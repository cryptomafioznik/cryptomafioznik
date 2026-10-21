const $ = (id) => document.getElementById(id);
const DEFAULT_CHECKOUT = ""; // set at packaging time to the deployed checkout URL

async function load() {
  const { aicl } = await chrome.storage.local.get("aicl");
  return { v: 1, folders: [], convos: [], prompts: [], license: { key: "", validUntil: 0, product: "" }, checkoutUrl: DEFAULT_CHECKOUT, ...(aicl || {}) };
}
async function save(s) {
  await chrome.storage.local.set({ aicl: s });
}
function msg(text, err = false) {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg" + (err ? " err" : "");
  el.hidden = false;
}

load().then((s) => {
  $("checkout").value = s.checkoutUrl || DEFAULT_CHECKOUT;
  $("key").value = s.license.key || "";
  $("lic").textContent = s.license.validUntil > Date.now() ? `Pro until ${new Date(s.license.validUntil).toISOString().slice(0, 10)} (re-checked weekly)` : "Free plan";
});

$("activate").addEventListener("click", async () => {
  const s = await load();
  const checkoutUrl = $("checkout").value.trim().replace(/\/+$/, "");
  const key = $("key").value.trim().toUpperCase();
  if (!checkoutUrl || !key) return msg("Enter the checkout URL and your key", true);
  try {
    const r = await fetch(`${checkoutUrl}/api/license/verify?key=${encodeURIComponent(key)}`);
    const j = await r.json();
    if (!j.valid) return msg(`Key not accepted: ${j.reason || "unknown"}`, true);
    // Cache validity for 7 days (or until the license's own expiry), then re-verify.
    const week = Date.now() + 7 * 86400 * 1000;
    const validUntil = j.expires_at ? Math.min(week, j.expires_at * 1000) : week;
    await save({ ...s, checkoutUrl, license: { key, validUntil, product: j.product_id || "" } });
    $("lic").textContent = `Pro active (${j.product_id || "license"})`;
    msg("Pro activated.");
  } catch (e) {
    msg(`Verification failed: ${e.message}`, true);
  }
});

$("export").addEventListener("click", async () => {
  const s = await load();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ v: s.v, folders: s.folders, convos: s.convos, prompts: s.prompts }, null, 2)], { type: "application/json" }));
  a.download = `ai-chat-layer-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$("import").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", async () => {
  const f = $("file").files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const s = await load();
    const merged = { ...s, folders: [...s.folders, ...d.folders.filter((x) => !s.folders.some((y) => y.id === x.id || y.name === x.name))], convos: [...s.convos, ...d.convos.filter((x) => !s.convos.some((y) => y.url === x.url))], prompts: [...s.prompts, ...d.prompts.filter((x) => !s.prompts.some((y) => y.id === x.id))] };
    await save(merged);
    msg(`Imported: now ${merged.folders.length} folders, ${merged.convos.length} chats, ${merged.prompts.length} prompts.`);
  } catch (e) {
    msg(`Import failed: ${e.message}`, true);
  }
});
