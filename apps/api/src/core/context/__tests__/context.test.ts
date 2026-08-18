import { createLogger } from "@repo/logger";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  createRequestContext,
  createSystemContext,
  getContext,
  runWithContext,
  tryGetContext,
} from "../index.js";

/**
 * ADR-0010: one typed per-request object, reachable explicitly (`req.ctx`,
 * passed as the first service argument) and ambiently (`AsyncLocalStorage`) for
 * infrastructure that must not take it as a parameter.
 */

const logger = createLogger({ level: "silent" });

describe("createRequestContext", () => {
  it("starts with no principal — authentication is what sets one", () => {
    expect(
      createRequestContext({ requestId: "r1", logger }).principal,
    ).toBeNull();
  });

  it("defaults the locale until i18n negotiation exists", () => {
    expect(createRequestContext({ requestId: "r1", logger }).locale).toBe(
      DEFAULT_LOCALE,
    );
  });

  it("keeps ip and user agent, which the session audit trail records", () => {
    const ctx = createRequestContext({
      requestId: "r1",
      logger,
      ip: "10.0.0.1",
      userAgent: "vitest",
    });

    expect(ctx).toMatchObject({ ip: "10.0.0.1", userAgent: "vitest" });
  });
});

describe("createSystemContext", () => {
  it("never carries a principal, so a service that requires one refuses", () => {
    // There is deliberately no `system` principal variant (ADR-0010): code
    // running outside a request must not inherit unbounded authority.
    expect(createSystemContext("seed", logger).principal).toBeNull();
  });

  it("marks the request id so a log line is traceable to the job", () => {
    expect(createSystemContext("prune-sessions", logger).requestId).toBe(
      "system:prune-sessions",
    );
  });
});

describe("AsyncLocalStorage propagation", () => {
  const ctx = createRequestContext({ requestId: "r1", logger });

  it("exposes the context to code below it without threading a parameter", () => {
    runWithContext(ctx, () => {
      expect(getContext()).toBe(ctx);
    });
  });

  it("survives an await boundary", async () => {
    await runWithContext(ctx, async () => {
      await Promise.resolve();

      expect(getContext().requestId).toBe("r1");
    });
  });

  it("keeps two concurrent requests apart", async () => {
    const other = createRequestContext({ requestId: "r2", logger });

    const [first, second] = await Promise.all([
      runWithContext(ctx, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));

        return getContext().requestId;
      }),
      runWithContext(other, async () => getContext().requestId),
    ]);

    expect([first, second]).toEqual(["r1", "r2"]);
  });

  it("throws outside a request rather than inventing a context", () => {
    expect(() => getContext()).toThrow(/outside a request/);
  });

  it("offers a non-throwing read for code that legitimately may run outside one", () => {
    expect(tryGetContext()).toBeUndefined();
  });
});
