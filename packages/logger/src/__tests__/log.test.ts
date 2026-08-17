import { describe, it, expect, vi } from "vitest";
import { log } from "../index.js";

describe("@repo/logger", () => {
  it("prints a message", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    log("hello");

    expect(spy).toHaveBeenCalledWith("LOGGER: ", "hello");
  });
});
