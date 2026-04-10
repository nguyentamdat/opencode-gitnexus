# v0.1.19 — OMO Project Patterns Integration 🚀

## Summary

This version applies production-hardened patterns from the oh-my-openagent (OMO) project to improve reliability, observability, and error handling.

## What's New

### 🏗️ Structured Logging (omo pattern)
- **New module**: `src/logger.ts` (227 lines)
- Factory pattern with `createLogger()` for configurable loggers
- JSON-structured log entries with rich context fields
- Multiple sinks: `FileLogSink` (buffered), `ConsoleLogSink`
- `ILogger` interface for testability and abstraction
- Lazy initialization - logger created on first use, not at module load
- Cross-platform temp path using `os.tmpdir()`

### 🛡️ Resilience Patterns (omo pattern)
- **New module**: `src/resilience.ts` (202 lines)
- Exponential backoff retry with configurable options
- Circuit breaker pattern to prevent cascading failures
- Combined `withResilience()` for retry + circuit breaker
- Specialized `fetchWithRetry()` for HTTP calls
- NPM registry calls now protected with circuit breaker + retry

### ❌ Error Classification (omo pattern)
- **New module**: `src/errors.ts` (132 lines)
- Granular error types: `GitNexusError`, `NetworkError`, `FileSystemError`, `AnalysisError`, `SpawnError`, `NPMRegistryError`
- `classifyError()` for automatic error categorization
- `safeAsync()` / `safeSync()` wrappers for graceful degradation
- Error codes and recoverability flags for better handling

### 🧪 Test Utilities (omo pattern)
- **New module**: `src/test-utils.ts` (101 lines)
- `MockLogger` for capturing and verifying log entries in tests
- `NoOpLogger` for disabled logging scenarios
- Full `ILogger` interface compliance

## Key Improvements

### Production Safety
- **Fixed**: Node process no longer hangs on import (interval.unref() + lazy init)
- **Fixed**: No memory leak when log file can't be opened (early return)
- **Fixed**: No memory growth on write failures (always clear buffer)
- **Fixed**: Portable temp path for Windows support (os.tmpdir())

### Code Quality
- **TypeScript strict mode**: All new code passes strict checks
- **Test coverage**: Existing 42 tests still pass
- **Build size**: 27KB index.js, 68KB total dist
- **Zero breaking changes**: All public APIs unchanged

### Observability
- Structured JSON logging with context
- Better error messages with error codes
- Circuit breaker state monitoring
- Retry attempt logging

## Refactored Modules

### src/auto-update.ts
- Added circuit breaker for NPM registry calls
- Exponential backoff retry for network failures
- Better error handling using safe wrappers
- Optional logging callback for observability

### src/core.ts
- Updated to use `ILogger` interface instead of simple log function
- Better structured logging throughout

### src/index.ts
- Lazy logger initialization (getLogger())
- Cross-platform temp path
- Structured logging with context

## Verification ✅

```bash
# Type check
$ bun run check
✅ No TypeScript errors

# Tests
$ bun test
42 pass, 0 fail, 68 expect() calls

# Build
$ bun run build
✅ 27KB index.js, all .d.ts files generated

# Node import (no hang)
$ timeout 3 node -e "import('./dist/index.js').then(() => process.exit(0))"
✅ Exits cleanly
```

## Files Added
- `src/logger.ts` - Structured logging
- `src/resilience.ts` - Retry + circuit breaker
- `src/errors.ts` - Error classification
- `src/test-utils.ts` - Test helpers

## Files Modified
- `src/auto-update.ts` - Added resilience patterns
- `src/core.ts` - Updated to ILogger interface
- `src/index.ts` - Lazy logger, structured logging
- `src/testing.ts` - ILogger support

## Breaking Changes

**None** — all public APIs remain unchanged. Internal improvements only.

## Upgrade Guide

### For Users

```bash
# Update plugin
npm install -g opencode-gitnexus@latest

# Or wait for auto-update
# Plugin will self-update on next OpenCode restart
```

### For Developers

```bash
# Pull latest
git pull origin main

# Install dependencies
bun install

# Build
bun run build

# Test
bun test
```

## Thanks

- **OMO Project** — for the excellent patterns and architecture
- **Oracle Review** — for catching production blockers
- **Bun** — for excellent build tools and test runner

---

**Full Changelog**: https://github.com/nguyentamdat/opencode-gitnexus/compare/v0.1.18...v0.1.19

**Issues addressed**:
- Improved reliability with retry and circuit breaker patterns
- Better observability with structured logging
- Production safety fixes for memory and process lifecycle
- Cross-platform Windows support improvements

**Commit**: `v0.1.19`
