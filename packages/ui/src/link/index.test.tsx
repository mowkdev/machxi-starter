import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link } from ".";

describe("Link", () => {
  it("renders without crashing", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<Link href="https://turborepo.dev">Turborepo Docs</Link>);
    });

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://turborepo.dev",
    );

    await act(async () => {
      root.unmount();
    });
  });
});
