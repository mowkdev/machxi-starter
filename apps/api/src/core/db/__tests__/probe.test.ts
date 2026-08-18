import { createLogger } from "@repo/logger";
import { describe, expect, it, vi } from "vitest";

import { probeDatabase } from "../probe.js";

/**
 * ADR-0003: the database is a hard dependency. The process proves it can reach
 * one before it binds a port, retrying only long enough to cover a container
 * that is still starting.
 */

const logger = createLogger({ level: "silent" });
const sleep = (): Promise<void> => Promise.resolve();

describe("probeDatabase", () => {
  it("returns on the first success without sleeping", async () => {
    const ping = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sleepSpy = vi.fn(sleep);

    await probeDatabase({ ping, attempts: 10, logger, sleep: sleepSpy });

    expect(ping).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("retries until the database answers", async () => {
    const ping = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(undefined);

    await probeDatabase({ ping, attempts: 10, logger, sleep });

    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("gives up after the configured number of attempts", async () => {
    const ping = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      probeDatabase({ ping, attempts: 3, logger, sleep }),
    ).rejects.toThrow("ECONNREFUSED");

    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("rethrows the driver's own error, not a flattened message", async () => {
    // "password authentication failed" and "no route to host" call for
    // different fixes; collapsing both to "database unreachable" hides that.
    const cause = Object.assign(new Error("password authentication failed"), {
      code: "28P01",
    });

    await expect(
      probeDatabase({
        ping: () => Promise.reject(cause),
        attempts: 1,
        logger,
        sleep,
      }),
    ).rejects.toBe(cause);
  });

  it("does not sleep after the final failure", async () => {
    const sleepSpy = vi.fn(sleep);

    await expect(
      probeDatabase({
        ping: () => Promise.reject(new Error("down")),
        attempts: 2,
        logger,
        sleep: sleepSpy,
      }),
    ).rejects.toThrow();

    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });
});
