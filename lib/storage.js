import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_FACTS } from "./validation.js";

export async function loadMemory(path) {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return { facts: [] };
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
    if (facts.length > MAX_FACTS) return { facts: facts.slice(-MAX_FACTS) };
    return { facts };
  } catch (error) {
    if (error && error.code === "ENOENT") return { facts: [] };
    if (error instanceof SyntaxError) {
      try {
        const corruptPath = `${path}.corrupt.${Date.now()}`;
        try {
          const raw2 = await readFile(path, "utf8").catch(() => "");
          if (raw2) await writeFile(corruptPath, raw2, "utf8");
        } catch {}
      } catch {}
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
}

export function compareRecent(a, b) {
  const ta = Date.parse(a.timestamp) || 0;
  const tb = Date.parse(b.timestamp) || 0;
  if (tb !== ta) return tb - ta;
  return 0;
}
