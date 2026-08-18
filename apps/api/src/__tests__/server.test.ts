import { createLogger } from "@repo/logger";
import express from "express";
import { describe, expect, it, vi } from "vitest";

import { startServer } from "../server.js";

/**
 * ADR-0003: the process stops accepting connections, drains what is in flight,
 * then releases the database pool — in that order, and only once.
 */

const logger = createLogger({ level: "silent" });

/** Port 0 asks the OS for a free port; nothing here depends on a fixed one. */
const start = (onShutdown?: () => Promise<void>) =>
  startServer({
    app: express().get("/", (_req, res) => {
      res.end("ok");
    }),
    port: 0,
    logger,
    ...(onShutdown === undefined ? {} : { onShutdown }),
  });

describe("startServer", () => {
  it("binds a port and stops listening after shutdown", async () => {
    const { server, shutdown } = start();

    await new Promise((resolve) => server.once("listening", resolve));

    expect(server.listening).toBe(true);

    await shutdown("test");

    expect(server.listening).toBe(false);
  });

  it("releases the pool only after the last request has drained", async () => {
    const order: string[] = [];
    const { server, shutdown } = start(() => {
      order.push("pool closed");

      return Promise.resolve();
    });

    await new Promise((resolve) => server.once("listening", resolve));

    server.once("close", () => order.push("stopped listening"));

    await shutdown("SIGTERM");

    expect(order).toEqual(["stopped listening", "pool closed"]);
  });

  it("ignores a second signal instead of starting a second drain", async () => {
    const onShutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const { server, shutdown } = start(onShutdown);

    await new Promise((resolve) => server.once("listening", resolve));

    // A user pressing Ctrl-C twice, or an orchestrator following SIGTERM with
    // another signal, must not tear down a drain that is already running.
    await Promise.all([shutdown("SIGINT"), shutdown("SIGINT")]);

    expect(onShutdown).toHaveBeenCalledOnce();
  });
});
