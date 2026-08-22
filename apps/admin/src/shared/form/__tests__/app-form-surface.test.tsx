import { zodResolver } from "@hookform/resolvers/zod";
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { initialValuesFor } from "@/shared/resource/config";
import type { EditSurfaceKey } from "@/shared/resource/types";
import {
  demoCreateBody,
  demoResourceConfig,
  type DemoCreateBody,
} from "@/test/fixtures/demo-resource";
import { createTestI18n } from "@/test/render";

import { createAppFormInput } from "../app-form-input";
import { AppFormSurface } from "../app-form-surface";

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
 * Everything renders inside a real router, and that is not ceremony: a routed
 * surface is what this component is for (there is no `open` prop, because the
 * route match is what opens it), and the page shell blocks navigation while a
 * mutation is in flight — a rule with no meaning outside one. What this file
 * does not cover is *which* URL mounts a surface and what closing does to the
 * search params; that is `app/__tests__/record-routes.test.tsx`, against the
 * app's own generated route tree.
 */

const DemoFormInput = createAppFormInput(demoResourceConfig.fields);

const SURFACES: readonly EditSurfaceKey[] = ["dialog", "drawer", "page"];

const DemoSurface = ({
  surface,
  isPending = false,
  onClose = vi.fn(),
  onSubmit = vi.fn(),
}: {
  readonly surface: EditSurfaceKey;
  readonly isPending?: boolean;
  readonly onClose?: () => void;
  readonly onSubmit?: (values: DemoCreateBody) => void;
}) => {
  const form = useForm<DemoCreateBody>({
    resolver: zodResolver(demoCreateBody),
    defaultValues: initialValuesFor(
      demoResourceConfig.fields,
      "create",
    ) as unknown as DemoCreateBody,
    // The submit lock, half one: RHF disables every registered field centrally.
    disabled: isPending,
  });

  return (
    <AppFormSurface
      surface={surface}
      title="Demo record"
      description="The same form, whichever frame it is in."
      form={form}
      fields={demoResourceConfig.fields}
      variant="create"
      onSubmit={onSubmit}
      isPending={isPending}
      submitLabel="Save"
      onClose={onClose}
    >
      <DemoFormInput fieldName="name" />
      <DemoFormInput fieldName="secret" />
      <DemoFormInput fieldName="notes" />
      <DemoFormInput fieldName="tags" />
      <DemoFormInput fieldName="featured" />
      <DemoFormInput fieldName="accepted" />
    </AppFormSurface>
  );
};

/**
 * A two-route memory router around the surface.
 *
 * The second route is not decoration — it is the only way to ask whether a
 * navigation *out* of a pending form is refused, which is what ADR-0040 means
 * by the in-flight rule reaching "the page shell's navigation affordances".
 */
const renderSurface = (props: Parameters<typeof DemoSurface>[0]) => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <>
        <DemoSurface {...props} />
        {/*
         * The cast is the price of a harness router. `Link`'s `to` is typed
         * against the *registered* route tree (ADR-0032 — that is the typed-path
         * guarantee working), and this two-route tree is not it. Casting here
         * is confined to the harness; every `Link` in `src/` stays checked.
         */}
        <Link to={"/elsewhere" as never}>Leave</Link>
      </>
    ),
  });
  const elsewhereRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/elsewhere",
    component: () => <p>Elsewhere</p>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, elsewhereRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  /*
   * The frame's own copy is translated since `D7.2` — Cancel, at least — so
   * the harness mounts an instance the way `renderWithProviders` does. `en`,
   * loaded synchronously, so every assertion below is still by the English
   * accessible name (ADR-0046 §14).
   */
  return {
    ...render(
      <I18nextProvider i18n={createTestI18n().instance}>
        <RouterProvider router={router as never} />
      </I18nextProvider>,
    ),
    router,
  };
};

describe.each(SURFACES)("the %s surface", (surface) => {
  it("renders the same form, named the same way", async () => {
    renderSurface({ surface });

    expect(
      await screen.findByRole("heading", { name: "Demo record" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
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
  it("puts a modal around two of them and not the third", async () => {
    const seen: Record<string, unknown>[] = [];

    for (const surface of SURFACES) {
      const { unmount } = renderSurface({ surface });

      await screen.findByRole("heading", { name: "Demo record" });
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

    await screen.findByRole("heading", { name: "Demo record" });
    await user.click(screen.getByRole("link", { name: "Leave" }));

    await waitFor(() => {
      expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { name: "Demo record" }),
    ).toBeInTheDocument();
  });

  it("allows it once the mutation has settled", async () => {
    const user = userEvent.setup();

    renderSurface({ surface: "page" });

    await screen.findByRole("heading", { name: "Demo record" });
    await user.click(screen.getByRole("link", { name: "Leave" }));

    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
  });
});
