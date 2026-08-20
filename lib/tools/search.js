import { defineTool } from "@deepseek-ai/dsh-tools";
import { loadMemory } from "../storage.js";
import { hybridSearch } from "../search/scoring.js";

export function buildSearchTool(memoryPath) {
  return defineTool({
    name: "memory_search",
    description:
      "Search long-term memory by keyword or category. Hybrid keyword+semantic ranking: matches against keys, values, and categories (case-insensitive substring + token Jaccard). Use this at the start of a session, when the user references a past conversation, or whenever completing a task might benefit from recalling relevant facts. Supports semantic fallback for paraphrases (e.g. 'fav color' matches 'favorite-color').",
    parameters: {
      query: {
        type: "string",
        description: "Search query to match against memory keys, values and categories (case-insensitive substring + semantic tokens). Empty string means no query filter.",
      },
      category: {
        type: "string",
        description: "Category filter (e.g. 'identity', 'preferences', 'project', 'decisions'). Use 'general' or omit for no category filter.",
      },
      limit: {
        type: "integer",
        description: "Maximum number of results to return (default 10, max 50).",
      },
      mode: {
        type: "string",
        description: "Search mode: 'keyword' (exact substring only), 'semantic' (token Jaccard only), 'hybrid' (default, keyword boost + semantic).",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                key: { type: "string", required: true },
                value: { type: "string", required: true },
                category: { type: "string", required: true },
                timestamp: { type: "string", required: true },
              },
            },
          },
          count: { type: "integer", required: true },
        },
      },
      render: (_args, value) => {
        if (value.count === 0) return [{ type: "text", text: "No memories found." }];
        const lines = value.results.map((r) => `- [${r.key}] ${r.value} (${r.category}) (${r.timestamp})`);
        return [{ type: "text", text: `Found ${value.count} memories:\n${lines.join("\n")}` }];
      },
    },
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      if (exec?.signal?.aborted) throw new Error(`Aborted: ${exec.signal.reason ?? "signal aborted"}`);
      const memory = await loadMemory(memoryPath);
      const query = (args.query || "").trim();
      const category = (args.category || "general").trim() || "general";
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
      const mode = ["keyword", "semantic", "hybrid"].includes(args.mode) ? args.mode : "hybrid";

      const scored = hybridSearch(memory.facts, query, category, limit, mode);
      const results = scored.map((s) => s.fact);
      return { results, count: results.length };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Search memory${args.query ? `: ${args.query}` : ""}${args.category && args.category !== "general" ? ` (${args.category})` : ""}${args.mode && args.mode !== "hybrid" ? ` [${args.mode}]` : ""}`,
      kind: "search",
      rawInput: args,
    }),
  });
}
