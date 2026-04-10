import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { CircuitBreaker, withRetry } from "./resilience.js";
import { NetworkError, safeAsync, safeSync } from "./errors.js";

const PACKAGE_NAME = "opencode-gitnexus";
const NPM_REGISTRY_URL = `https://registry.npmjs.org/-/package/${PACKAGE_NAME}/dist-tags`;

// Circuit breaker for NPM registry calls
const npmCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  successThreshold: 2,
  timeoutMs: 300000, // 5 minutes
});

function getOpenCodeCacheDir(): string {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "opencode");
  }

  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "opencode");
}

function getOpenCodeConfigDir(): string {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "opencode");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode");
}

const CACHE_DIR = path.join(getOpenCodeCacheDir(), "packages");
const CONFIG_DIR = getOpenCodeConfigDir();

function getCachedVersion(): string | null {
  const locations = [
    path.join(CACHE_DIR, "node_modules", PACKAGE_NAME, "package.json"),
    path.join(CACHE_DIR, `${PACKAGE_NAME}@latest`, "node_modules", PACKAGE_NAME, "package.json"),
    path.join(CONFIG_DIR, "node_modules", PACKAGE_NAME, "package.json"),
  ];

  for (const pkgPath of locations) {
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.version) return pkg.version;
      }
    } catch {}
  }

  return null;
}

async function getLatestVersion(): Promise<string | null> {
  return npmCircuitBreaker.execute(async () => {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await fetch(NPM_REGISTRY_URL, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });

          if (!response.ok) {
            throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = (await response.json()) as Record<string, string>;
          return data.latest ?? null;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
      }
    );
  });
}

function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, "$1");
}

function invalidatePackage(): boolean {
  const pkgDirs = [
    path.join(CONFIG_DIR, "node_modules", PACKAGE_NAME),
    path.join(CACHE_DIR, "node_modules", PACKAGE_NAME),
    path.join(CACHE_DIR, `${PACKAGE_NAME}@latest`, "node_modules", PACKAGE_NAME),
  ];

  let removed = false;
  for (const dir of pkgDirs) {
    removed = safeSync(
      () => {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          return true;
        }
        return false;
      },
      false,
      (err) => console.warn(`Failed to remove ${dir}:`, err.message)
    ) || removed;
  }

  for (const baseDir of [CACHE_DIR, path.join(CACHE_DIR, `${PACKAGE_NAME}@latest`)]) {
    const textLock = path.join(baseDir, "bun.lock");
    const binaryLock = path.join(baseDir, "bun.lockb");

    if (fs.existsSync(textLock)) {
      const updated = safeSync(
        () => {
          const content = fs.readFileSync(textLock, "utf-8");
          const lock = JSON.parse(stripTrailingCommas(content));
          if (lock.packages?.[PACKAGE_NAME]) {
            delete lock.packages[PACKAGE_NAME];
            fs.writeFileSync(textLock, JSON.stringify(lock, null, 2));
            return true;
          }
          return false;
        },
        false
      );
      removed = removed || updated;
    } else if (fs.existsSync(binaryLock)) {
      const unlinked = safeSync(
        () => {
          fs.unlinkSync(binaryLock);
          return true;
        },
        false
      );
      removed = removed || unlinked;
    }
  }

  return removed;
}

function syncCachePackageJson(pkgJsonPath: string): boolean {
  return safeSync(() => {
    if (!fs.existsSync(pkgJsonPath)) {
      fs.mkdirSync(path.dirname(pkgJsonPath), { recursive: true });
      fs.writeFileSync(pkgJsonPath, JSON.stringify({ dependencies: { [PACKAGE_NAME]: "latest" } }, null, 2));
      return true;
    }

    const content = fs.readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(content);
    if (!pkg.dependencies) pkg.dependencies = {};
    if (pkg.dependencies[PACKAGE_NAME] === "latest") return true;

    pkg.dependencies[PACKAGE_NAME] = "latest";
    const tmpPath = `${pkgJsonPath}.${crypto.randomUUID()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(pkg, null, 2));
    fs.renameSync(tmpPath, pkgJsonPath);
    return true;
  }, false);
}

function resolveActiveWorkspace(): string {
  const configInstall = path.join(CONFIG_DIR, "node_modules", PACKAGE_NAME, "package.json");
  const cacheInstall = path.join(CACHE_DIR, "node_modules", PACKAGE_NAME, "package.json");

  if (fs.existsSync(configInstall)) return CONFIG_DIR;
  if (fs.existsSync(cacheInstall)) return CACHE_DIR;
  if (fs.existsSync(path.join(CACHE_DIR, "package.json"))) return CACHE_DIR;
  return CONFIG_DIR;
}

export interface UpdateResult {
  currentVersion: string | null;
  latestVersion: string | null;
  updated: boolean;
  error?: string;
}

export async function checkAndUpdate(
  runInstall: (cwd: string) => Promise<boolean>,
  onLog?: (level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void
): Promise<UpdateResult> {
  const currentVersion = getCachedVersion();
  const latestVersion = await getLatestVersion();

  // Log version check results
  onLog?.("info", "Version check", { currentVersion, latestVersion });

  if (!currentVersion || !latestVersion) {
    return { currentVersion, latestVersion, updated: false, error: "Failed to detect versions" };
  }

  if (currentVersion === latestVersion) {
    return { currentVersion, latestVersion, updated: false };
  }

  onLog?.("info", `Update available: ${currentVersion} → ${latestVersion}`);

  try {
    // Sync package.json files
    syncCachePackageJson(path.join(CACHE_DIR, "package.json"));
    const atLatestDir = path.join(CACHE_DIR, `${PACKAGE_NAME}@latest`);
    if (fs.existsSync(atLatestDir)) {
      syncCachePackageJson(path.join(atLatestDir, "package.json"));
    }

    // Invalidate old package
    const invalidated = invalidatePackage();
    onLog?.("info", `Package invalidated: ${invalidated}`);

    // Run install
    const activeWorkspace = resolveActiveWorkspace();
    onLog?.("info", `Running install in ${activeWorkspace}`);

    const success = await runInstall(activeWorkspace);

    if (success) {
      onLog?.("info", "Install succeeded, syncing additional workspaces");

      // Sync additional workspaces
      if (activeWorkspace !== CACHE_DIR) {
        await safeAsync(
          () => runInstall(CACHE_DIR),
          false,
          (err) => onLog?.("warn", "Cache workspace sync failed", { error: err.message })
        );
      }
      if (activeWorkspace !== atLatestDir && fs.existsSync(path.join(atLatestDir, "package.json"))) {
        await safeAsync(
          () => runInstall(atLatestDir),
          false,
          (err) => onLog?.("warn", "Latest workspace sync failed", { error: err.message })
        );
      }
    }

    return {
      currentVersion,
      latestVersion,
      updated: success,
      error: success ? undefined : "bun install failed",
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    onLog?.("error", "Update failed", { error });
    return {
      currentVersion,
      latestVersion,
      updated: false,
      error,
    };
  }
}
