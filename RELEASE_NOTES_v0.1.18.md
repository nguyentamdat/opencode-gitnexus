# v0.1.18 — Fixed OpenCode Plugin Loader Bug 🎉

## Tóm tắt

Phiên bản này sửa lỗi nghiêm trọng khiến plugin **không load được** trong OpenCode, gây ra lỗi:

```
Plugin export is not a function failed to load plugin
```

## Vấn đề gì đã xảy ra?

### Root Cause
OpenCode (và Claude Code) có một bug trong plugin loader: nó duyệt qua **tất cả exports** của module và kiểm tra xem có phải function không. Nếu gặp export không phải function (như object, constant), nó throw error ngay lập tức.

Plugin `opencode-gitnexus` v0.1.17 export thêm `_testing` (một object chứa test helpers), và điều này khiến loader crash:

```typescript
// src/index.ts (v0.1.17) - BỊ LỖI
export { gitNexusPlugin as server };
export default gitNexusPlugin;
export const _testing = { ... }; // ← Lỗi! Object không phải function
```

### Tại sao lỗi này khó phát hiện?
1. **Module load thành công** — log hiện "MODULE LOADED"
2. **Nhưng plugin function không bao giờ được gọi** — thiếu log "Plugin function invoked"
3. **MCP server không bao giờ register** — GitNexus tools không xuất hiện trong MCP panel
4. **OpenCode cache npm package** — load bản 0.1.17 cũ thay vì build local mới

## Giải pháp

### 1. Tách non-plugin exports ra khỏi entrypoint

```typescript
// src/index.ts (v0.1.18) - ĐÃ SỬA ✅
export { gitNexusPlugin as server };
export default gitNexusPlugin;
// Không còn _testing ở đây nữa!
```

### 2. Tạo module riêng cho test helpers

```typescript
// src/core.ts — Core logic và constants
export { isSourceCodeRepo, autoAnalyzeRepo, ... };

// src/testing.ts — Test-only exports  
export { _testing } from './core';
```

### 3. Cập nhật cache OpenCode

Vì OpenCode cache npm package trong `~/.cache/opencode/packages/`, cần manual update:

```bash
# Copy build mới vào cache
cp -r ./dist/* ~/.cache/opencode/packages/opencode-gitnexus@latest/node_modules/opencode-gitnexus/dist/
cp package.json ~/.cache/opencode/packages/opencode-gitnexus@latest/node_modules/opencode-gitnexus/

# Restart OpenCode
```

## Verification ✅

Sau khi apply fix:

```bash
$ node -e "import('./dist/index.js').then(m=>console.log(Object.keys(m)))"
[ 'default', 'server' ]  ← Chỉ có 2 function exports ✅

$ cat /tmp/opencode-gitnexus.log | tail -3
Plugin function invoked
Plugin returning hooks: config=function, system.transform=function  
GitNexus MCP registered: ["npx","-y","gitnexus","mcp"]  ✅
```

## Breaking Changes

**Không có** — tất cả public APIs giữ nguyên. Chỉ internal test structure thay đổi.

## Upgrade Guide

### Cho users

```bash
# 1. Update plugin
npm install -g opencode-gitnexus@latest

# 2. Clear OpenCode cache
rm -rf ~/.cache/opencode/packages/opencode-gitnexus@latest

# 3. Restart OpenCode server
```

### Cho developers

```bash
# Clone repo
git clone https://github.com/nguyentamdat/opencode-gitnexus
cd opencode-gitnexus

# Build local
bun install
bun run build

# Copy vào OpenCode cache (dev mode)
cp -r dist/* ~/.cache/opencode/packages/opencode-gitnexus@latest/node_modules/opencode-gitnexus/dist/
```

## Cảm ơn

- **OpenCode Community** — báo cáo lỗi và giúp reproduce
- **Claude** — giúp analyze và fix
- **Bun** — build tools tuyệt vời

---

**Full Changelog**: https://github.com/nguyentamdat/opencode-gitnexus/compare/v0.1.17...v0.1.18

**Issues fixed**:
- Fixes plugin loader crash với non-function exports
- Fixes MCP registration không chạy

**Commit**: `v0.1.18`
