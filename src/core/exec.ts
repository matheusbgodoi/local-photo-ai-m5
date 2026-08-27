/**
 * Thin child-process helper.
 *
 * Draw Things' CLI writes a carriage-return progress bar to stdout, which is
 * useless as text but useful as a progress signal. We keep the last complete
 * line for diagnostics and throw away the rest instead of buffering megabytes
 * of redraw frames.
 */

import { spawn } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Last non-empty progress fragment seen, useful when a run fails silently. */
  lastProgress: string;
}

const MAX_CAPTURE = 256 * 1024;

export async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const started = Date.now();

  return new Promise<RunResult>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let lastProgress = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: RunResult | Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (result instanceof Error) reject(result);
      else resolvePromise(result);
    };

    function onAbort() {
      child.kill("SIGTERM");
      // The CLI can hold the GPU briefly; escalate if it ignores SIGTERM.
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      finish(new Error(`Cancelled: ${command}`));
    }

    if (options.signal) {
      if (options.signal.aborted) return onAbort();
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error(`Timed out after ${options.timeoutMs}ms: ${command}`));
      }, options.timeoutMs);
      timer.unref();
    }

    const attach = (stream: NodeJS.ReadableStream, kind: "stdout" | "stderr") => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        // Progress-bar redraws are \r-separated; treat them as lines too.
        buffer += chunk;
        const parts = buffer.split(/\r\n|\r|\n/);
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const isProgress = /\[\s*\d+\/\d+\]|\d+%/.test(trimmed);
          if (isProgress) {
            lastProgress = trimmed;
          } else if (kind === "stdout") {
            if (stdout.length < MAX_CAPTURE) stdout += `${trimmed}\n`;
          } else if (stderr.length < MAX_CAPTURE) {
            stderr += `${trimmed}\n`;
          }
          options.onLine?.(trimmed, kind);
        }
      });
    };

    attach(child.stdout, "stdout");
    attach(child.stderr, "stderr");

    child.on("error", (error) => finish(error));
    child.on("close", (code) =>
      finish({ code, stdout, stderr, lastProgress, durationMs: Date.now() - started }),
    );
  });
}

/** Runs a command and throws with useful context when it fails. */
export async function runOrThrow(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim(), result.lastProgress]
      .filter(Boolean)
      .join("\n")
      .slice(-2000);
    throw new Error(
      `${command} exited with code ${result.code}\n${detail || "(no output)"}`,
    );
  }
  return result;
}
