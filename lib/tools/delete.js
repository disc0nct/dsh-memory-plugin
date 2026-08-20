import { defineTool } from "@deepseek-ai/dsh-tools";
import { validateKey } from "../validation.js";
import { loadMemory, saveMemory, withWriteLock } from "../storage.js";

export function buildDeleteTool(memoryPath) {
  return defineTool({
    name: "memory_delete",
    description: "Delete a specific memory by its exact key.",
    parameters: {
      key: {
        type: "string",
        required: true,
        description: "The exact key of the memory to delete.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          deleted: { type: "boolean", required: true },
          key: { type: "string", required: true },
        },
      },
      render: (_args, value) => [
        { type: "text", text: value.deleted ? `Deleted memory [${value.key}].` : `Memory [${value.key}] not found.` },
      ],
    },
    timeoutMs: 5000,
    execute: async (args, exec) => {
      if (exec?.signal?.aborted) throw new Error(`Aborted: ${exec.signal.reason ?? "signal aborted"}`);
      validateKey(args.key);
      return withWriteLock(memoryPath, async () => {
        const memory = await loadMemory(memoryPath);
        const before = memory.facts.length;
        memory.facts = memory.facts.filter((f) => f.key !== args.key);
        const deleted = memory.facts.length < before;
        if (deleted) await saveMemory(memoryPath, memory);
        return { deleted, key: args.key };
      });
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Delete memory: ${args.key}`,
      kind: "delete",
      rawInput: args,
    }),
  });
}
