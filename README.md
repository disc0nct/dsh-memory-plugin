# @deepseek-ai/dsh-tool-memory

![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-blue.svg)

A persistent memory plugin for DeepSeek Harness (DSH) that enables agents to store and recall information across sessions, similar to the memory system in Hermes agent AI.

## Features

- 🧠 **Persistent Storage**: Memories are saved to disk and survive across sessions
- 🔍 **Flexible Search**: Hybrid `keyword+semantic` (token Jaccard + substring) with `mode: hybrid|keyword|semantic`
- 🏷️ **Categorization**: Organize memories with optional categories (kebab-case, defaults to `general`)
- 📋 **Seven Tools**: `memory_store`, `memory_search`, `memory_get`, `memory_list`, `memory_delete`, `memory_clear`, `memory_stats`
- 🔄 **Atomic Writes**: `write+rename` with `mkdir -p`, corrupt-file recovery to `*.corrupt.*`, orphan `*.tmp.*` sweep (>1h) on load
- ⚡ **Performance**: In-memory `mtime` cache, `timestampMs` numeric sort, inverted index `Map<token,Set<id>>` for sub-linear `hybridSearch`, `MAX_FACTS` cap, `timeoutMs:5000`, `isConcurrencySafe` for reads
- ✅ **Validation & Safety**: kebab-case keys, `MAX_TIMESTAMP_MS`, `timestampMs` auto-generated, `MemoryPluginError` + 3× retry for `EACCES/EBUSY`, `memory_clear` `confirm:true`, `withWriteLock` per-file serialization
- 🧩 **Modular & DSH-Native**: `lib/config|storage|validation|search/scoring|tools/*`, `peerDependencies` to avoid dual-instance `prepare` bug, graceful fallback to linear scan

## Installation

This package ships a `dsh.bundle` manifest, so it can be installed as a
regular profile bundle.

### As a DSH Plugin

1. Add the plugin to your DSH profile (this runs `pnpm add` in the profile
   directory, so a git URL works):
   ```bash
   dsh plugin --profile <your-profile> add github:disc0nct/dsh-memory-plugin
   ```

2. Register it as a bundle in the profile's `package.json`
   (`$DSH_HOME/profiles/<your-profile>/package.json`):
   ```json
   {
     "dependencies": {
       "@deepseek-ai/dsh-tool-memory": "github:disc0nct/dsh-memory-plugin"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "@deepseek-ai/dsh-tool-memory"
         ]
       }
     }
   }
   ```

3. Boot the profile:
   ```bash
   dsh --profile <your-profile>
   ```

## Usage

### Available Tools

Once installed, the following tools become available to your DSH agent:

#### `memory_store`
Save an important fact to long-term memory.

```javascript
// Store a user preference
await ctx.tools.memory_store({
  key: "user-name",
  value: "Alice",
  category: "preferences"
});

// Store project information
await ctx.tools.memory_store({
  key: "project-language",
  value: "TypeScript",
  category: "project"
});

// Store a decision
await ctx.tools.memory_store({
  key: "api-decision",
  value: "Use REST API for simplicity",
  category: "decisions"
});
```

#### `memory_search`
Search for memories by keyword, category, or semantic paraphrase (hybrid `keyword+token Jaccard` ranking, dependency-free).

```javascript
// Search all memories
const results = await ctx.tools.memory_search({
  query: "Alice"
});

// Search by category
const results = await ctx.tools.memory_search({
  category: "preferences"
});

// Combined search
const results = await ctx.tools.memory_search({
  query: "API",
  category: "decisions",
  limit: 5
});

// Semantic paraphrase: "fav color" matches "favorite-color"
const results = await ctx.tools.memory_search({
  query: "fav color",
  mode: "hybrid" // | "keyword" | "semantic" (default: "hybrid")
});

// Force exact substring only
const results = await ctx.tools.memory_search({
  query: "color",
  mode: "keyword"
});
```

#### `memory_get`
Fast exact lookup by key (vs `memory_search` scan).

```javascript
const { found, fact } = await ctx.tools.memory_get({ key: "user-name" });
if (found) console.log(fact.value);
```

#### `memory_list`
List all stored memories (most recent first, optionally filtered).

```javascript
// List all memories
const memories = await ctx.tools.memory_list();

// List memories by category
const memories = await ctx.tools.memory_list({
  category: "project"
});
```

#### `memory_delete`
Delete a specific memory by its key.

```javascript
await ctx.tools.memory_delete({
  key: "user-name"
});
```

#### `memory_clear`
Clear ALL stored memories (requires explicit confirmation).

```javascript
// cancelled without confirm
await ctx.tools.memory_clear(); // { cleared:false, count: N }

// confirmed
await ctx.tools.memory_clear({ confirm: true }); // { cleared:true, count: N }
```

#### `memory_stats`
Get health stats (count, per-category, oldest/newest, file size).

```javascript
const stats = await ctx.tools.memory_stats();
console.log(stats.count, stats.categories); // {count: 12, categories:{project:5}}
```

## Memory Storage Format

Memories are stored in `~/.dsh/memory.json` with this structure:

```json
{
  "facts": [
    {
      "id": "unique-identifier",
      "key": "user-name",
      "value": "Alice",
      "category": "preferences",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

## Configuration

The memory file defaults to `$DSH_HOME/memory.json` (or `~/.dsh/memory.json`
when `DSH_HOME` is unset). Override it in the profile's patch layer
(`$DSH_HOME/profiles/<your-profile>/cordis.patch.yml`):

```yaml
- id: tool-memory
  config:
    memoryPath: /absolute/path/to/memory.json
```

## Examples

### Remembering User Information
```javascript
// When user introduces themselves
if (userMessage.includes("my name is")) {
  const name = extractName(userMessage);
  await ctx.tools.memory_store({
    key: "user-name",
    value: name,
    category: "identity"
  });
}

// Later, when needing to address the user
const memory = await ctx.tools.memory_search({
  query: "name",
  category: "identity"
});
if (memory.results.length > 0) {
  await ctx.tools.memory_store({
    key: "greeting-used",
    value: `Hello ${memory.results[0].value}!`,
    category: "interaction"
  });
}
```

### Project Context Tracking
```javascript
// When starting work on a project
await ctx.tools.memory_store({
  key: "project-start",
  value: `Started work on ${projectName} at ${new Date().toISOString()}`,
  category: "project"
});

// When making a technical decision
await ctx.tools.memory_store({
  key: "tech-decision-db",
  value: "Selected PostgreSQL for reliability",
  category: "decisions"
});

// Later, when continuing work
const projectInfo = await ctx.tools.memory_list({
  category: "project"
});
```

## How It Works

The plugin implements persistent memory by:

1. **File Storage**: Atomic `writeFile(tmp)+rename` to `~/.dsh/memory.json` (no double-write), `mkdir -p`, max 5000 facts, orphan `*.tmp.*` sweep (>1h) via `readdir` on `load`
2. **Concurrency**: Per-file `withWriteLock` Promise queue (`lib/storage.js:47-62`) serializes `store/delete/clear` `load→mutate→save` — prevents lost updates; reads remain `isConcurrencySafe`
3. **Timestamps**: `timestamp` (ISO) + `timestampMs` (numeric, `Date.now()`) generated internally; `compareRecent` prefers `timestampMs` (no `Date.parse` per compare); old files migrated on `load` (backfill `timestampMs` via `Date.parse`)
4. **Performance**: `mtime`+`size` cache (`lib/storage.js:105-115`), inverted index `Map<token,Set<id>>` + `Map<id,{hash,tokens}>` cache (`lib/search/scoring.js:50-120`) — `hybridSearch` union of id sets → sub-linear, fallback linear on miss
5. **Efficient Lookups**: Hybrid search token Jaccard + substring boosts then `timestampMs` desc; empty query → recency
6. **Upsert**: `memory_store` replaces existing key and moves to most-recent
7. **Validation**: `key`/`category` kebab-case, `value` ≤10000, `category` ≤32, `timestampMs` `0..4102444800000` (`lib/validation.js:5-27`), `MemoryPluginError` + 3× retry for transient `EACCES/EBUSY`
8. **Recovery**: `SyntaxError` → `*.corrupt.*` backup + empty; `ENOENT` → empty; graceful degradation index→linear
9. **Modular Layout**: `lib/config.js`, `lib/storage.js`, `lib/validation.js`, `lib/search/scoring.js`, `lib/tools/*` (DSH `apply` re-exports)
10. **DSH Idioms**: `Config` via `schemastery`, `defineTool` `timeoutMs:5000` `isConcurrencySafe` `kind` hints `exec.signal` `peerDependencies`

## Requirements

- DeepSeek Harness (DSH) v0.1.0-rc.8 or later
- Node.js v18.0.0 or later (uses `crypto.randomUUID`, `fs/promises.rename`/`stat`)
- Peer dependencies:
  - `@deepseek-ai/cordis`: ^4.0.1
  - `@deepseek-ai/dsh-tools`: ^0.1.0-rc.8
  - `@deepseek-ai/schemastery`: ^3.18.1

## License

MIT License - feel free to use, modify, and distribute this plugin.

## Development

To contribute to this plugin:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure all tests pass (if applicable)
5. Submit a pull request

## Credits

Inspired by the memory systems in agents like Hermes AI, this plugin brings similar long-term memory capabilities to the DeepSeek Harness ecosystem.

---
*Built with ❤️ for the DSH community*
