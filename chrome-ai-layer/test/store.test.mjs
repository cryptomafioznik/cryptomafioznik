import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/store.js";

const { model } = globalThis.AICL_STORE;

test("free limits apply to folders and prompts, Pro lifts them", () => {
  let s = model.empty();
  for (let i = 0; i < model.FREE.folders; i++) s = model.addFolder(s, `f${i}`);
  assert.throws(() => model.addFolder(s, "one more"), /Free plan/);
  s = { ...s, license: { key: "K", validUntil: Date.now() + 1000, product: "p" } };
  s = model.addFolder(s, "pro folder");
  assert.equal(s.folders.length, model.FREE.folders + 1);
  for (let i = 0; i < model.FREE.prompts + 2; i++) s = model.addPrompt(s, { title: `p${i}`, body: "x" });
  assert.equal(s.prompts.length, model.FREE.prompts + 2);
});

test("saving the same conversation twice replaces it (moves folders)", () => {
  let s = model.addFolder(model.addFolder(model.empty(), "A"), "B");
  const [a, b] = s.folders;
  s = model.saveConvo(s, { url: "https://chatgpt.com/c/1#x", title: "T", site: "chatgpt", folderId: a.id });
  s = model.saveConvo(s, { url: "https://chatgpt.com/c/1", title: "T2", site: "chatgpt", folderId: b.id });
  assert.equal(s.convos.length, 1);
  assert.equal(s.convos[0].folderId, b.id);
  assert.equal(s.convos[0].title, "T2");
  assert.equal(model.convosIn(s, a.id).length, 0);
  s = model.deleteFolder(s, b.id);
  assert.equal(s.convos.length, 0);
});

test("export / import round-trips and dedupes", () => {
  let s = model.addFolder(model.empty(), "A");
  s = model.addPrompt(s, { title: "Summarize", body: "Summarize: {{selection}}" });
  s = model.saveConvo(s, { url: "https://claude.ai/chat/x", title: "C", site: "claude", folderId: s.folders[0].id });
  const json = model.exportJson(s);
  const merged = model.importJson(s, json);
  assert.equal(merged.folders.length, 1);
  assert.equal(merged.prompts.length, 1);
  assert.equal(merged.convos.length, 1);
  assert.throws(() => model.importJson(s, "{}"), /Not an AI Chat Layer export/);
});

test("validation errors are readable", () => {
  assert.throws(() => model.addFolder(model.empty(), "  "), /empty/);
  assert.throws(() => model.addPrompt(model.empty(), { title: "x", body: "" }), /title and text/);
  assert.throws(() => model.saveConvo(model.empty(), { url: "" }), /URL/);
});
