// Data model on chrome.storage.local. Pure functions take/return plain objects so they can be unit-tested in Node.
(function (root) {
  const FREE = { folders: 3, prompts: 10 };

  const empty = () => ({ v: 1, folders: [], convos: [], prompts: [], license: { key: "", validUntil: 0, product: "" }, checkoutUrl: "" });

  const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const model = {
    FREE,
    empty,
    isPro: (s, now = Date.now()) => Boolean(s.license && s.license.validUntil > now),
    canAddFolder: (s) => model.isPro(s) || s.folders.length < FREE.folders,
    canAddPrompt: (s) => model.isPro(s) || s.prompts.length < FREE.prompts,

    addFolder(s, name) {
      name = String(name || "").trim().slice(0, 40);
      if (!name) throw new Error("Folder name is empty");
      if (!model.canAddFolder(s)) throw new Error(`Free plan: ${FREE.folders} folders. Pro removes the limit.`);
      if (s.folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new Error("Folder exists");
      const f = { id: id(), name, createdAt: Date.now() };
      return { ...s, folders: [...s.folders, f] };
    },
    renameFolder: (s, folderId, name) => ({ ...s, folders: s.folders.map((f) => (f.id === folderId ? { ...f, name: String(name).trim().slice(0, 40) || f.name } : f)) }),
    deleteFolder: (s, folderId) => ({ ...s, folders: s.folders.filter((f) => f.id !== folderId), convos: s.convos.filter((c) => c.folderId !== folderId) }),

    saveConvo(s, { url, title, site, folderId }) {
      if (!url) throw new Error("No conversation URL");
      const clean = url.split("#")[0];
      const existing = s.convos.find((c) => c.url === clean);
      const c = { id: existing ? existing.id : id(), url: clean, title: String(title || "Untitled").slice(0, 120), site, folderId, savedAt: Date.now() };
      return { ...s, convos: [...s.convos.filter((x) => x.url !== clean), c] };
    },
    removeConvo: (s, convoId) => ({ ...s, convos: s.convos.filter((c) => c.id !== convoId) }),
    convosIn: (s, folderId) => s.convos.filter((c) => c.folderId === folderId).sort((a, b) => b.savedAt - a.savedAt),

    addPrompt(s, { title, body }) {
      title = String(title || "").trim().slice(0, 60);
      body = String(body || "").trim();
      if (!title || !body) throw new Error("Prompt needs a title and text");
      if (!model.canAddPrompt(s)) throw new Error(`Free plan: ${FREE.prompts} prompts. Pro removes the limit.`);
      return { ...s, prompts: [...s.prompts, { id: id(), title, body, createdAt: Date.now(), uses: 0 }] };
    },
    updatePrompt: (s, promptId, patch) => ({ ...s, prompts: s.prompts.map((p) => (p.id === promptId ? { ...p, ...patch } : p)) }),
    deletePrompt: (s, promptId) => ({ ...s, prompts: s.prompts.filter((p) => p.id !== promptId) }),
    bumpPrompt: (s, promptId) => model.updatePrompt(s, promptId, { uses: (s.prompts.find((p) => p.id === promptId)?.uses || 0) + 1 }),

    exportJson: (s) => JSON.stringify({ v: s.v, folders: s.folders, convos: s.convos, prompts: s.prompts }, null, 2),
    importJson(s, json) {
      const d = JSON.parse(json);
      if (!d || !Array.isArray(d.folders) || !Array.isArray(d.convos) || !Array.isArray(d.prompts)) throw new Error("Not an AI Chat Layer export");
      const folders = [...s.folders];
      for (const f of d.folders) if (!folders.some((x) => x.id === f.id || x.name === f.name)) folders.push(f);
      const convos = [...s.convos];
      for (const c of d.convos) if (!convos.some((x) => x.url === c.url)) convos.push(c);
      const prompts = [...s.prompts];
      for (const p of d.prompts) if (!prompts.some((x) => x.id === p.id || (x.title === p.title && x.body === p.body))) prompts.push(p);
      return { ...s, folders, convos, prompts };
    },
  };

  // Browser persistence (absent in Node tests).
  const storage = typeof chrome !== "undefined" && chrome.storage ? chrome.storage.local : null;
  const io = {
    async load() {
      if (!storage) return empty();
      const { aicl } = await storage.get("aicl");
      return { ...empty(), ...(aicl || {}) };
    },
    async save(s) {
      if (storage) await storage.set({ aicl: s });
      return s;
    },
  };

  root.AICL_STORE = { model, io };
})(typeof window !== "undefined" ? window : globalThis);
