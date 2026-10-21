// HTML -> Markdown for chat messages. Small on purpose: code blocks, inline code, headings, lists, bold/italic, links, tables (flattened).
(function () {
  function convert(node, ctx = { listDepth: 0, ordered: [] }) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    const kids = () => [...node.childNodes].map((n) => convert(n, ctx)).join("");
    switch (tag) {
      case "script":
      case "style":
      case "button":
      case "svg":
        return "";
      case "br":
        return "\n";
      case "pre": {
        const code = node.querySelector("code");
        const lang = ((code && code.className) || node.className || "").match(/language-([\w+-]+)/)?.[1] || "";
        const body = (code || node).innerText.replace(/\n$/, "");
        return `\n\n\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
      }
      case "code":
        return "`" + node.innerText.replace(/`/g, "\\`") + "`";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return `\n\n${"#".repeat(Number(tag[1]))} ${kids().trim()}\n\n`;
      case "p":
      case "div":
      case "section":
      case "article":
        return `\n\n${kids().trim()}\n\n`;
      case "strong":
      case "b":
        return `**${kids().trim()}**`;
      case "em":
      case "i":
        return `*${kids().trim()}*`;
      case "a": {
        const href = node.getAttribute("href") || "";
        const t = kids().trim();
        return href && !href.startsWith("javascript:") ? `[${t}](${href})` : t;
      }
      case "ul":
      case "ol": {
        const items = [...node.children].filter((c) => c.tagName === "LI");
        const inner = { listDepth: ctx.listDepth + 1 };
        return (
          "\n" +
          items
            .map((li, i) => {
              const bullet = tag === "ol" ? `${i + 1}. ` : "- ";
              const body = [...li.childNodes].map((n) => convert(n, inner)).join("").trim().replace(/\n{3,}/g, "\n\n");
              // Nested lists come back as "\n- item"; indenting every inner line by two spaces nests them under this item.
              return bullet + body.replace(/\n/g, "\n  ");
            })
            .join("\n") +
          "\n"
        );
      }
      case "li":
        return kids();
      case "blockquote":
        return "\n\n" + kids().trim().split("\n").map((l) => "> " + l).join("\n") + "\n\n";
      case "hr":
        return "\n\n---\n\n";
      case "table": {
        const rows = [...node.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.innerText.trim().replace(/\|/g, "\\|")));
        if (rows.length === 0) return "";
        const head = rows[0];
        const sep = head.map(() => "---");
        return "\n\n" + [head, sep, ...rows.slice(1)].map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n\n";
      }
      case "img":
        return node.alt ? `![${node.alt}](${node.src || ""})` : "";
      default:
        return kids();
    }
  }

  function tidy(md) {
    return md
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  window.AICL_MD = {
    elementToMarkdown: (el) => tidy(convert(el)),
    conversationToMarkdown(title, messages, url) {
      const parts = [`# ${title}`, "", `Source: ${url}`, `Exported: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ""];
      for (const m of messages) {
        parts.push(`## ${m.role === "user" ? "You" : "Assistant"}`, "", tidy(convert(m.el)), "");
      }
      return parts.join("\n").trim() + "\n";
    },
  };
})();
