import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as mod from "../lib/index.js";

let memPath;
let dir;
let ctx;
let tools;

async function loadTools() {
  tools = [];
  ctx = {
    tools: { register(t) { tools.push(t); } },
    logger: { info() {} },
  };
  mod.apply(ctx, { memoryPath: memPath });
  return tools;
}

function getTool(name) {
  return tools.find((t) => t.name === name);
}

describe("tool-memory DSH best-practice compliance", () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-mem-test-"));
    memPath = join(dir, "memory.json");
    await loadTools();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("registers 7 tools with correct concurrency & timeout", () => {
    assert.equal(tools.length, 7);
    const expected = ["memory_store", "memory_search", "memory_get", "memory_list", "memory_delete", "memory_clear", "memory_stats"];
    for (const n of expected) assert.ok(getTool(n), `missing ${n}`);
    // read tools should be concurrency safe
    assert.equal(getTool("memory_search").isConcurrencySafe({}), true);
    assert.equal(getTool("memory_list").isConcurrencySafe({}), true);
    assert.equal(getTool("memory_get").isConcurrencySafe({ key: "k" }), true);
    // write tools are exclusive (no isConcurrencySafe or false)
    assert.equal(typeof getTool("memory_store").timeoutMs, "number");
    assert.equal(getTool("memory_search").timeoutMs, 5000);
  });

  it("parameters are optional where documented (general/empty defaults)", async () => {
    const exec = { signal: new AbortController().signal };
    // store without category defaults to general
    const r = await getTool("memory_store").execute({ key: "test-key", value: "hello" }, exec);
    assert.equal(r.category, "general");
    // search with empty args uses defaults
    const sr = await getTool("memory_search").execute({}, exec);
    assert.equal(sr.count, 1);
    // list with no args
    const lr = await getTool("memory_list").execute({}, exec);
    assert.equal(lr.count, 1);
  });

  it("store validates key/value/category", async () => {
    const exec = { signal: new AbortController().signal };
    await assert.rejects(() => getTool("memory_store").execute({ key: "BAD_KEY", value: "x" }, exec), /kebab-case/);
    await assert.rejects(() => getTool("memory_store").execute({ key: "ok-key", value: "" }, exec), /non-empty/);
    await assert.rejects(() => getTool("memory_store").execute({ key: "ok-key", value: "v", category: "BadCat" }, exec), /kebab-case/);
    const longVal = "a".repeat(10001);
    await assert.rejects(() => getTool("memory_store").execute({ key: "ok-key", value: longVal }, exec), /too long/);
  });

  it("upsert preserves recency and uses randomUUID", async () => {
    const exec = { signal: new AbortController().signal };
    const a = await getTool("memory_store").execute({ key: "k1", value: "v1", category: "project" }, exec);
    await new Promise((r) => setTimeout(r, 10));
    const b = await getTool("memory_store").execute({ key: "k2", value: "v2", category: "project" }, exec);
    await new Promise((r) => setTimeout(r, 10));
    // update k1 -> should become most recent
    const a2 = await getTool("memory_store").execute({ key: "k1", value: "v1-updated", category: "project" }, exec);
    assert.notEqual(a.id, a2.id);
    assert.match(a2.id, /^[0-9a-f-]{36}$/);
    const search = await getTool("memory_search").execute({ category: "project", limit: 2 }, exec);
    assert.deepEqual(search.results.map((r) => r.key), ["k1", "k2"]);
  });

  it("search matches key, value and category and sorts by timestamp desc", async () => {
    const exec = { signal: new AbortController().signal };
    await getTool("memory_store").execute({ key: "alpha-key", value: "hello world", category: "project" }, exec);
    await new Promise((r) => setTimeout(r, 5));
    await getTool("memory_store").execute({ key: "beta", value: "something", category: "identity" }, exec);
    // query matches category
    const r1 = await getTool("memory_search").execute({ query: "identity" }, exec);
    assert.equal(r1.count, 1);
    assert.equal(r1.results[0].category, "identity");
    // query matches key
    const r2 = await getTool("memory_search").execute({ query: "alpha" }, exec);
    assert.equal(r2.count, 1);
    // limit clamping
    const r3 = await getTool("memory_search").execute({ limit: 100 }, exec);
    assert.equal(r3.count, 2); // capped at 50 but only 2 exist
    const r4 = await getTool("memory_search").execute({ limit: 1 }, exec);
    assert.equal(r4.count, 1);
    // most recent first
    assert.equal(r4.results[0].key, "beta");
  });

  it("list returns most recent first", async () => {
    const exec = { signal: new AbortController().signal };
    await getTool("memory_store").execute({ key: "k1", value: "v1" }, exec);
    await new Promise((r) => setTimeout(r, 5));
    await getTool("memory_store").execute({ key: "k2", value: "v2" }, exec);
    const lr = await getTool("memory_list").execute({}, exec);
    assert.equal(lr.facts[0].key, "k2");
  });

  it("memory_get returns found:false without fact", async () => {
    const exec = { signal: new AbortController().signal };
    await getTool("memory_store").execute({ key: "exists", value: "yes" }, exec);
    const hit = await getTool("memory_get").execute({ key: "exists" }, exec);
    assert.equal(hit.found, true);
    assert.ok(hit.fact);
    const miss = await getTool("memory_get").execute({ key: "missing" }, exec);
    assert.equal(miss.found, false);
    assert.equal(miss.fact, undefined);
  });

  it("delete and clear with confirm guard", async () => {
    const exec = { signal: new AbortController().signal };
    await getTool("memory_store").execute({ key: "k1", value: "v1" }, exec);
    await getTool("memory_store").execute({ key: "k2", value: "v2" }, exec);
    const delMiss = await getTool("memory_delete").execute({ key: "nope" }, exec);
    assert.equal(delMiss.deleted, false);
    const del = await getTool("memory_delete").execute({ key: "k1" }, exec);
    assert.equal(del.deleted, true);
    const beforeClear = await getTool("memory_list").execute({}, exec);
    assert.equal(beforeClear.count, 1);
    const noConfirm = await getTool("memory_clear").execute({}, exec);
    assert.equal(noConfirm.cleared, false);
    assert.equal(noConfirm.count, 1);
    const yesConfirm = await getTool("memory_clear").execute({ confirm: true }, exec);
    assert.equal(yesConfirm.cleared, true);
    assert.equal(yesConfirm.count, 1);
    const after = await getTool("memory_list").execute({}, exec);
    assert.equal(after.count, 0);
  });

  it("atomic write uses rename and survives corrupt file", async () => {
    const exec = { signal: new AbortController().signal };
    await getTool("memory_store").execute({ key: "k1", value: "v1" }, exec);
    const raw = await readFile(memPath, "utf8");
    assert.ok(raw.includes("k1"));
    // ensure no tmp files left
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    assert.ok(!files.some((f) => f.includes(".tmp")), "tmp file leftover");

    // corrupt file -> list recovers and creates backup
    await writeFile(memPath, "not json {", "utf8");
    const recovered = await getTool("memory_list").execute({}, exec);
    assert.equal(recovered.count, 0);
    const files2 = await readdir(dir);
    assert.ok(files2.some((f) => f.includes(".corrupt")), "corrupt backup not created");
  });

  it("normalizeMemoryPath handles ~ and relative", () => {
    assert.ok(mod.normalizeMemoryPath("~/foo.json").endsWith("foo.json"));
    assert.ok(mod.normalizeMemoryPath("/tmp/a.json") === "/tmp/a.json");
    assert.ok(mod.normalizeMemoryPath("") === mod.DEFAULT_MEMORY_PATH);
  });

  it("presentCall uses DSH kind vocabulary", () => {
    assert.equal(getTool("memory_search").presentCall({ query: "q" }).kind, "search");
    assert.equal(getTool("memory_list").presentCall({}).kind, "read");
    assert.equal(getTool("memory_store").presentCall({ key: "k", value: "v", category: "c" }).kind, "edit");
    assert.equal(getTool("memory_delete").presentCall({ key: "k" }).kind, "delete");
    assert.equal(getTool("memory_clear").presentCall({}).kind, "delete");
    assert.equal(getTool("memory_get").presentCall({ key: "k" }).kind, "read");
  });
});
