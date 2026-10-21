// Sidebar UI: folders, prompts, export. Everything stays in chrome.storage.local.
(function () {
  const A = window.AICL_ADAPTERS;
  const MD = window.AICL_MD;
  const { model, io } = window.AICL_STORE;
  const adapter = A.current();
  if (!adapter || document.getElementById("aicl-toggle")) return;

  const DEFAULT_CHECKOUT = ""; // set at packaging time
  let state = { ...model.empty(), checkoutUrl: DEFAULT_CHECKOUT };
  let tab = "folders";
  let flash = null;

  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "html") el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };

  const toggle = h("button", { id: "aicl-toggle", title: "AI Chat Layer" }, "AI");
  const panel = h("div", { id: "aicl-panel", hidden: "" });
  document.body.append(toggle, panel);
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) render();
  });

  async function commit(next) {
    state = await io.save(next);
    render();
  }
  function say(text, err = false) {
    flash = { text, err };
    render();
    setTimeout(() => {
      flash = null;
      render();
    }, 2500);
  }
  function tryDo(fn) {
    try {
      const r = fn();
      if (r && r.then) r.catch((e) => say(e.message, true));
    } catch (e) {
      say(e.message, true);
    }
  }

  function render() {
    panel.replaceChildren(
      h(
        "div",
        { class: "aicl-tabs" },
        ...["folders", "prompts", "export"].map((t) => h("button", { class: t === tab ? "on" : "", onclick: () => ((tab = t), render()) }, t[0].toUpperCase() + t.slice(1))),
      ),
      h("div", { class: "aicl-body" }, flash ? h("div", { class: "aicl-msg" + (flash.err ? " err" : "") }, flash.text) : null, tab === "folders" ? foldersView() : tab === "prompts" ? promptsView() : exportView()),
    );
  }

  function foldersView() {
    const name = h("input", { placeholder: "New folder name" });
    const sel = h("select", {}, ...state.folders.map((f) => h("option", { value: f.id }, f.name)));
    const view = h(
      "div",
      {},
      h(
        "div",
        {},
        name,
        h("button", { class: "aicl-btn", onclick: () => tryDo(() => commit(model.addFolder(state, name.value))) }, "Add folder"),
        h("span", { class: "muted" }, model.isPro(state) ? " Pro" : ` ${state.folders.length}/${model.FREE.folders} free`),
      ),
      state.folders.length
        ? h(
            "div",
            {},
            h("div", { class: "muted", style: "margin-top:8px" }, "Save this conversation to"),
            sel,
            h("button", { class: "aicl-btn", onclick: () => tryDo(() => commit(model.saveConvo(state, { url: location.href, title: adapter.title(), site: adapter.id, folderId: sel.value }))) }, "Save here"),
          )
        : h("div", { class: "muted" }, "Create a folder, then save conversations into it from any of the three sites."),
      ...state.folders.map((f) =>
        h(
          "div",
          {},
          h(
            "div",
            { class: "aicl-folder" },
            f.name,
            " ",
            h("button", { class: "x", title: "Delete folder", onclick: () => confirm(`Delete folder "${f.name}" and its saved links?`) && tryDo(() => commit(model.deleteFolder(state, f.id))) }, "✕"),
          ),
          ...model.convosIn(state, f.id).map((c) =>
            h(
              "div",
              { class: "aicl-item" },
              h("span", { class: "t", title: c.url, onclick: () => (location.href = c.url) }, `${c.site === "chatgpt" ? "🟢" : c.site === "claude" ? "🟠" : "🔵"} ${c.title}`),
              h("button", { class: "x", onclick: () => tryDo(() => commit(model.removeConvo(state, c.id))) }, "✕"),
            ),
          ),
        ),
      ),
    );
    return view;
  }

  function promptsView() {
    const title = h("input", { placeholder: "Prompt title" });
    const body = h("textarea", { placeholder: "Prompt text. Use {{selection}} to insert the current text selection." });
    const q = h("input", { placeholder: "Search prompts", oninput: () => list.replaceChildren(...items()) });
    const items = () =>
      state.prompts
        .filter((p) => !q.value || (p.title + p.body).toLowerCase().includes(q.value.toLowerCase()))
        .sort((a, b) => b.uses - a.uses)
        .map((p) =>
          h(
            "div",
            { class: "aicl-item" },
            h(
              "span",
              {
                class: "t",
                title: p.body,
                onclick: () => {
                  const text = p.body.replace(/\{\{selection\}\}/g, String(window.getSelection() || "").trim());
                  if (A.insertIntoInput(adapter.input(), text)) {
                    commit(model.bumpPrompt(state, p.id));
                    panel.hidden = true;
                  } else say("Could not find the chat input on this page", true);
                },
              },
              p.title,
            ),
            h("button", { class: "x", title: "Copy", onclick: () => navigator.clipboard.writeText(p.body).then(() => say("Copied")) }, "⧉"),
            h("button", { class: "x", title: "Delete", onclick: () => tryDo(() => commit(model.deletePrompt(state, p.id))) }, "✕"),
          ),
        );
    const list = h("div", {}, ...items());
    return h(
      "div",
      {},
      title,
      body,
      h("button", { class: "aicl-btn", onclick: () => tryDo(() => commit(model.addPrompt(state, { title: title.value, body: body.value }))) }, "Save prompt"),
      h("span", { class: "muted" }, model.isPro(state) ? " Pro" : ` ${state.prompts.length}/${model.FREE.prompts} free`),
      h("div", { class: "muted", style: "margin:8px 0 2px" }, "Click a prompt to insert it into the chat box."),
      q,
      list,
    );
  }

  function exportView() {
    const msgs = adapter.messages();
    const doExport = (mode) => {
      const messages = adapter.messages();
      if (messages.length === 0) return say("No messages found on this page", true);
      const md = MD.conversationToMarkdown(adapter.title(), messages, location.href);
      if (mode === "copy") return navigator.clipboard.writeText(md).then(() => { say(`Copied ${messages.length} messages as Markdown`); bumpExports(); });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      a.download = adapter.title().replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + ".md";
      a.click();
      say(`Downloaded ${messages.length} messages`);
      bumpExports();
    };
    return h(
      "div",
      {},
      h("div", {}, `${msgs.length} messages detected on this page.`),
      h("div", { class: "muted" }, "Export keeps headings, lists, code blocks and links."),
      h("div", { style: "margin-top:8px" }, h("button", { class: "aicl-btn", onclick: () => doExport("download") }, "Download .md"), h("button", { class: "aicl-btn sec", onclick: () => doExport("copy") }, "Copy Markdown")),
      h("div", { class: "muted", style: "margin-top:12px" }, model.isPro(state) ? "Pro active." : "Free plan. Pro: unlimited folders and prompts, $19 once."),
      !model.isPro(state) && state.checkoutUrl ? h("a", { class: "aicl-btn sec", href: `${state.checkoutUrl}/buy/chrome-ai-layer-pro`, target: "_blank", rel: "noopener" }, "Get Pro") : null,
      (state.exports || 0) >= 10 && !state.reviewAsked
        ? h("div", { class: "aicl-msg" }, "Useful? A short review in the Chrome Web Store helps a lot. ", h("a", { href: "https://chromewebstore.google.com/detail/" + (chrome.runtime?.id || ""), target: "_blank", rel: "noopener", onclick: () => commit({ ...state, reviewAsked: true }) }, "Write a review"), " · ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); commit({ ...state, reviewAsked: true }); } }, "no thanks"))
        : null,
    );
  }

  function bumpExports() {
    commit({ ...state, exports: (state.exports || 0) + 1 });
  }

  io.load().then((s) => {
    state = { ...s, checkoutUrl: s.checkoutUrl || DEFAULT_CHECKOUT };
  });
  // Keep state fresh when the options page or another tab changes it.
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.aicl) {
        state = { ...model.empty(), ...ch.aicl.newValue };
        if (!panel.hidden) render();
      }
    });
  }
  // Keyboard: Alt+A toggles the panel.
  document.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "a") toggle.click();
  });
})();
