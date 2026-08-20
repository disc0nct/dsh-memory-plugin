import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as mod from "../lib/index.js";
import { _clearCache } from "../lib/storage.js";

let memPath, dir, tools;
async function loadTools() {
  dir = await mkdtemp(join(tmpdir(), "dsh-stats-"));
  memPath = join(dir, "memory.json");
  _clearCache();
  tools = [];
  const ctx = { tools: { register(t) { tools.push(t); } }, logger: { info() {} } };
  mod.apply(ctx, { memoryPath: memPath });
  return tools;
}
function getTool(n) { return tools.find((t) => t.name === n); }

describe("memory_stats + cache", () => {
  let exec;
  beforeEach(async () => {
    await loadTools();
    exec = { signal: new AbortController().signal };
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); _clearCache(); });

  it("stats empty", async () => {
    const stats = getTool("memory_stats");
    assert.ok(stats.isConcurrencySafe({}));
    const r = await stats.execute({}, exec);
    assert.equal(r.count, 0);
    assert.deepEqual(r.categories, {});
    assert.equal(r.fileSize, 0);
    assert.equal(r.oldest, undefined);
  });

  it("stats after stores", async () => {
    const store = getTool("memory_store");
    const stats = getTool("memory_stats");
    await store.execute({ key: "k1", value: "v1", category: "project" }, exec);
    await new Promise((r) => setTimeout(r, 5));
    await store.execute({ key: "k2", value: "v2", category: "project" }, exec);
    await store.execute({ key: "k3", value: "v3", category: "identity" }, exec);
    const r = await stats.execute({}, exec);
    assert.equal(r.count, 3);
    assert.equal(r.categories.project, 2);
    assert.equal(r.categories.identity, 1);
    assert.ok(r.oldest);
    assert.ok(r.newest);
    assert.ok(r.fileSize > 0);
    assert.notEqual(r.oldest, r.newest);
  });

  it("cache: second load without change is cached but clone-isolated", async () => {
    const store = getTool("memory_store");
    const list = getTool("memory_list");
    await store.execute({ key: "k1", value: "v1" }, exec);
    const a = await list.execute({}, exec);
    const b = await list.execute({}, exec);
    assert.equal(a.count, 1);
    assert.equal(b.count, 1);
    // mutate returned array should not affect cache (clone)
    a.facts.push({ key: "evil", value: "x", category: "general", id: "1", timestamp: new Date().toISOString() });
    const c = await list.execute({}, exec);
    assert.equal(c.count, 1, "cache clone prevents mutation leak");
  });

  it("cache invalidates on external file change", async () => {
    const store = getTool("memory_store");
    const list = getTool("memory_list");
    await store.execute({ key: "k1", value: "v1" }, exec);
    // external write bypassing saveMemory
    await writeFile(memPath, JSON.stringify({ facts: [{ id: "x", key: "external", value: "y", category: "general", timestamp: new Date().toISOString() }] }, null, 2), "utf8");
    // mtime changed, so next load should see external fact, not cached k1
    // wait a bit for mtime granularity (ms)
    await new Promise((r) => setTimeout(r, 10));
    const r = await list.execute({}, exec);
    assert.equal(r.count, 1);
    assert.equal(r.facts[0].key, "external");
  });

  it("stats respects abort signal", async () => {
    const stats = getTool("memory_stats");
    const ac = new AbortController();
    ac.abort(new Error("test abort"));
    await assert.rejects(() => stats.execute({}, { signal: ac.signal }), /Aborted/);
  });
});
