/**
 * Optional warm mode.
 *
 * On-demand inference pays a model load on every call. A warm server removes
 * that cost and keeps several gigabytes resident forever — which is exactly
 * what the brief says it does not want by default. So this module can *detect*
 * and *use* a warm server, and it will never start one.
 *
 * There are two ways to have one, both user actions:
 *
 *   1. Draw Things.app → Advanced → API Server. The GUI toggle. We do not
 *      automate GUI clicks, by design.
 *   2. `gRPCServerCLI-macOS <models-dir> --no-tls -p 7859`, built from the
 *      draw-things-community repository. Homebrew's `draw-things-cli` formula
 *      ships only the CLI binary, not the server.
 */

import { createConnection } from "node:net";
import type { RemoteTarget } from "./backend/drawthings.js";

export const DEFAULT_GRPC_PORT = 7859;
/** The app's own HTTP API server, when the user enables it. */
export const DEFAULT_HTTP_PORT = 7860;

export interface WarmStatus {
  reachable: boolean;
  host: string;
  port: number;
  latencyMs: number | null;
  hint: string;
}

/** Loopback only. This project never binds or dials a non-local address. */
function assertLoopback(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `Refusing to use a non-loopback warm server ("${host}"). ` +
        "Prompts and images must not leave this machine.",
    );
  }
}

export async function probeWarmServer(
  host = process.env.LOCAL_PHOTO_GRPC_HOST ?? "127.0.0.1",
  port = Number(process.env.LOCAL_PHOTO_GRPC_PORT ?? DEFAULT_GRPC_PORT),
  timeoutMs = 1200,
): Promise<WarmStatus> {
  assertLoopback(host);
  const started = Date.now();

  const reachable = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const done = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

  return {
    reachable,
    host,
    port,
    latencyMs: reachable ? Date.now() - started : null,
    hint: reachable
      ? "A warm server is listening. Route generations to it with `local-photo serve --use`."
      : [
          "No warm server on this port. Two ways to start one, both deliberate user actions:",
          "  • Draw Things.app → Advanced → API Server (GUI toggle; we do not automate it)",
          `  • gRPCServerCLI-macOS "<models-dir>" --no-tls -p ${port}   (build from draw-things-community)`,
        ].join("\n"),
  };
}

export function remoteTargetFor(status: WarmStatus): RemoteTarget {
  assertLoopback(status.host);
  return { host: status.host, port: status.port, tls: false };
}
