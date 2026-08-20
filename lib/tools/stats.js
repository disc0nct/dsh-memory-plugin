import { stat } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { loadMemory } from "../storage.js";

export function buildStatsTool(memoryPath) {
  return defineTool({
    name: "memory_stats",
    description: "Get statistics about long-term memory: count, categories, oldest/newest timestamps, and file size. Useful for health checks and before large operations.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: { type: "integer", required: true, description: "Total facts" },
          categories: {
            type: "object",
            required: true,
            additionalProperties: true,
            properties: {},
          },
          oldest: { type: "string", description: "ISO timestamp of oldest fact" },
          newest: { type: "string", description: "ISO timestamp of newest fact" },
          fileSize: { type: "integer", required: true, description: "File size in bytes (0 if missing)" },
        },
      },
      render: (_args, value) => {
        const cats = Object.entries(value.categories)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ") || "none";
        const lines = [
          `Memories: ${value.count} (${cats})`,
          `Oldest: ${value.oldest || "n/a"} | Newest: ${value.newest || "n/a"}`,
          `File: ${value.fileSize} bytes`,
        ];
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    execute: async (_args, exec) => {
      if (exec?.signal?.aborted) throw new Error(`Aborted: ${exec.signal.reason ?? "signal aborted"}`);
      const memory = await loadMemory(memoryPath);
      const facts = memory.facts;
      const count = facts.length;
      const categories = {};
      let oldest = null;
      let newest = null;
      let oldestMs = Infinity;
      let newestMs = -Infinity;
      for (const f of facts) {
        categories[f.category] = (categories[f.category] || 0) + 1;
        const ms = Date.parse(f.timestamp) || 0;
        if (ms < oldestMs) {
          oldestMs = ms;
          oldest = f.timestamp;
        }
        if (ms > newestMs) {
          newestMs = ms;
          newest = f.timestamp;
        }
      }
      let fileSize = 0;
      try {
        const st = await stat(memoryPath);
        fileSize = st.size;
      } catch {}
      const out = { count, categories, fileSize };
      if (oldest) out.oldest = oldest;
      if (newest) out.newest = newest;
      return out;
    },
    presentCall: () => ({
      card: "generic",
      title: "Memory stats",
      kind: "read",
      rawInput: {},
    }),
  });
}
