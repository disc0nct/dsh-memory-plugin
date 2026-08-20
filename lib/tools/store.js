import { randomUUID } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { validateKey, validateCategory, validateValue } from "../validation.js";
import { loadMemory, saveMemory } from "../storage.js";

export function buildStoreTool(memoryPath) {
  return defineTool({
    name: "memory_store",
    description:
      "Save an important fact to long-term memory. Use this proactively whenever the user reveals something you should remember across sessions — name, preferences, project details, decisions, goals, or anything material — and whenever the user explicitly asks you to remember something. Each fact persists until explicitly deleted. Upserts by key.",
    parameters: {
      key: {
        type: "string",
        required: true,
        description: "A short kebab-case key identifying this fact (e.g. 'user-name', 'favorite-color', 'project-language', 'deadline').",
      },
      value: {
        type: "string",
        required: true,
        description: "The value to remember (max 10000 chars).",
      },
      category: {
        type: "string",
        description: "Category for grouping (e.g. 'identity', 'preferences', 'project', 'decisions'). Defaults to 'general'. Must be kebab-case if provided.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true, description: "Unique fact id" },
          key: { type: "string", required: true },
          value: { type: "string", required: true },
          category: { type: "string", required: true },
          timestamp: { type: "string", required: true, description: "ISO-8601 timestamp" },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: `Stored memory [${value.key}] (${value.category}): ${value.value}`,
        },
      ],
    },
    timeoutMs: 5000,
    execute: async (args, exec) => {
      if (exec?.signal?.aborted) throw new Error(`Aborted: ${exec.signal.reason ?? "signal aborted"}`);
      validateKey(args.key);
      validateValue(args.value);
      const category = args.category?.trim() || "general";
      validateCategory(category);
      const memory = await loadMemory(memoryPath);
      const fact = {
        id: randomUUID(),
        key: args.key.trim(),
        value: String(args.value),
        category,
        timestamp: new Date().toISOString(),
      };
      const idx = memory.facts.findIndex((f) => f.key === fact.key);
      if (idx >= 0) {
        memory.facts.splice(idx, 1);
        memory.facts.push(fact);
      } else {
        memory.facts.push(fact);
      }
      await saveMemory(memoryPath, memory);
      return fact;
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Remember: ${args.key} (${args.category || "general"})`,
      kind: "edit",
      rawInput: args,
    }),
  });
}
