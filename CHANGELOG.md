# Changelog

All notable changes to `@deepseek-ai/dsh-tool-memory` are documented here. Follows [Keep a Changelog](https://keepachangelog.com/) and [SemVer](https://semver.org/).

## [1.2.0] - 2026-08-20

### Added
- `lib/tools/stats.js:1-79` `memory_stats` tool (count, per-category, oldest/newest, fileSize) `isConcurrencySafe` `timeoutMs 5000` (`lib/index.js:9,24`)
- `test/stats.test.js:1-90` 5 tests for stats and cache (empty, after-stores, clone-isolation, external invalidation, abort)

### Changed
- `lib/storage.js:8-78` in-memory `mtimeMs+size` cache with `_cloneFacts`, `stat` check before `read`, cache update on `save`, `_clearCache` for tests — avoids re-read if file unchanged
- `lib/tools/search.js:59`, `list.js:45`, `get.js:42`, `stats.js:41` add `exec.signal` abort guard
- `package.json:3` bump `1.2.0`
- `README.md:9-16,151-173,241-259` document 7 tools, perf cache, `memory_stats`, How It Works 8 steps, Requirements `rc.8`

### Fixed
- Cache clone prevents mutation leak; external file change invalidates via `mtime`

## [1.1.1] - 2026-08-20

### Fixed
- `package.json:42-51` move `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery` to `peerDependencies` (keep `devDependencies` for tests) + `peer:@deepseek-ai/cordis ^4.0.1` — avoids dual-instance `TOOL_RUNTIME_SCHEDULER` `prepare` UNKNOWN

## [1.1.0] - 2026-08-20

### Added
- `lib/config.js:1-28` `DEFAULT_MEMORY_PATH`, `Config` (schemastery), `normalizeMemoryPath` (`~/` expand, `resolve`)
- `lib/validation.js:1-23` `KEY_RE`, `MAX_KEY/VALUE/CATEGORY`, `validateKey/Category/Value`
- `lib/storage.js:1-58` atomic `write(tmp)+rename`, `mkdir -p`, `MAX_FACTS` cap, shape guard, corrupt backup `*.corrupt.*`
- `lib/search/scoring.js:1-137` hybrid semantic search (token Jaccard + substring boosts, `mode: keyword|semantic|hybrid` default `hybrid`)
- `lib/tools/*:1-80` split `store`, `search`, `list`, `get`, `delete`, `clear` + new `get` (fast exact) and `clear` `confirm:true` guard; `isConcurrencySafe` for reads, `timeoutMs:5000`, `kind` hints, `randomUUID`
- `lib/index.js:1-28` re-export orchestrator (preserves `apply/Config/inject/name`)
- `.gitignore:1-15` `node_modules`, `*.tgz`, `*.tmp`, `*.corrupt.*`
- `test/memory.test.js:1-180` 11 tests + `test/semantic.test.js:1-85` 6 tests
- `README.md` 7 tools, semantic `mode`, `How It Works` 8 steps, `Requirements` `rc.8`

### Changed
- `package.json:3` `1.1.0`, deps `dsh-tools ^0.1.0-rc.8`
- `lib/index.js` from 506 LOC monolith to modular

### Fixed
- `package.json:43` `dsh-tools ^0.1.0-rc.7` → `^0.1.0-rc.8` to match global `dsh@rc.8` (fixes `prepare` UNKNOWN)
- `lib/storage.js` `saveMemory` double `writeFile` → `rename` atomic
- `memory_search` now matches `category`, sorts by `score` then `timestamp` desc, `upsert` moves to most-recent

## [1.0.0] - 2026-08-18

### Added
- Initial commit `lib/index.js:1-321` 5 tools (`store/search/list/delete/clear`) with `schemastery` Config, `defineTool`, `inject=["tools"]`
- `cordis.patch.yml:1-6` bundle `tool-memory`, `package.json:1-49` `dsh.bundle.patch`
- `README.md:1-252` install/usage, `LICENSE` MIT

[1.2.0]: https://github.com/disc0nct/dsh-memory-plugin/releases/tag/v1.2.0
[1.1.1]: https://github.com/disc0nct/dsh-memory-plugin/releases/tag/v1.1.1
[1.1.0]: https://github.com/disc0nct/dsh-memory-plugin/releases/tag/v1.1.0
[1.0.0]: https://github.com/disc0nct/dsh-memory-plugin/commit/5881cd9
