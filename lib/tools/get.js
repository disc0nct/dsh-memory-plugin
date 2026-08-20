import { defineTool } from "@deepseek-ai/dsh-tools";
import { validateKey } from "../validation.js";
import { loadMemory } from "../storage.js";

export function buildGetTool(memoryPath) {
  return defineTool({
    name: "memory_get",
    description: "Get a single memory by its exact key. Fast exact lookup (vs search). Returns found:false if not present.",
    parameters: {
      key: {
        type: "string",
        required: true,
        description: "The exact key of the memory to retrieve (kebab-case).",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          found: { type: "boolean", required: true, description: "Whether the key was found" },
          fact: {
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
      },
      render: (_args, value) => {
        if (!value.found || !value.fact) return [{ type: "text", text: "Memory not found." }];
        const f = value.fact;
        return [{ type: "text", text: `[${f.key}] ${f.value} (${f.category}) (${f.timestamp})` }];
      },
    },
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      if (exec?.signal?.aborted) throw new Error(`Aborted: ${exec.signal.reason ?? "signal aborted"}`);
      validateKey(args.key);
      const memory = await loadMemory(memoryPath);
      const fact = memory.facts.find((f) => f.key === args.key);
      if (!fact) {
        return { found: false };
      }
      return { found: true, fact };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Get memory: ${args.key}`,
      kind: "read",
      rawInput: args,
    }),
  });
}
