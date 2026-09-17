import type { Logger } from "@repo/logger";
import type { Express } from "express";
import type { Server } from "node:http";

/**
 * Binding the port and shutting down cleanly (ADR-0003).
 *
 * Kept out of `app.ts` so tests can drive the app without a socket, and out of
 * `main.ts` so the drain sequence is testable on its own.
 */

/** How long in-flight requests may take before connections are cut (ADR-0003). */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * The three socket deadlines, in milliseconds (ADR-0073 §4).
 *
 * Node's own defaults are `requestTimeout: 300_000`, `headersTimeout: 60_000`
 * and `keepAliveTimeout: 5_000`, and each is wrong here in its own direction —
 * five minutes for a whole request is a slow-loris budget on an API whose
 * slowest handler is one argon2 hash, and five seconds of keep-alive is
 * *shorter* than the sixty a typical reverse proxy holds, which shows up as
 * intermittent `502`s in front of a perfectly healthy process. Stating all
 * three is the decision; the numbers come from configuration.
 *
 * `undefined` leaves Node's value in place, which is what a caller that has no
 * configuration — a test driving the drain sequence — should get.
 */
export interface ServerTimeouts {
  readonly requestTimeoutMs?: number;
  readonly headersTimeoutMs?: number;
  /** Set above the proxy's, so the proxy is always the end that closes. */
  readonly keepAliveTimeoutMs?: number;
}

export interface StartServerOptions extends ServerTimeouts {
  readonly app: Express;
  readonly port: number;
  readonly logger: Logger;
  /** Released after the last request drains — the database pool, in practice. */
  readonly onShutdown?: () => Promise<void>;
  readonly shutdownTimeoutMs?: number;
}

export interface RunningServer {
  readonly server: Server;
  /** Idempotent: the second signal during a drain is ignored, not obeyed. */
  readonly shutdown: (reason: string) => Promise<void>;
}

export const startServer = ({
  app,
  port,
  logger,
  onShutdown,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  requestTimeoutMs,
  headersTimeoutMs,
  keepAliveTimeoutMs,
}: StartServerOptions): RunningServer => {
  const server = app.listen(port, () => {
    logger.info({ port }, "http server listening");
  });

  // Before the first connection is served rather than inside the `listen`
  // callback: `listen` is asynchronous and a socket accepted in between would
  // otherwise carry Node's defaults (ADR-0073 §4). Each is written only when
  // configuration stated one, so a caller with none keeps Node's.
  if (requestTimeoutMs !== undefined) server.requestTimeout = requestTimeoutMs;
  if (headersTimeoutMs !== undefined) server.headersTimeout = headersTimeoutMs;
  if (keepAliveTimeoutMs !== undefined)
    server.keepAliveTimeout = keepAliveTimeoutMs;

  let shuttingDown = false;

  const shutdown = async (reason: string): Promise<void> => {
    // A user pressing Ctrl-C twice, or an orchestrator sending SIGTERM then
    // SIGKILL, must not start a second drain over the first.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ reason }, "shutting down");

    await new Promise<void>((resolve) => {
      // `close` stops accepting new connections and resolves once the
      // in-flight ones finish; keep-alive sockets would otherwise hold it
      // open indefinitely, hence the deadline.
      const deadline = setTimeout(() => {
        logger.warn(
          { shutdownTimeoutMs },
          "drain timed out, closing connections",
        );
        server.closeAllConnections();
      }, shutdownTimeoutMs);

      server.close(() => {
        clearTimeout(deadline);
        resolve();
      });
    });

    // Only after the last response: closing the pool first would fail requests
    // that were already being served.
    await onShutdown?.();

    logger.info("shutdown complete");
  };

  return { server, shutdown } as const;
};
