# @deepseek-ai/dsh-tool-memory

![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-blue.svg)

A persistent memory plugin for DeepSeek Harness (DSH) that enables agents to store and recall information across sessions, similar to the memory system in Hermes agent AI.

## Features

- 🧠 **Persistent Storage**: Memories are saved to disk and survive across sessions
- 🔍 **Flexible Search**: Search memories by keyword or category
- 🏷️ **Categorization**: Organize memories with optional categories
- 📋 **Multiple Tools**: Store, search, list, delete, and clear memories
- 🔄 **Atomic Writes**: Safe file operations to prevent corruption

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
Search for memories by keyword or category.

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
```

#### `memory_list`
List all stored memories.

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
Clear ALL stored memories (use with caution).

```javascript
await ctx.tools.memory_clear();
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

1. **File Storage**: Uses atomic writes to `~/.dsh/memory.json` to prevent corruption
2. **Efficient Lookups**: Loads the entire memory file on each operation (suitable for typical usage)
3. **Upsert Behavior**: `memory_store` replaces existing memories with the same key
4. **Chronological Order**: Search results are returned with most recent first
5. **Safe Operations**: All file operations use temporary files and atomic renames

## Requirements

- DeepSeek Harness (DSH) v0.1.0-rc.7 or later
- Node.js v18.0.0 or later
- Peer dependencies:
  - `@deepseek-ai/dsh-tools`: ^0.1.0-rc.7
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
