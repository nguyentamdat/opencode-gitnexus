# v0.1.18 — Fixed OpenCode Plugin Loader Bug 🎉

## Summary

This version fixes a critical bug that prevented the plugin from loading in OpenCode, causing the error:

```
Plugin export is not a function failed to load plugin
```

## What Happened?

### Root Cause
OpenCode (and Claude Code) has a bug in its plugin loader: it iterates over **all exports** from the module and checks if they are functions. If it encounters any non-function export (like objects or constants), it throws an error immediately.

Plugin `opencode-gitnexus` v0.1.17 exported an additional `_testing` (an object containing test helpers), which caused the loader to crash:

```typescript
// src/index.ts (v0.1.17) - BROKEN
export { gitNexusPlugin as server };
export default gitNexusPlugin;
export const _testing = { ... }; // ← Error! Object is not a function
```

### Why Was This Bug Hard to Detect?
1. **Module loaded successfully** — log showed "MODULE LOADED"
2. **But plugin function was never called** — missing "Plugin function invoked" log
3. **MCP server never registered** — GitNexus tools didn't appear in MCP panel
4. **OpenCode caches npm packages** — loaded old v0.1.17 instead of new local build

## Solution

### 1. Separate Non-Plugin Exports from Entrypoint

```typescript
// src/index.ts (v0.1.18) - FIXED ✅
export { gitNexusPlugin as server };
export default gitNexusPlugin;
// No more _testing here!
```

### 2. Create Dedicated Module for Test Helpers

```typescript
// src/core.ts — Core logic and constants
export { isSourceCodeRepo, autoAnalyzeRepo, ... };

// src/testing.ts — Test-only exports  
export { _testing } from './core';
```

### 3. Update OpenCode Cache

Since OpenCode caches npm packages in `~/.cache/opencode/packages/`, manual update needed:

```bash
# Copy new build to cache
cp -r ./dist/* ~/.cache/opencode/packages/opencode-gitnexus@latest/node_modules/opencode-gitnexus/dist/
cp package.json ~/.cache/opencode/packages/opencode-gitnexus@latest/node_modules/opencode-gitnexus/

# Restart OpenCode
```

## Verification ✅

After applying the fix:

```bash
$ node -e "import('./dist/index.js').then(m=>console.log(Object.keys(m)))"
[ 'default', 'server' ]  ← Only 2 function exports ✅

$ cat /tmp/opencode-gitnexus.log | tail -3
Plugin function invoked
Plugin returning hooks: config=function, system.transform=function  
GitNexus MCP registered: ["npx","-y","gitnexus","mcp"]  ✅
```

## Breaking Changes

**None** — all public APIs remain unchanged. Only internal test structure changed.

## Upgrade Guide

### For Users

```bash
# 1. Update plugin
npm install -g opencode-gitnexus@latest

# 2. Clear OpenCode cache
rm -rf ~/.cache/opencode/packages/opencode-gitnexus@latest

# 3. Restart OpenCode server
```

### For Developers

```bash
# Clone repo
git clone https://github.com/nguyentamdat/opencode-gitnexus
cd opencode-gitnexus

# Build local
bun install
bun run build

# Copy to OpenCode cache (dev mode)
cp -r dist/* ~/.cache/opencode/packages/opencode-gitnexus@latest/node_modules/opencode-gitnexus/dist/
```

## Thanks

- **OpenCode Community** — for reporting and helping reproduce the bug
- **Claude** — for analysis and fix
- **Bun** — for excellent build tools

---

**Full Changelog**: https://github.com/nguyentamdat/opencode-gitnexus/compare/v0.1.17...v0.1.18

**Issues fixed**:
- Fixes plugin loader crash with non-function exports
- Fixes MCP registration not running

**Commit**: `v0.1.18`
