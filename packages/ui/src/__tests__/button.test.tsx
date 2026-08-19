import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@repo/ui/components/button";

describe("Button", () => {
  it("renders a button with its accessible name", () => {
    render(<Button>Save changes</Button>);

    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("carries the variant and size on data attributes and in the class list", () => {
    render(
      <Button size="sm" variant="destructive">
        Delete
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveAttribute("data-variant", "destructive");
    expect(button).toHaveAttribute("data-size", "sm");
    // The palette is a token, not a literal — this is what makes the dark
    // variant a one-file concern (ADR-0031).
    expect(button.className).toContain("bg-destructive");
  });

  it("renders the child element instead of a button when asChild is set", () => {
    render(
      <Button asChild variant="link">
        <a href="/staff">Staff</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Staff" });
    expect(link).toHaveAttribute("href", "/staff");
    expect(link.className).toContain("text-primary");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is disabled when the disabled prop is set", () => {
    render(<Button disabled>Submitting</Button>);

    expect(screen.getByRole("button", { name: "Submitting" })).toBeDisabled();
  });
});
