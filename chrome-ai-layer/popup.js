chrome.storage.local.get("aicl").then(({ aicl }) => {
  const s = aicl || { folders: [], convos: [], prompts: [], license: { validUntil: 0 } };
  const pro = s.license && s.license.validUntil > Date.now();
  document.getElementById("stats").textContent = `${s.folders.length} folders · ${s.convos.length} saved chats · ${s.prompts.length} prompts · ${pro ? "Pro" : "Free"}`;
});
