import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";

/*
 * The Field family is the composition ADR-0035's form adapters are built on, so
 * what is asserted here is the wiring those adapters will rely on: an
 * accessible name, a description, and an error that announces itself.
 */
describe("Field", () => {
  it("associates its label with the control it wraps", () => {
    render(
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" type="email" />
        <FieldDescription>We never share it.</FieldDescription>
      </Field>,
    );

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByText("We never share it.")).toBeInTheDocument();
  });

  it("renders as a group whose orientation is readable from the DOM", () => {
    render(
      <Field orientation="horizontal">
        <FieldLabel htmlFor="active">Active</FieldLabel>
        <Input id="active" />
      </Field>,
    );

    expect(screen.getByRole("group")).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
  });

  it("announces a single error and de-duplicates repeated messages", () => {
    render(
      <FieldError
        errors={[
          { message: "Email is already taken" },
          { message: "Email is already taken" },
        ]}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Email is already taken");
    expect(alert.querySelector("ul")).toBeNull();
  });

  it("lists distinct errors", () => {
    render(
      <FieldError
        errors={[{ message: "Too short" }, { message: "Needs a digit" }]}
      />,
    );

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      ["Too short", "Needs a digit"],
    );
  });

  it("renders nothing when there is no error to show", () => {
    const { container } = render(<FieldError errors={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
