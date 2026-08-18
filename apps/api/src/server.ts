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

export interface StartServerOptions {
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
}: StartServerOptions): RunningServer => {
  const server = app.listen(port, () => {
    logger.info({ port }, "http server listening");
  });

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
