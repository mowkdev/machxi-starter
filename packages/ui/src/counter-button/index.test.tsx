import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CounterButton } from ".";

describe("CounterButton", () => {
  it("renders without crashing", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<CounterButton />);
    });

    expect(container.textContent).toContain("Count:");

    await act(async () => {
      root.unmount();
    });
  });
});
