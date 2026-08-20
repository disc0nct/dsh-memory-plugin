import { Config, DEFAULT_MEMORY_PATH, normalizeMemoryPath } from "./config.js";
import { loadMemory, saveMemory } from "./storage.js";
import { buildStoreTool } from "./tools/store.js";
import { buildSearchTool } from "./tools/search.js";
import { buildListTool } from "./tools/list.js";
import { buildGetTool } from "./tools/get.js";
import { buildDeleteTool } from "./tools/delete.js";
import { buildClearTool } from "./tools/clear.js";
import { buildStatsTool } from "./tools/stats.js";

const name = "tool-memory";
const inject = ["tools"];

function apply(ctx, config = {}) {
  const rawPath = config.memoryPath ?? DEFAULT_MEMORY_PATH;
  const memoryPath = normalizeMemoryPath(rawPath);
  try {
    ctx.logger?.info?.(`[tool-memory] using memoryPath: ${memoryPath}`);
  } catch {}
  ctx.tools.register(buildStoreTool(memoryPath));
  ctx.tools.register(buildSearchTool(memoryPath));
  ctx.tools.register(buildGetTool(memoryPath));
  ctx.tools.register(buildListTool(memoryPath));
  ctx.tools.register(buildDeleteTool(memoryPath));
  ctx.tools.register(buildClearTool(memoryPath));
  ctx.tools.register(buildStatsTool(memoryPath));
}

export { apply, Config, inject, name };
export { loadMemory, saveMemory, normalizeMemoryPath, DEFAULT_MEMORY_PATH };
