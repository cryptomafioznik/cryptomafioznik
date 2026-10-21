// Per-site selectors. These are the only parts that break when a site redesigns; keep them in one place.
// Each adapter: match(hostname), messages() -> [{role, el}], input() -> editable element, title().
(function () {
  const text = (el) => (el ? el.innerText.trim() : "");

  const adapters = [
    {
      id: "chatgpt",
      match: (h) => h === "chatgpt.com" || h === "chat.openai.com",
      messages: () =>
        [...document.querySelectorAll("[data-message-author-role]")].map((el) => ({
          role: el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant",
          el,
        })),
      input: () => document.querySelector("#prompt-textarea") || document.querySelector("div[contenteditable='true']") || document.querySelector("textarea"),
      title: () => document.title.replace(/\s*[-|·]\s*ChatGPT\s*$/i, "").trim() || "ChatGPT conversation",
    },
    {
      id: "claude",
      match: (h) => h === "claude.ai",
      messages: () => {
        const out = [];
        const user = document.querySelectorAll("[data-testid='user-message']");
        const assistant = document.querySelectorAll(".font-claude-message, [data-testid='assistant-message'], .font-claude-response");
        for (const el of user) out.push({ role: "user", el, y: el.getBoundingClientRect().top + window.scrollY });
        for (const el of assistant) out.push({ role: "assistant", el, y: el.getBoundingClientRect().top + window.scrollY });
        if (out.length === 0) return fallbackMessages();
        return out.sort((a, b) => a.y - b.y);
      },
      input: () => document.querySelector("div[contenteditable='true'].ProseMirror") || document.querySelector("div[contenteditable='true']") || document.querySelector("textarea"),
      title: () => document.title.replace(/\s*[-|·]\s*Claude\s*$/i, "").trim() || "Claude conversation",
    },
    {
      id: "gemini",
      match: (h) => h === "gemini.google.com",
      messages: () => {
        const out = [];
        for (const el of document.querySelectorAll("user-query, .user-query")) out.push({ role: "user", el, y: el.getBoundingClientRect().top + window.scrollY });
        for (const el of document.querySelectorAll("model-response, .model-response-text")) out.push({ role: "assistant", el, y: el.getBoundingClientRect().top + window.scrollY });
        if (out.length === 0) return fallbackMessages();
        return out.sort((a, b) => a.y - b.y);
      },
      input: () => document.querySelector(".ql-editor[contenteditable='true']") || document.querySelector("div[contenteditable='true']") || document.querySelector("textarea"),
      title: () => document.title.replace(/\s*[-|·]\s*Gemini\s*$/i, "").trim() || "Gemini conversation",
    },
  ];

  // When selectors fail: take the largest text blocks inside <main> and alternate roles. Better than nothing.
  function fallbackMessages() {
    const root = document.querySelector("main") || document.body;
    const blocks = [...root.querySelectorAll("article, section, div")].filter((el) => {
      const t = text(el);
      return t.length > 20 && el.children.length < 40 && !el.querySelector("article, section");
    });
    const top = blocks.filter((el) => !blocks.some((o) => o !== el && o.contains(el)));
    return top.map((el, i) => ({ role: i % 2 === 0 ? "user" : "assistant", el }));
  }

  window.AICL_ADAPTERS = {
    current() {
      const h = location.hostname;
      return adapters.find((a) => a.match(h)) || null;
    },
    insertIntoInput(el, textToInsert) {
      if (!el) return false;
      el.focus();
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        const start = el.selectionStart ?? el.value.length;
        el.value = el.value.slice(0, start) + textToInsert + el.value.slice(start);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      // contenteditable (ProseMirror, Quill): execCommand still works in Chrome and keeps the editor's state in sync.
      const ok = document.execCommand("insertText", false, textToInsert);
      if (!ok) {
        el.textContent += textToInsert;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    },
  };
})();
