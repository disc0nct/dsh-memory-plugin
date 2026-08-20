import { defineTool } from "@deepseek-ai/dsh-tools";
import { loadMemory, saveMemory, withWriteLock } from "../storage.js";

export function buildClearTool(memoryPath) {
  return defineTool({
    name: "memory_clear",
    description:
      "Clear ALL stored long-term memories. This action cannot be undone. Only use this when explicitly instructed by the user.",
    parameters: {
      confirm: {
        type: "boolean",
        description: "Must be true to confirm clearing all memories. Prevents accidental clears.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cleared: { type: "boolean", required: true },
          count: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.cleared ? `Cleared ${value.count} memories.` : `Clear cancelled.` }],
    },
    timeoutMs: 5000,
    execute: async (args, exec) => {
      if (exec?.signal?.aborted) throw new Error(`Aborted: ${exec.signal.reason ?? "signal aborted"}`);
      if (args.confirm !== true) {
        const memory = await loadMemory(memoryPath);
        return { cleared: false, count: memory.facts.length };
      }
      return withWriteLock(memoryPath, async () => {
        const memory = await loadMemory(memoryPath);
        const count = memory.facts.length;
        await saveMemory(memoryPath, { facts: [] });
        return { cleared: true, count };
      });
    },
    presentCall: () => ({
      card: "generic",
      title: "Clear all memories",
      kind: "delete",
      rawInput: {},
    }),
  });
}
