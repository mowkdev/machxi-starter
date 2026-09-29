import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  RECORD_LABEL,
  SURFACES,
  renderSurface,
} from "./support/surface-harness";

/**
 * The three shells (`D4.2`, ADR-0040).
 *
 * ADR-0040's central claim is that **all three render the same form**, and that
 * choosing between them is one config line with no other change. That claim is
 * worth as much as the shell it is least exercised in — and the `page` surface
 * is one no resource declares, so before this file both defects `D4.2` shipped
 * and fixed lived there, invisible to every suite and found by hand in a
 * browser.
 *
 * So the table below runs the *same* assertions against each shell, by
 * accessible name and nothing else. A test that had to know which frame it was
 * inside would be measuring the opposite of what the ADR promises.
 *
 * **One claim stopped being shell-agnostic at `D8.9`, and it is quarantined
 * rather than smuggled into the parity cases**: the record's title is a
 * heading rendered by the surface under `dialog` and `drawer` and by the
 * *shell* under `page` (ADR-0048 §2), so it lives in its own case beside the
 * other deliberate difference below rather than as a branch inside "renders
 * the same form". Everything in the `describe.each` is still assertions that
 * hold identically in all three.
 *
 * **And since `D8.10` this file is the `page` variant's exerciser end to
 * end**: `AppShell` is mounted around that variant and around no other, fed
 * from route `staticData` through `shared/lib/route-meta` rather than from a
 * literal prop, so "exactly one heading on the screen, carrying the record's
 * own label" (ADR-0048 §2, ADR-0044) is asserted against the two ends of the
 * real channel — and only under `page`, which is the only variant where the
 * shell and the surface are on screen together. The shell is mounted only
 * there because Radix hides the rest of the document from role queries behind
 * a modal, so a shell under `dialog` or `drawer` would be cost without an
 * assertion. What this file still cannot claim is the *route* channel — its
 * routes are hand-built, so that
 * `/staff/$staffId` declares `recordLabel` and `route-meta.ts` reads it off
 * the generated tree is `app/__tests__/breadcrumbs.test.tsx`'s assertion.
 *
 * Everything renders inside a real router, and that is not ceremony: a routed
 * surface is what this component is for (there is no `open` prop, because the
 * route match is what opens it), and the page shell blocks navigation while a
 * mutation is in flight — a rule with no meaning outside one. What this file
 * does not cover is *which* URL mounts a surface and what closing does to the
 * search params; that is `app/__tests__/record-routes.test.tsx`, against the
 * app's own generated route tree.
 *
 * **Moved here from the admin's door at `D22.3`** (ADR-0077 §4), with its
 * cases unchanged, and split as it landed: the harness is
 * `support/surface-harness.tsx`, and the inverted frame's structural cases
 * are `app-form-surface-layout.test.tsx`. The `app/__tests__/` files named
 * above are the admin's and stayed there, with the route tree they read.
 */

describe.each(SURFACES)("the %s surface", (surface) => {
  it("renders the same form, named the same way", async () => {
    renderSurface({ surface });

    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("closes through Cancel, whatever the frame", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderSurface({ surface, onClose });

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    // The one gesture all three share. Escape and the overlay exist in only
    // two of them, which is why the shared assertion is this one.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks every control while the mutation is in flight", async () => {
    renderSurface({ surface, isPending: true });

    /*
     * All three halves of the ADR-0035 submit lock, in each shell: RHF's
     * `disabled`, the `FieldSet`, and the buttons. Cancel being disabled is the
     * half that matters here — it is the dismissal every shell has, so it is
     * the one that must be refused everywhere rather than only where an overlay
     * happens to own a close button.
     */
    expect(await screen.findByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    /*
     * `/Save/` rather than the exact name: while pending, the button also
     * holds a `Spinner`, whose `aria-label="Loading"` joins the accessible
     * name. That is the spinner announcing itself, which is right — the
     * assertion just has to know the name is "Loading Save" then.
     */
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("submits what the operator typed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderSurface({ surface, onSubmit });

    // Everything `demoCreateBody` requires, because the contract's own schema
    // is what validates here (ADR-0035) and it does not care which shell it is.
    await user.type(await screen.findByLabelText("Name"), "Sprocket");
    await user.type(screen.getByLabelText("Initial password"), "hunter2");
    // `tags` already holds its config `initialValue` — ticking a box here would
    // untick the one that is satisfying `min(1)`.
    await user.click(screen.getByRole("checkbox", { name: "Accept terms" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: "Sprocket" });
  });
});

describe("the frames differ in exactly one way", () => {
  it.each(SURFACES)(
    "titles the %s the way its shell requires",
    async (surface) => {
      renderSurface({ surface });

      await screen.findByLabelText("Name");

      /*
       * **The one claim that is not shell-agnostic** (`D8.9`, ADR-0048 §2).
       * Under `dialog` and `drawer` the surface is modal: Radix requires a title
       * for the accessible name, and the shell behind is `aria-hidden`, so the
       * surface's own heading is the only one reachable. Under `page` there is
       * no modal — the shell's `<h1>` is on screen carrying the route's own
       * title — so a heading from the surface would be two visible headings
       * with one accessible name, the duplicate `D4.2` found by testing the
       * shells against each other.
       *
       * **Exactly one** (`D8.10`), which is the half a name-only query cannot
       * state: `getByRole` would pass just as happily with a second heading
       * beside the one it found, and a second heading is the whole defect
       * ADR-0044's invariant names. Its reach differs by shell, and honestly
       * so: under `page` the count is over the whole screen, shell `<h1>` and
       * surface together, which is the invariant itself; under the other two
       * no shell is mounted, so it counts the surface alone and catches a
       * stray heading from inside the frame rather than a duplicate of the
       * shell's — which in the real app is `aria-hidden` behind the modal
       * anyway.
       */
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      expect(
        screen.getByRole("heading", {
          // The shell's, resolved through `t()` from the route's `demo:` key;
          // the surface's own, under the other two, is the literal prop.
          name: surface === "page" ? "New widget" : "Demo record",
        }),
      ).toBeVisible();
    },
  );

  it("gives the page's shell the loaded record's label, not the route's title", async () => {
    renderSurface({ route: "edit", surface: "page" });

    await screen.findByLabelText("Name");

    /*
     * The other end of the channel `D8.6` built, asserted on an **edit** route
     * because that is the only place the two strings differ: on a create route
     * `staff:create.routeTitle` and the record's label are the same words, so
     * a heading there is satisfied by either and proves neither.
     *
     * `RECORD_LABEL` is asserted literally and "Edit widget" is the resolved
     * translation of the route's key — the asymmetry is the rule (ADR-0048
     * §2): a title is copy and goes through `t()`, a label is loaded data and
     * does not.
     */
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: RECORD_LABEL })).toBeVisible();
    expect(screen.queryByText("Edit widget")).not.toBeInTheDocument();
  });

  it("puts a modal around two of them and not the third", async () => {
    const seen: Record<string, unknown>[] = [];

    for (const surface of SURFACES) {
      const { unmount } = renderSurface({ surface });

      await screen.findByLabelText("Name");
      seen.push({
        surface,
        modal: document.querySelector('[role="dialog"]') !== null,
        sheet: document.querySelector('[data-slot="sheet-content"]') !== null,
      });
      unmount();
    }

    /*
     * The only assertion in this file that names a shell, and it exists to pin
     * what "a different frame" means: a dialog and a drawer are both modal
     * (`role="dialog"`, distinguishable only by their `data-slot`), the page is
     * neither. Every other assertion above deliberately cannot tell them apart.
     */
    expect(seen).toEqual([
      { surface: "dialog", modal: true, sheet: false },
      { surface: "drawer", modal: true, sheet: true },
      { surface: "page", modal: false, sheet: false },
    ]);
  });
});

describe("the drawer refuses its own dismissal in flight", () => {
  /*
   * The gesture half of the submit lock, for the shell that owns one
   * (`D8.10`, ADR-0048 §4). The parity case above proves Cancel is *disabled*
   * in all three; Escape is a different route out — it never touches a
   * control, so a disabled button refuses nothing about it, and it is
   * `dismissible={!isPending}` that has to.
   *
   * Asserted here rather than in the package suite because it is a gesture,
   * and `@repo/ui`'s harness has no `user-event`. The dialog variant's Escape
   * and overlay click are `D8.11`'s, once that shell is on the same container.
   *
   * **What it pins, stated exactly, because the obvious stronger assertions
   * are both worthless here.** `RecordSurface` refuses in two ways while
   * `dismissible={false}` (`D8.8`) — the `onEscapeKeyDown` /
   * `onPointerDownOutside` / `onInteractOutside` handlers, and the
   * `onOpenChange` it withholds from the Radix root entirely — and **neither
   * is separately observable**, because either alone already produces silence.
   * The event's `defaultPrevented` flag cannot tell them apart either: Radix's
   * dismissable layer calls `event.preventDefault()` itself on the dismiss
   * path (`react-dismissable-layer/dist/index.mjs:97`) before running
   * `onDismiss`, so the flag is `true` whichever branch ran. And a mount check
   * cannot fail at all — the routed drawer is `open={open ?? true}`, so no
   * gesture can unmount it. What is left is the honest claim at this layer,
   * and it is a real one: the operator pressed Escape mid-mutation and the
   * caller was told nothing, so nothing navigated the record away. It goes red
   * with `isPending` false, which is the check that it is live.
   */
  it("reports no close when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderSurface({ isPending: true, onClose, surface: "drawer" });

    await screen.findByLabelText("Name");
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the page shell blocks the way out", () => {
  /*
   * The requirement only the page surface owns (ADR-0040 §Details pinned). A
   * dialog and a drawer refuse their own dismissal while a mutation is in
   * flight; a page has no dismissal gesture, but it sits inside `_dashboard`,
   * where every sidebar link is a way out. Leaving mid-submit means the
   * mutation lands with no form left to render its failure in — the outcome the
   * other two shells refuse, and the one this refuses too.
   */
  it("refuses a navigation away while the mutation is in flight", async () => {
    const user = userEvent.setup();

    renderSurface({ surface: "page", isPending: true });

    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("link", { name: "Leave" }));

    await waitFor(() => {
      expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
    });
    // Still on the surface: the blocker refused the navigation. On a field
    // rather than a heading, because the `page` variant renders none since
    // `D8.9` — the shell's `<h1>` carries the title there (ADR-0048 §2).
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("allows it once the mutation has settled", async () => {
    const user = userEvent.setup();

    renderSurface({ surface: "page" });

    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("link", { name: "Leave" }));

    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
  });
});
