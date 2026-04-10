## 🚀 v0.1.18 — Critical Fix: Plugin Loader Crash

### Problem Fixed
Fixed the **"Plugin export is not a function"** error that prevented the plugin from loading in OpenCode.

### Root Cause
OpenCode's plugin loader iterates over all module exports and validates they are functions. The previous version exported `_testing` (an object containing test helpers), which caused the loader to crash.

### Solution
- **Refactored exports**: Package root now only exports `default` and `server` (both plugin functions)
- **Moved test helpers**: `_testing` and other internals moved to `src/testing.ts` and `src/core.ts`
- **Clean architecture**: Runtime code separated from test-only utilities

### Verification
```bash
# Build exports only plugin functions
$ node -e "import('./dist/index.js').then(m=>console.log(Object.keys(m)))"
[ 'default', 'server' ] ✅

# Plugin loads successfully, MCP registers
$ cat /tmp/opencode-gitnexus.log
Plugin function invoked ✅
GitNexus MCP registered ✅
```

### Breaking Changes
None. All public APIs remain unchanged. Only internal structure improved.

### Upgrade
```bash
# Clear OpenCode cache and restart
rm -rf ~/.cache/opencode/packages/opencode-gitnexus@latest
# Then restart OpenCode server
```

---

**Full release notes**: See `RELEASE_NOTES_v0.1.18.md`

**Thanks to**: OpenCode Community, Claude, and Bun team
