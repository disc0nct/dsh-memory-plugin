import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as mod from "../lib/index.js";

let memPath, dir, tools;
async function loadTools() {
  dir = await mkdtemp(join(tmpdir(), "dsh-sem-"));
  memPath = join(dir, "memory.json");
  tools = [];
  const ctx = { tools: { register(t) { tools.push(t); } }, logger: { info() {} } };
  mod.apply(ctx, { memoryPath: memPath });
  return tools;
}
function getTool(name) { return tools.find((t) => t.name === name); }

describe("semantic / hybrid search (lib/search/scoring.js)", () => {
  let exec;
  beforeEach(async () => {
    await loadTools();
    exec = { signal: new AbortController().signal };
    const store = getTool("memory_store");
    await store.execute({ key: "favorite-color", value: "blue", category: "preferences" }, exec);
    await store.execute({ key: "project-language", value: "TypeScript", category: "project" }, exec);
    await store.execute({ key: "user-name", value: "Alice", category: "identity" }, exec);
    await store.execute({ key: "deadline", value: "2026-09-01 ship v1", category: "project" }, exec);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("hybrid matches paraphrases that keyword misses", async () => {
    const search = getTool("memory_search");
    const kw = await search.execute({ query: "fav color", mode: "keyword" }, exec);
    assert.equal(kw.count, 0, "keyword should not match abbreviation");
    const hy = await search.execute({ query: "fav color", mode: "hybrid" }, exec);
    assert.equal(hy.count, 1);
    assert.equal(hy.results[0].key, "favorite-color");
    const sem = await search.execute({ query: "fav color", mode: "semantic" }, exec);
    assert.equal(sem.count, 1);
  });

  it("hybrid default mode equals hybrid explicit", async () => {
    const search = getTool("memory_search");
    const a = await search.execute({ query: "typescript lang" }, exec);
    const b = await search.execute({ query: "typescript lang", mode: "hybrid" }, exec);
    assert.deepEqual(a, b);
    assert.equal(a.count, 1);
    assert.equal(a.results[0].key, "project-language");
  });

  it("token Jaccard ranks relevant fact highest", async () => {
    const search = getTool("memory_search");
    const r = await search.execute({ query: "what is my name", mode: "semantic" }, exec);
    assert.ok(r.count >= 1);
    assert.equal(r.results[0].key, "user-name");
  });

  it("category filter still applies with semantic", async () => {
    const search = getTool("memory_search");
    const r = await search.execute({ query: "project", category: "project", mode: "hybrid" }, exec);
    // both project-language and deadline are project, but project-language should rank higher for "project"
    assert.equal(r.count, 2);
    assert.ok(r.results.every((f) => f.category === "project"));
  });

  it("empty query returns recency regardless of mode", async () => {
    const search = getTool("memory_search");
    const a = await search.execute({ query: "", mode: "keyword" }, exec);
    const b = await search.execute({ query: "", mode: "semantic" }, exec);
    assert.equal(a.count, 4);
    assert.equal(b.count, 4);
    // most recent first: deadline was last inserted
    assert.equal(a.results[0].key, "deadline");
    assert.equal(b.results[0].key, "deadline");
  });

  it("limit still enforced after semantic ranking", async () => {
    const search = getTool("memory_search");
    const r = await search.execute({ query: "project", limit: 1, mode: "hybrid" }, exec);
    assert.equal(r.count, 1);
  });
});
