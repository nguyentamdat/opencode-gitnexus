/**
 * Runtime-agnostic spawn utilities for opencode-gitnexus.
 * Works with both Bun and Node.js runtimes.
 * Falls back from Bun.spawn to child_process.spawn when needed.
 */

import { spawn, spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Check if running in Bun runtime
 */
export function isBunRuntime(): boolean {
  return typeof Bun !== "undefined" && Bun.spawn !== undefined;
}

/**
 * Spawn a process asynchronously (runtime-agnostic)
 */
export async function spawnAsync(
  cmd: string,
  args: string[],
  options: {
    timeout?: number;
    cwd?: string;
    stdout?: "pipe" | "ignore";
    stderr?: "pipe" | "ignore";
  } = {}
): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const stdout = options.stdout ?? "ignore";
  const stderr = options.stderr ?? "ignore";
  const cwd = options.cwd;

  // Use Bun.spawn if available
  if (isBunRuntime()) {
    try {
      const proc = Bun.spawn([cmd, ...args], {
        stdout,
        stderr,
        timeout,
        cwd,
      });

      let output = "";
      let errOutput = "";
      
      if (stdout === "pipe" && proc.stdout) {
        output = await new Response(proc.stdout).text();
      }
      if (stderr === "pipe" && proc.stderr) {
        errOutput = await new Response(proc.stderr).text();
      }

      await proc.exited;
      return { exitCode: proc.exitCode ?? 1, stdout: output, stderr: errOutput };
    } catch {
      return { exitCode: 1 };
    }
  }

  // Fallback to Node.js child_process
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: [
        "ignore",
        stdout === "pipe" ? "pipe" : "ignore",
        stderr === "pipe" ? "pipe" : "ignore",
      ],
      timeout,
      cwd,
    });

    let output = "";
    let errOutput = "";
    
    if (stdout === "pipe" && proc.stdout) {
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
    }
    
    if (stderr === "pipe" && proc.stderr) {
      proc.stderr.on("data", (data) => {
        errOutput += data.toString();
      });
    }

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: output, stderr: errOutput });
    });

    proc.on("error", () => {
      resolve({ exitCode: 1 });
    });
  });
}

/**
 * Run a command and return true if successful (async)
 */
export async function runCommand(
  cmd: string, 
  args: string[], 
  options?: { timeout?: number; cwd?: string }
): Promise<boolean> {
  const result = await spawnAsync(cmd, args, {
    timeout: options?.timeout,
    cwd: options?.cwd,
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

/**
 * Run a command and return stdout if successful (async)
 */
export async function runCommandWithOutput(
  cmd: string,
  args: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await spawnAsync(cmd, args, {
    timeout: options?.timeout,
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode,
  };
}

/**
 * Get directory size in MB using du command
 */
export async function getDirSizeMB(dir: string, timeout?: number): Promise<number> {
  const result = await spawnAsync("du", ["-sm", dir], {
    timeout: timeout ?? 5000,
    stdout: "pipe",
    stderr: "ignore",
  });
  
  if (result.exitCode !== 0 || !result.stdout) {
    return Infinity;
  }
  
  const output = result.stdout.toString();
  const size = parseInt(output.split("\t")[0] || "0", 10);
  return isNaN(size) ? Infinity : size;
}
