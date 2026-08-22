import { zodResolver } from "@hookform/resolvers/zod";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { initialValuesFor } from "@/shared/resource/config";
import type { FieldVariant } from "@/shared/resource/types";
import { Button, FieldSet } from "@/shared/ui";
import {
  demoCreateBody,
  demoResourceConfig,
  type DemoCreateBody,
} from "@/test/fixtures/demo-resource";
import { renderWithProviders } from "@/test/render";

import { createAppFormInput } from "../app-form-input";
import { AppFormProvider } from "../context";
import { AppFormError } from "../form-error";

/**
 * The config-driven form (ADR-0035, `D3.6`; ADR-0036 §What must be covered, 2).
 *
 * Everything on screen below was declared once, as data, on
 * `demoResourceConfig` — which is the claim the whole design rests on. The
 * page's only contribution is *where* each field goes.
 *
 * **Rendered through the providers since `D7.4`.** A field's label,
 * description and placeholder are keys now (ADR-0046 §7), so the adapters call
 * `useKeyT()` — and a bare `render` would leave them with no instance and put
 * `demo:fields.name.label` on screen where the accessible name should be. The
 * assertions are unchanged, which is the point: the words come from the
 * fixture's own catalogue and they are the words the config used to carry.
 */

const DemoFormInput = createAppFormInput(demoResourceConfig.fields);

const DemoForm = ({
  variant = "create",
  isPending = false,
  onSubmit = vi.fn(),
}: {
  readonly variant?: FieldVariant;
  readonly isPending?: boolean;
  readonly onSubmit?: (values: DemoCreateBody) => void;
}) => {
  const form = useForm<DemoCreateBody>({
    resolver: zodResolver(demoCreateBody),
    defaultValues: initialValuesFor(
      demoResourceConfig.fields,
      variant,
    ) as unknown as DemoCreateBody,
    // The submit lock, half one: RHF disables every registered field centrally.
    disabled: isPending,
  });

  return (
    <AppFormProvider
      fields={demoResourceConfig.fields}
      variant={variant}
      form={form}
    >
      <form onSubmit={form.handleSubmit(onSubmit)} aria-label="Demo">
        {/* Half two: a real `fieldset`, which catches anything unregistered. */}
        <FieldSet disabled={isPending} aria-busy={isPending}>
          <AppFormError />
          <DemoFormInput fieldName="name" />
          <DemoFormInput fieldName="secret" />
          <DemoFormInput fieldName="notes" />
          <DemoFormInput fieldName="status" />
          <DemoFormInput fieldName="tags" />
          <DemoFormInput fieldName="featured" />
          <DemoFormInput fieldName="accepted" />
          <Button type="submit" disabled={isPending}>
            Save
          </Button>
        </FieldSet>
      </form>
    </AppFormProvider>
  );
};

describe("AppFormInput", () => {
  it("renders every registered field kind from config alone", () => {
    renderWithProviders(<DemoForm />);

    // Each one is queryable by its accessible name, which is both the ADR-0036
    // discipline and the minimum a screen reader needs.
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Featured" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Accept terms" }),
    ).toBeInTheDocument();
  });

  it("passes a config's `props` through to the control", () => {
    renderWithProviders(<DemoForm />);

    // `{ type: "password" }` is data in the config; a password box has no
    // `textbox` role, which is how the assertion knows it arrived.
    expect(screen.getByLabelText("Initial password")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("renders a config's description next to the field", () => {
    renderWithProviders(<DemoForm />);

    expect(
      screen.getByText("Optional. Clearing it removes the note."),
    ).toBeInTheDocument();
  });

  it("seeds the form from the config's initial values", () => {
    renderWithProviders(<DemoForm />);

    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Beta" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Featured" })).not.toBeChecked();
  });

  it("lets the variant decide which fields exist, from one form component", () => {
    /*
     * The same JSX in both cases: `email`-style create-only fields and
     * `status`-style edit-only ones are the config's business, because the
     * config has to tell the same story as the contract (`updateStaffBody`
     * deliberately omits the email).
     */
    const { unmount } = renderWithProviders(<DemoForm variant="create" />);

    expect(screen.getByLabelText("Initial password")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Status" }),
    ).not.toBeInTheDocument();

    /*
     * Unmount and render again rather than `rerender`, since `D7.4` put the
     * form under the providers: Testing Library's `rerender` replaces the whole
     * tree with the element it is given, wrappers included, so the second half
     * would have rendered with no i18next instance and read the keys back.
     */
    unmount();
    renderWithProviders(<DemoForm variant="edit" />);

    expect(screen.queryByLabelText("Initial password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Status" }),
    ).toBeInTheDocument();
  });

  it("is a compile error on a field name the config does not declare", () => {
    // The property `as const` configs exist to buy: `fieldName` is `keyof` the
    // field map, so a typo never becomes a silently missing control.
    // @ts-expect-error "nmae" is not a field of the demo resource.
    const wrong = <DemoFormInput fieldName="nmae" />;

    expect(wrong).toBeTruthy();
  });
});

describe("the submit lock", () => {
  it("disables every field while a mutation is pending", () => {
    renderWithProviders(<DemoForm isPending />);

    /*
     * Every control, not a sample: the lock is the thing that stops an operator
     * editing a form whose request is in flight, and a lock with one gap in it
     * is not a lock. `toBeDisabled` walks `fieldset` ancestors too, so this
     * covers both halves of the mechanism at once.
     */
    for (const control of [
      screen.getByRole("textbox", { name: "Name" }),
      screen.getByLabelText("Initial password"),
      screen.getByRole("textbox", { name: "Notes" }),
      screen.getByRole("checkbox", { name: "Alpha" }),
      screen.getByRole("checkbox", { name: "Beta" }),
      screen.getByRole("switch", { name: "Featured" }),
      screen.getByRole("checkbox", { name: "Accept terms" }),
      screen.getByRole("button", { name: "Save" }),
    ]) {
      expect(control).toBeDisabled();
    }
  });

  it("says so to assistive technology, not only visually", () => {
    renderWithProviders(<DemoForm isPending />);

    expect(
      screen.getByRole("form", { name: "Demo" }).querySelector("fieldset"),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("leaves everything usable when nothing is pending", () => {
    renderWithProviders(<DemoForm />);

    expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("validation", () => {
  it("renders the contract schema's own message next to the field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithProviders(<DemoForm onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "a");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The message comes from the zod schema the API would validate with, so
    // client and server cannot drift (ADR-0035).
    expect(
      await screen.findByText("Name must be at least 2 characters"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the config's values once they are valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithProviders(<DemoForm onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sprocket");
    await user.type(
      screen.getByLabelText("Initial password"),
      "hunter2hunter2",
    );
    await user.click(screen.getByRole("checkbox", { name: "Accept terms" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Sprocket",
          tags: ["alpha"],
          featured: false,
          accepted: true,
        }),
        expect.anything(),
      );
    });
  });

  it("submits `null` from an emptied nullable field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithProviders(<DemoForm onSubmit={onSubmit} />);

    const notes = screen.getByRole("textbox", { name: "Notes" });

    await user.type(notes, "x");
    await user.clear(notes);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Sprocket");
    await user.type(
      screen.getByLabelText("Initial password"),
      "hunter2hunter2",
    );
    await user.click(screen.getByRole("checkbox", { name: "Accept terms" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    /*
     * "Clear it" is a legal request the contracts' nullable names accept and
     * `""` cannot express (`updateUserBody`), so the adapter has to know which
     * one the field means.
     */
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null }),
        expect.anything(),
      );
    });
  });
});
