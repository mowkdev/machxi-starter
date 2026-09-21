import { createServer } from "node:http";

import { createLogger } from "@repo/logger";
import express from "express";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../core/config/index.js";
import { startServer } from "../server.js";

/**
 * ADR-0003: the process stops accepting connections, drains what is in flight,
 * then releases the database pool — in that order, and only once. Since
 * `D20.4`, ADR-0073 §4 beside it: the three socket deadlines this process
 * states rather than inherits.
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

/**
 * The validated environment with nothing stated but what the schema demands,
 * so `http.*` below is the **default** every deployment inherits (ADR-0004).
 */
const config = loadConfig({
  NODE_ENV: "development",
  DATABASE_URL: "postgres://machxi:machxi@localhost:5432/machxi",
  JWT_ACCESS_SECRET: "a".repeat(32),
});

describe("the socket deadlines", () => {
  it("sets all three from configuration rather than inheriting Node's", async () => {
    // ADR-0073 §4. Node's own values are 300s / 60s / 5s, and each is wrong
    // here in its own direction — the last one most visibly, since a
    // keep-alive shorter than the proxy's shows up as intermittent 502s in
    // front of a perfectly healthy process.
    const { server, shutdown } = startServer({
      app: express(),
      port: 0,
      logger,
      requestTimeoutMs: config.http.requestTimeoutSec * 1000,
      headersTimeoutMs: config.http.headersTimeoutSec * 1000,
      keepAliveTimeoutMs: config.http.keepAliveTimeoutSec * 1000,
    });

    expect(server.requestTimeout).toBe(30_000);
    expect(server.headersTimeout).toBe(10_000);
    expect(server.keepAliveTimeout).toBe(65_000);

    // The one relationship worth asserting rather than restating: the default
    // has to be **above** a typical proxy's sixty seconds, so the proxy is
    // always the end that closes an idle connection.
    expect(server.keepAliveTimeout).toBeGreaterThan(60_000);

    await shutdown("test");
  });

  it("Node's own values stand when config does not set them", async () => {
    // A caller with no configuration — this file's other cases — keeps what
    // Node gives a bare server, value for value (`D28.6`, `API-12`). Read from
    // a server Node built rather than written as numbers, so the case pins
    // "untouched" and not a Node release; a swapped pair or a zero, which
    // Node reads as "no deadline at all", fails it either way.
    const bare = createServer();
    const { server, shutdown } = start();

    expect(server.requestTimeout).toBe(bare.requestTimeout);
    expect(server.headersTimeout).toBe(bare.headersTimeout);
    expect(server.keepAliveTimeout).toBe(bare.keepAliveTimeout);
    expect(server.requestTimeout).toBeGreaterThan(0);
    expect(server.headersTimeout).toBeGreaterThan(0);

    await shutdown("test");
  });

  it("the headers timeout is shorter than the request timeout", async () => {
    // The one relation between the two (`D28.6`, `API-12`): the headers are
    // a prefix of the request, so a headers deadline at or past the request's
    // never fires first and slow-headers protection is gone. Held for the
    // configured defaults and for Node's own.
    const configured = startServer({
      app: express(),
      port: 0,
      logger,
      requestTimeoutMs: config.http.requestTimeoutSec * 1000,
      headersTimeoutMs: config.http.headersTimeoutSec * 1000,
    });
    const inherited = start();

    expect(configured.server.headersTimeout).toBeLessThan(
      configured.server.requestTimeout,
    );
    expect(inherited.server.headersTimeout).toBeLessThan(
      inherited.server.requestTimeout,
    );

    await configured.shutdown("test");
    await inherited.shutdown("test");
  });
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
    const onShutdown = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const { server, shutdown } = start(onShutdown);

    await new Promise((resolve) => server.once("listening", resolve));

    // A user pressing Ctrl-C twice, or an orchestrator following SIGTERM with
    // another signal, must not tear down a drain that is already running.
    await Promise.all([shutdown("SIGINT"), shutdown("SIGINT")]);

    expect(onShutdown).toHaveBeenCalledOnce();
  });
});
