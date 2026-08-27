import { zodResolver } from "@hookform/resolvers/zod";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { initialValuesFor } from "@/shared/resource/config";
import {
  demoCreateBody,
  demoResourceConfig,
  type DemoCreateBody,
} from "@/test/fixtures/demo-resource";
import { renderWithProviders } from "@/test/render";

import { createAppFormInput } from "../app-form-input";
import { AppFormDialog } from "../app-form-dialog";

/**
 * The one shell a caller still opens and closes (`D8.11`, ADR-0048 §4).
 *
 * `app-form-surface.test.tsx` covers everything the three shells share, and it
 * reaches this component through the *routed* door — where `open` is always
 * `true` because the route match is what opens it. What is left over is this
 * file's subject: the **controlled** mount the three non-routed ceremonies use
 * (both administrative password resets and the profile's change-password), and
 * the one rule that mount owns — a modal that refuses to be dismissed while
 * the mutation it launched is still in flight.
 *
 * **The harness closes for real, and that is the whole design of it.** A
 * `vi.fn()` alone would let "the dialog is still on screen" pass on any bug at
 * all, because nothing would ever have closed it — the trap `D8.10` walked
 * into on the drawer, where the routed mount is permanently `open`. Here the
 * caller owns `open`, so the harness spies *and* sets state: a dismissal that
 * gets through unmounts the dialog, and the assertion that it did not is
 * falsifiable. The `isPending: false` cases below are the proof that it is —
 * the same gestures close it there.
 */

const DemoFormInput = createAppFormInput(demoResourceConfig.fields);

const ControlledDialog = ({
  isPending = false,
  onOpenChange = vi.fn(),
}: {
  readonly isPending?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}) => {
  const [open, setOpen] = useState(true);

  const form = useForm<DemoCreateBody>({
    resolver: zodResolver(demoCreateBody),
    defaultValues: initialValuesFor(
      demoResourceConfig.fields,
      "create",
    ) as unknown as DemoCreateBody,
    // The submit lock, half one, exactly as every real caller wires it.
    disabled: isPending,
  });

  return (
    <AppFormDialog
      form={form}
      fields={demoResourceConfig.fields}
      isPending={isPending}
      onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }}
      onSubmit={vi.fn()}
      open={open}
      submitLabel="Save"
      title="Demo ceremony"
      variant="create"
    >
      <DemoFormInput fieldName="name" />
      <DemoFormInput fieldName="secret" />
    </AppFormDialog>
  );
};

/**
 * The overlay is pressed with `fireEvent`, not `user-event`, and only after a
 * macrotask has passed.
 *
 * Two jsdom facts, both of which produce a silently-vacuous test if missed.
 * **`fireEvent`**: Radix dismisses on `pointerdown` outside the content, and
 * while a modal is open its layer sets `pointer-events: none` on the body —
 * `user-event` refuses to click into such a subtree, so every case here would
 * fail for a reason unrelated to the rule. It is the same idiom
 * `breadcrumbs.test.tsx` reaches for. **The tick**: the layer attaches its
 * `pointerdown` listener inside a `setTimeout(…, 0)`
 * (`react-dismissable-layer/dist/index.mjs:292`), so an event dispatched
 * before that timer fires reaches nobody at all — and "the dialog is still
 * open" then passes for the wrong reason. The timer is queued at commit, so
 * one scheduled macrotask is enough to sit behind it.
 *
 * **And it is a `pointerdown` *and* a `click`**, which is a whole gesture
 * rather than belt-and-braces: `Dialog` passes `deferPointerDownOutside: true`
 * (`react-dialog/dist/index.mjs:237`), so on a primary button the layer does
 * not dismiss on the press — it arms a one-shot `click` listener and dismisses
 * on the release. A press alone leaves the dialog open, and every refusal
 * below would then be asserting that nothing happened because nothing was
 * asked. The `isPending: false` controls are what caught it.
 */
const clickOverlay = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  const overlay = document.querySelector('[data-slot="dialog-overlay"]');

  if (overlay === null) {
    throw new Error("no overlay");
  }

  fireEvent.pointerDown(overlay);
  fireEvent.click(overlay);
};

describe("the dialog refuses dismissal while the mutation is in flight", () => {
  it("stays open when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithProviders(
      <ControlledDialog isPending onOpenChange={onOpenChange} />,
    );

    await screen.findByLabelText("Name");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("stays open when the overlay is clicked", async () => {
    const onOpenChange = vi.fn();

    renderWithProviders(
      <ControlledDialog isPending onOpenChange={onOpenChange} />,
    );

    await screen.findByLabelText("Name");
    await clickOverlay();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("offers no close button to press", async () => {
    renderWithProviders(<ControlledDialog isPending />);

    await screen.findByLabelText("Name");

    /*
     * The third route out, and the one the container changed: the shipped
     * dialog left the corner button on screen and refused the close it asked
     * for, which is a control that lies. `dismissible={false}` withholds it,
     * the way the drawer already does.
     */
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });
});

describe("and reports every dismissal once nothing is in flight", () => {
  /*
   * The live control for all three cases above. Without these the refusals
   * would be satisfied by a dialog that simply never closes — which is
   * exactly what a `role="dialog"` query cannot tell apart on its own.
   */
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithProviders(<ControlledDialog onOpenChange={onOpenChange} />);

    await screen.findByLabelText("Name");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on an overlay click", async () => {
    const onOpenChange = vi.fn();

    renderWithProviders(<ControlledDialog onOpenChange={onOpenChange} />);

    await screen.findByLabelText("Name");
    await clickOverlay();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on the corner button, which is on screen again", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithProviders(<ControlledDialog onOpenChange={onOpenChange} />);

    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
