import { defineTool } from "@deepseek-ai/dsh-tools";
import { loadMemory, compareRecent } from "../storage.js";

export function buildListTool(memoryPath) {
  return defineTool({
    name: "memory_list",
    description: "List all stored long-term memories. Useful for reviewing what is remembered across conversations. Optionally filter by category. Returns most recent first.",
    parameters: {
      category: {
        type: "string",
        description: "Category filter. Use 'general' or omit for no category filter.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          facts: {
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
        if (value.count === 0) return [{ type: "text", text: "No memories stored." }];
        const lines = value.facts.map((f) => `- [${f.key}] ${f.value} (${f.category}) (${f.timestamp})`);
        return [{ type: "text", text: `All memories (${value.count}):\n${lines.join("\n")}` }];
      },
    },
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    execute: async (args) => {
      const memory = await loadMemory(memoryPath);
      let facts = memory.facts;
      const category = (args.category || "general").trim() || "general";
      if (category !== "general") {
        facts = facts.filter((f) => f.category === category);
      }
      facts = [...facts].sort(compareRecent);
      return { facts, count: facts.length };
    },
    presentCall: (args) => ({
      card: "generic",
      title: args.category && args.category !== "general" ? `List memories: ${args.category}` : "List memories",
      kind: "read",
      rawInput: args.category && args.category !== "general" ? args : {},
    }),
  });
}
