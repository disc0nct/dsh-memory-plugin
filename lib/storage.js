import { readFile, writeFile, mkdir, rename, stat, readdir, unlink } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_FACTS, MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS } from "./validation.js";

// in-memory cache: path -> { mtimeMs, size, facts }  (perf: avoids re-read if file unchanged)
const _cache = new Map();

// write serialization per file path (Phase 1.1)
const _writeQueues = new Map();
const _cleaned = new Set();

// orphan threshold 1 hour
const ORPHAN_MAX_AGE_MS = 60 * 60 * 1000;

// --- Phase 1.4: custom errors + retry ---
export class MemoryPluginError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = "MemoryPluginError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

const TRANSIENT_CODES = new Set(["EACCES", "EBUSY", "EMFILE", "ENOSPC", "EPERM", "EAGAIN", "EBADF", "ENFILE"]);

function isTransient(err) {
  return err && typeof err.code === "string" && TRANSIENT_CODES.has(err.code);
}

async function withRetry(fn, { retries = 3, baseMs = 100 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransient(e) || attempt === retries) throw e;
      const backoff = baseMs * 2 ** attempt + Math.floor(Math.random() * 50);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw last;
}

export async function withWriteLock(path, fn) {
  const prev = _writeQueues.get(path) || Promise.resolve();
  let release;
  const next = new Promise((res) => (release = res));
  // chain: prev -> next, so next waits for prev
  _writeQueues.set(path, prev.then(() => next).catch(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // clean up if no one is waiting behind next
    // if the next promise is still the tail, keep it else it will be replaced by newer waiter
    // we don't delete aggressively; next will resolve and allow chain to progress
  }
}

// Phase 1.2: orphan cleanup (run on every load; _cleaned tracks that initial sweep happened but still re-checks)
export async function cleanupOrphans(memoryPath) {
  // always scan; _cleaned is kept for stats but not for early exit (test expects second sweep)
  _cleaned.add(memoryPath);
  const dir = dirname(memoryPath);
  const base = basename(memoryPath);
  const prefix = base + ".tmp.";
  try {
    const entries = await readdir(dir);
    const now = Date.now();
    for (const e of entries) {
      if (!e.startsWith(prefix)) continue;
      const full = join(dir, e);
      try {
        const st = await stat(full);
        if (now - st.mtimeMs > ORPHAN_MAX_AGE_MS) {
          await unlink(full).catch(() => {});
        }
      } catch {}
    }
  } catch {}
}

function _cloneFacts(facts) {
  return facts.map((f) => ({ ...f }));
}

export async function loadMemory(path) {
  // Phase 1.2: lazy orphan sweep once per path
  try { await cleanupOrphans(path); } catch {}

  // fast path: if file mtime unchanged, return cached clone (minimal alloc)
  try {
    const st = await withRetry(() => stat(path));
    const cached = _cache.get(path);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return { facts: _cloneFacts(cached.facts) };
    }
  } catch {}
  try {
    const raw = await withRetry(() => readFile(path, "utf8"));
    if (!raw.trim()) {
      try {
        const st = await withRetry(() => stat(path));
        _cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, facts: [] });
      } catch {}
      return { facts: [] };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { facts: [] };
    if (!Array.isArray(parsed.facts)) return { facts: [] };
    const facts = [];
    for (const f of parsed.facts) {
      if (
        !f ||
        typeof f !== "object" ||
        typeof f.key !== "string" ||
        typeof f.value !== "string" ||
        typeof f.id !== "string" ||
        typeof f.category !== "string" ||
        typeof f.timestamp !== "string"
      ) continue;
      // normalize timestamps for this in-memory view
      let timestampMs = f.timestampMs;
      let timestamp = f.timestamp;
      if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
        const parsedMs = Date.parse(timestamp);
        if (Number.isFinite(parsedMs) && parsedMs >= MIN_TIMESTAMP_MS && parsedMs <= MAX_TIMESTAMP_MS) {
          timestampMs = parsedMs;
        } else {
          timestampMs = Date.now();
          timestamp = new Date(timestampMs).toISOString();
        }
      }
      // ensure timestamp string is valid ISO
      if (!Number.isFinite(Date.parse(timestamp))) {
        timestamp = new Date(timestampMs).toISOString();
      }
      facts.push({ ...f, timestamp, timestampMs });
    }
    const sliced = facts.length > MAX_FACTS ? facts.slice(-MAX_FACTS) : facts;
    // update cache
    try {
      const st = await withRetry(() => stat(path));
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
          if (raw2) await withRetry(() => writeFile(corruptPath, raw2, "utf8")).catch(() => {});
        } catch {}
      } catch {}
      _cache.delete(path);
      return { facts: [] };
    }
    // wrap transient errors
    if (isTransient(error)) throw new MemoryPluginError(`Transient FS error on load: ${error.message}`, error.code, error);
    throw error;
  }
}

export async function saveMemory(path, memory) {
  const safe = {
    facts: Array.isArray(memory?.facts) ? memory.facts : [],
  };
  // ensure each fact has valid timestampMs/timestamp before persisting
  const now = Date.now();
  safe.facts = safe.facts.map((f) => {
    if (!f || typeof f !== "object") return f;
    let ms = f.timestampMs;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < MIN_TIMESTAMP_MS || ms > MAX_TIMESTAMP_MS) {
      const parsed = Date.parse(f.timestamp);
      ms = Number.isFinite(parsed) ? parsed : now;
    }
    let ts = f.timestamp;
    if (typeof ts !== "string" || !Number.isFinite(Date.parse(ts))) ts = new Date(ms).toISOString();
    return { ...f, timestamp: ts, timestampMs: ms };
  });
  if (safe.facts.length > MAX_FACTS) safe.facts = safe.facts.slice(-MAX_FACTS);
  await withRetry(() => mkdir(dirname(path), { recursive: true }));
  const content = JSON.stringify(safe, null, 2);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    await withRetry(() => writeFile(tmp, content, "utf8"));
    await withRetry(() => rename(tmp, path));
  } catch (e) {
    // best-effort cleanup of tmp on failure
    try { await unlink(tmp).catch(() => {}); } catch {}
    if (isTransient(e)) throw new MemoryPluginError(`Transient FS error on save: ${e.message}`, e.code, e);
    throw e;
  }
  try {
    const st = await withRetry(() => stat(path));
    _cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, facts: _cloneFacts(safe.facts) });
  } catch {}
}

// for tests: clear cache and queues
export function _clearCache() {
  _cache.clear();
  _writeQueues.clear();
  _cleaned.clear();
}

export function compareRecent(a, b) {
  const ta = a.timestampMs ?? Date.parse(a.timestamp) ?? 0;
  const tb = b.timestampMs ?? Date.parse(b.timestamp) ?? 0;
  if (!Number.isFinite(ta)) return 1;
  if (!Number.isFinite(tb)) return -1;
  if (tb !== ta) return tb - ta;
  return 0;
}
