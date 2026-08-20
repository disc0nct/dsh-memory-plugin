import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_FACTS } from "./validation.js";

// in-memory cache: path -> { mtimeMs, facts }  (perf: avoids re-read if file unchanged)
const _cache = new Map();

function _cloneFacts(facts) {
  return facts.map((f) => ({ ...f }));
}

export async function loadMemory(path) {
  // fast path: if file mtime unchanged, return cached clone (minimal alloc)
  try {
    const st = await stat(path);
    const cached = _cache.get(path);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return { facts: _cloneFacts(cached.facts) };
    }
  } catch {}
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) {
      try {
        const st = await stat(path);
        _cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, facts: [] });
      } catch {}
      return { facts: [] };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { facts: [] };
    if (!Array.isArray(parsed.facts)) return { facts: [] };
    const facts = parsed.facts.filter(
      (f) =>
        f &&
        typeof f === "object" &&
        typeof f.key === "string" &&
        typeof f.value === "string" &&
        typeof f.id === "string" &&
        typeof f.category === "string" &&
        typeof f.timestamp === "string"
    );
    const sliced = facts.length > MAX_FACTS ? facts.slice(-MAX_FACTS) : facts;
    try {
      const st = await stat(path);
      _cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, facts: _cloneFacts(sliced) });
    } catch {}
    return { facts: sliced };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      _cache.delete(path);
      return { facts: [] };
    }
    if (error instanceof SyntaxError) {
      try {
        const corruptPath = `${path}.corrupt.${Date.now()}`;
        try {
          const raw2 = await readFile(path, "utf8").catch(() => "");
          if (raw2) await writeFile(corruptPath, raw2, "utf8");
        } catch {}
      } catch {}
      _cache.delete(path);
      return { facts: [] };
    }
    throw error;
  }
}

export async function saveMemory(path, memory) {
  const safe = {
    facts: Array.isArray(memory?.facts) ? memory.facts : [],
  };
  if (safe.facts.length > MAX_FACTS) safe.facts = safe.facts.slice(-MAX_FACTS);
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(safe, null, 2);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
  try {
    const st = await stat(path);
    _cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, facts: _cloneFacts(safe.facts) });
  } catch {}
}

// for tests: clear cache
export function _clearCache() {
  _cache.clear();
}

export function compareRecent(a, b) {
  const ta = Date.parse(a.timestamp) || 0;
  const tb = Date.parse(b.timestamp) || 0;
  if (tb !== ta) return tb - ta;
  return 0;
}
