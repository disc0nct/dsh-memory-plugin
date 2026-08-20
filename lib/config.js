import { homedir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import z from "@deepseek-ai/schemastery";

export const DEFAULT_MEMORY_PATH = join(
  process.env.DSH_HOME || join(homedir(), ".dsh"),
  "memory.json"
);

export const Config = z.object({
  memoryPath: z
    .string()
    .default(DEFAULT_MEMORY_PATH)
    .description("Absolute path to memory.json. Defaults to $DSH_HOME/memory.json or ~/.dsh/memory.json"),
});

/**
 * Normalize memoryPath: expand ~/, resolve relative, trim.
 * @param {string} p
 * @returns {string}
 */
export function normalizeMemoryPath(p) {
  if (!p || typeof p !== "string") return DEFAULT_MEMORY_PATH;
  const trimmed = p.trim();
  if (!trimmed) return DEFAULT_MEMORY_PATH;
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  if (isAbsolute(trimmed)) return resolve(trimmed);
  return join(process.env.DSH_HOME || join(homedir(), ".dsh"), trimmed);
}
