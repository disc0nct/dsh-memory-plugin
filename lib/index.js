import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

const name = "tool-memory";
const inject = ["tools"];

const DEFAULT_MEMORY_PATH = join(
  process.env.DSH_HOME || join(homedir(), ".dsh"),
  "memory.json"
);

const Config = z.object({
  memoryPath: z.string().default(DEFAULT_MEMORY_PATH)
});

async function loadMemory(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return { facts: [] };
    throw error;
  }
}

async function saveMemory(path, memory) {
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(memory, null, 2);
  const tmp = path + ".tmp";
  await writeFile(tmp, content, "utf8");
  await writeFile(path, content, "utf8");
}

function buildStoreTool(memoryPath) {
  return defineTool({
    name: "memory_store",
    description: "Save an important fact to long-term memory. Use this proactively whenever the user reveals something you should remember across sessions — name, preferences, project details, decisions, goals, or anything material — and whenever the user explicitly asks you to remember something. Each fact persists until explicitly deleted.",
    parameters: {
      key: {
        type: "string",
        required: true,
        description: "A short kebab-case key identifying this fact (e.g. 'user-name', 'favorite-color', 'project-language', 'deadline')."
      },
      value: {
        type: "string",
        required: true,
        description: "The value to remember."
      },
      category: {
        type: "string",
        required: true,
        description: "Category for grouping (e.g. 'identity', 'preferences', 'project', 'decisions'). Use 'general' if no specific category applies."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          key: { type: "string", required: true },
          value: { type: "string", required: true },
          category: { type: "string", required: true },
          timestamp: { type: "string", required: true }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Stored memory [${value.key}] (${value.category}): ${value.value}`
      }]
    },
    execute: async (args) => {
      const memory = await loadMemory(memoryPath);
      const id = createHash("sha256")
        .update(`${args.key}\0${JSON.stringify(args.value)}\0${Date.now()}`)
        .digest("hex")
        .slice(0, 16);
      const fact = {
        id,
        key: args.key,
        value: String(args.value),
        category: args.category || "general",
        timestamp: new Date().toISOString()
      };
      const existing = memory.facts.findIndex((f) => f.key === fact.key);
      if (existing >= 0) memory.facts[existing] = fact;
      else memory.facts.push(fact);
      await saveMemory(memoryPath, memory);
      return fact;
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Remember: ${args.key} (${args.category})`,
      kind: "other",
      rawInput: args
    })
  });
}

function buildSearchTool(memoryPath) {
  return defineTool({
    name: "memory_search",
    description: "Search long-term memory by keyword or category. Use this at the start of a session, when the user references a past conversation, or whenever completing a task might benefit from recalling relevant facts from earlier sessions. Matches against keys, values, and categories.",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "Search query to match against memory keys and values (case-insensitive substring). Use empty string for no query filter."
      },
      category: {
        type: "string",
        required: true,
        description: "Category filter (e.g. 'identity', 'preferences', 'project', 'decisions'). Use 'general' for no category filter."
      },
      limit: {
        type: "integer",
        required: true,
        description: "Maximum number of results to return (default 10, max 50)."
      }
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
                timestamp: { type: "string", required: true }
              }
            }
          },
          count: { type: "integer", required: true }
        }
      },
      render: (_args, value) => {
        if (value.count === 0) return [{ type: "text", text: "No memories found." }];
        const lines = value.results.map((r) => `- [${r.key}] ${r.value} (${r.category}) (${r.timestamp})`);
        return [{ type: "text", text: `Found ${value.count} memories:\n${lines.join("\n")}` }];
      }
    },
    execute: async (args) => {
      const memory = await loadMemory(memoryPath);
      const query = (args.query || "").toLowerCase();
      const category = args.category || "general";
      const limit = Math.min(args.limit || 10, 50);
      let results = memory.facts;
      if (category !== "general") {
        results = results.filter((f) => f.category === category);
      }
      if (query) {
        results = results.filter((f) => 
          f.key.toLowerCase().includes(query) || 
          f.value.toLowerCase().includes(query)
        );
      }
      results = results.slice(-limit).reverse();
      return { results, count: results.length };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Search memory${args.query ? ": " + args.query : ""}${args.category !== "general" ? ` (${args.category})` : ""}`,
      kind: "read",
      rawInput: args
    })
  });
}

function buildListTool(memoryPath) {
  return defineTool({
    name: "memory_list",
    description: "List all stored long-term memories. Useful for reviewing what is remembered across conversations.",
    parameters: {
      category: {
        type: "string",
        required: true,
        description: "Category filter. Use 'general' for no category filter."
      }
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
                timestamp: { type: "string", required: true }
              }
            }
          },
          count: { type: "integer", required: true }
        }
      },
      render: (_args, value) => {
        if (value.count === 0) return [{ type: "text", text: "No memories stored." }];
        const lines = value.facts.map((f) => `- [${f.key}] ${f.value} (${f.category}) (${f.timestamp})`);
        return [{ type: "text", text: `All memories (${value.count}):\n${lines.join("\n")}` }];
      }
    },
    execute: async (args) => {
      const memory = await loadMemory(memoryPath);
      let facts = memory.facts;
      if (args.category !== "general") {
        facts = facts.filter((f) => f.category === args.category);
      }
      return { facts, count: facts.length };
    },
    presentCall: () => ({
      card: "generic",
      title: "List memories",
      kind: "read",
      rawInput: {}
    })
  });
}

function buildDeleteTool(memoryPath) {
  return defineTool({
    name: "memory_delete",
    description: "Delete a specific memory by its exact key.",
    parameters: {
      key: {
        type: "string",
        required: true,
        description: "The exact key of the memory to delete."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          deleted: { type: "boolean", required: true },
          key: { type: "string", required: true }
        }
      },
      render: (_args, value) => [
        { type: "text", text: value.deleted ? `Deleted memory [${value.key}].` : `Memory [${value.key}] not found.` }
      ]
    },
    execute: async (args) => {
      const memory = await loadMemory(memoryPath);
      const before = memory.facts.length;
      memory.facts = memory.facts.filter((f) => f.key !== args.key);
      const deleted = memory.facts.length < before;
      if (deleted) await saveMemory(memoryPath, memory);
      return { deleted, key: args.key };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Delete memory: ${args.key}`,
      kind: "other",
      rawInput: args
    })
  });
}

function buildClearTool(memoryPath) {
  return defineTool({
    name: "memory_clear",
    description: "Clear ALL stored long-term memories. This action cannot be undone. Only use this when explicitly instructed by the user.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cleared: { type: "boolean", required: true },
          count: { type: "integer", required: true }
        }
      },
      render: (_args, value) => [
        { type: "text", text: `Cleared ${value.count} memories.` }
      ]
    },
    execute: async () => {
      const memory = await loadMemory(memoryPath);
      const count = memory.facts.length;
      await saveMemory(memoryPath, { facts: [] });
      return { cleared: true, count };
    },
    presentCall: () => ({
      card: "generic",
      title: "Clear all memories",
      kind: "other",
      rawInput: {}
    })
  });
}

function apply(ctx, config = {}) {
  const memoryPath = config.memoryPath || DEFAULT_MEMORY_PATH;
  ctx.tools.register(buildStoreTool(memoryPath));
  ctx.tools.register(buildSearchTool(memoryPath));
  ctx.tools.register(buildListTool(memoryPath));
  ctx.tools.register(buildDeleteTool(memoryPath));
  ctx.tools.register(buildClearTool(memoryPath));
}

export { apply, Config, inject, name };