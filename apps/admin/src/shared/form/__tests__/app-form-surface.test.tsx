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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import {
  useRouteFullHeight,
  useRouteRecordLabel,
  useRouteTitle,
} from "@/shared/lib/route-meta";
import { initialValuesFor } from "@/shared/resource/config";
import type { EditSurfaceKey } from "@/shared/resource/types";
import { AppShell } from "@/shared/ui";
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
    <>
      {/*
       * Outside the surface on purpose (`D8.9`): it has to work while the form
       * is locked, and anything inside the `FieldSet` is disabled then. This
       * is the `server-errors.test.tsx` idiom — a plain button calling
       * `setError` — which re-renders because the owner is subscribed to
       * `errors` the moment `AppFormError` reads them.
       */}
      <button
        type="button"
        onClick={() => {
          form.setError("root.server", { message: "Saving failed" });
        }}
      >
        Fail
      </button>
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
    </>
  );
};

/**
 * The label the edit route's loader carries, and the shell's `<h1>` under it.
 *
 * An email, like the two shipped record routes' labels, and deliberately not a
 * translated string: `recordLabel` is loaded data, so it bypasses the `t()`
 * wrap `useRouteTitle` applies and is asserted literally (ADR-0048 §2).
 */
const RECORD_LABEL = "ada@example.com";

/**
 * The shell around the `page` variant, and around no other (`D8.10`, ADR-0048
 * §2).
 *
 * **Why only there.** Under `dialog` and `drawer` the surface is modal, so
 * Radix marks the rest of the document `aria-hidden` — a shell mounted behind
 * one is outside every role query this file makes, which is cost with no
 * assertion attached. Under `page` there is no modal, the shell's `<h1>` is on
 * screen beside the form, and "exactly one heading" is a claim about the two
 * of them together.
 *
 * **And the title comes through `route-meta.ts`, not through a prop.** The
 * branch below is `_dashboard.tsx`'s, copied because it is the thing under
 * test: a `page` record route is `fullHeight: false`, so the loaded record's
 * own label wins where one is declared and the route's translated title stands
 * in where none is. A harness that passed the string it expected would be
 * asserting its own wiring.
 *
 * **Only the `false` arm of that branch runs here**, and that is a scope
 * statement rather than an oversight. The `fullHeight: true` arm — a grid or
 * modal route keeping its route title even though it declares a
 * `recordLabel`, which is what both shipped record routes do — has no shell
 * mounted around it in this file, so it is `app/__tests__/breadcrumbs.test.tsx`'s
 * to assert, the way the route channel itself is.
 *
 * `sidebar` is `null` on purpose. The prop is required because every real
 * consumer has a drawer, and a harness that built one would be exercising
 * `AppSidebar` — whose own screen is `app/__tests__/` — rather than the
 * heading channel this file is here for.
 */
const Shelled = ({
  surface,
  children,
}: {
  readonly surface: EditSurfaceKey;
  readonly children: ReactNode;
}) => {
  const fullHeight = useRouteFullHeight();
  const routeTitle = useRouteTitle("dashboard:shellFallback");
  const recordLabel = useRouteRecordLabel();

  if (surface !== "page") {
    return <>{children}</>;
  }

  return (
    <AppShell
      fullHeight={fullHeight}
      sidebar={null}
      title={fullHeight ? routeTitle : (recordLabel ?? routeTitle)}
    >
      {children}
    </AppShell>
  );
};

/*
 * An intersection rather than an `interface … extends`: the left-hand side is
 * an indexed access type, which an interface may not extend.
 */
type HarnessOptions = Parameters<typeof DemoSurface>[0] & {
  /**
   * Which of the two surface routes mounts it (`D8.10`).
   *
   * `create` declares a `title` and no `recordLabel`, the way `/staff/new`
   * does; `edit` declares both and they differ, the way `/staff/$staffId`
   * does — where the route title is "Edit staff member" and the label is the
   * record's email. Asserting the heading on the create route alone would not
   * distinguish the two channels, because there they resolve to the same
   * string.
   */
  readonly route?: "create" | "edit";
};

/**
 * A three-route memory router around the surface.
 *
 * `/elsewhere` is not decoration — it is the only way to ask whether a
 * navigation *out* of a pending form is refused, which is what ADR-0040 means
 * by the in-flight rule reaching "the page shell's navigation affordances".
 *
 * The other two are the surface's own, and they carry `staticData` since
 * `D8.10` — the channel `Shelled` reads above, declared here the way a record
 * route declares it: a `demo:` `TranslationKey` for the title (no cast: the
 * fixture's namespace is augmented into `ResourceNamespaceMap`), `fullHeight`
 * computed from the surface exactly as the record routes compute it
 * (`editSurfaceOf(config) !== "page"`, so `false` for `page` and `true` for
 * the two modal shells), and a `recordLabel` narrowing its own loader's
 * `unknown` on the edit route.
 */
const renderSurface = ({ route = "create", ...props }: HarnessOptions) => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });

  // The record routes' own expression, `editSurfaceOf(config) !== "page"`,
  // with the surface under test standing in for the config.
  const fullHeight = props.surface !== "page";

  const surfaceScreen = (
    <Shelled surface={props.surface}>
      <DemoSurface {...props} />
      {/*
       * The cast is the price of a harness router. `Link`'s `to` is typed
       * against the *registered* route tree (ADR-0049 — that is the typed-path
       * guarantee working), and this three-route tree is not it. Casting here
       * is confined to the harness; every `Link` in `src/` stays checked.
       */}
      <Link to={"/elsewhere" as never}>Leave</Link>
    </Shelled>
  );

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => surfaceScreen,
    staticData: { title: "demo:create.routeTitle", fullHeight },
  });
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/edit",
    loader: () => ({ email: RECORD_LABEL }),
    component: () => surfaceScreen,
    staticData: {
      title: "demo:edit.routeTitle",
      fullHeight,
      /*
       * The narrowing is here rather than in the reader, exactly as it is on
       * `/staff/$staffId`: the channel's parameter is `unknown` because
       * `strictFunctionTypes` checks it contravariantly, so the route that
       * knows what its own loader returns is the one place that may prove it.
       */
      recordLabel: (loaderData) =>
        typeof loaderData === "object" &&
        loaderData !== null &&
        "email" in loaderData &&
        typeof loaderData.email === "string"
          ? loaderData.email
          : undefined,
    },
  });
  const elsewhereRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/elsewhere",
    component: () => <p>Elsewhere</p>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, editRoute, elsewhereRoute]),
    history: createMemoryHistory({
      initialEntries: [route === "edit" ? "/edit" : "/"],
    }),
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

/**
 * The inversion's structural consequences (`D8.9`, ADR-0048 §4).
 *
 * These are the assertions that keep the inversion honest where jsdom can
 * still see it. The layout itself — a long form scrolling its body while the
 * title and Save stay put — is `D8.12`'s browser walk.
 */
describe("the inverted frame", () => {
  it.each(SURFACES)(
    "keeps the form-level error inside the %s's form and inside the locked FieldSet",
    async (surface) => {
      renderSurface({ isPending: true, surface });

      await screen.findByLabelText("Name");

      /*
       * The error is forced from **outside** the surface, because the lock
       * disables everything inside it and this assertion needs both at once:
       * a rendered message *and* a disabled `FieldSet`. `fireEvent`, not
       * `user-event`, because under `dialog` and `drawer` the modal's overlay
       * makes the rest of the document `pointer-events: none`.
       */
      fireEvent.click(
        // `{ hidden: true }`: under `dialog` and `drawer` this button is
        // outside the modal, so Radix has `aria-hidden` over it.
        screen.getByRole("button", { hidden: true, name: "Fail" }),
      );

      /*
       * On the message itself, not on the element that would host it: a query
       * for `FieldGroup` would stay green if `AppFormError` were deleted
       * outright, which is precisely the property this test exists to pin.
       */
      const error = await screen.findByText("Saving failed");

      /*
       * `AppFormError` moved up one file at `D8.9`, so ADR-0035's guarantee
       * needs an assertion that is about structure rather than about which
       * module renders it: the failure `applyServerErrors` could not land on a
       * field reaches the operator, inside the form that produced it and
       * inside the lock that froze it. Nothing in the repository asserted the
       * error's nesting before — the shipped suite pins the *footer* inside
       * the lock, which is a different claim.
       */
      expect(error.closest("form")).not.toBeNull();
      expect(error.closest('[data-slot="field-set"][disabled]')).not.toBeNull();
    },
  );

  it("stops the FieldSet laying out, so the rows are the form's own grid children", async () => {
    renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    const fieldSet = document.querySelector('[data-slot="field-set"]');

    /*
     * `display: contents` removes the box, not the element — which is what
     * lets the container's row template on the `<form>` reach the three rows
     * while `disabled` and `aria-busy` still apply to everything inside.
     */
    expect(fieldSet).toHaveClass("contents");
  });

  it("bounds the dialog on DialogContent, and keeps its title and footer outside the scrolling element", async () => {
    renderSurface({ surface: "dialog" });

    await screen.findByLabelText("Name");

    const content = document.querySelector('[data-slot="dialog-content"]');
    const body = document.querySelector('[data-slot="surface-body"]');

    /*
     * **On `DialogContent`, not on the column** (`D8.11`, ADR-0048 §4). The
     * shipped dialog carried no `className` and therefore no `max-h` at all —
     * the element is centred by transform — so a bound on the inner form
     * bounded nothing and a long form grew the modal past the viewport.
     */
    expect(content).toHaveClass("max-h-[calc(100svh-2rem)]");
    /*
     * Asserted separately and as explicitly as the bound itself, because it
     * is the class that makes the bound *reach* the column: `DialogContent`
     * is `grid` and its implicit row track is `auto`, which sizes to the
     * column's content instead of shrinking to the container's `max-height`.
     * Without it the column's `1fr` body row resolves against content height
     * and `overflow-y-auto` never engages — and every other assertion here
     * would still be green.
     */
    expect(content).toHaveClass("grid-rows-[minmax(0,1fr)]");

    expect(body).toHaveClass("overflow-y-auto", "min-h-0");
    expect(
      body?.contains(screen.getByRole("heading", { name: "Demo record" })),
    ).toBe(false);
    expect(body?.contains(screen.getByRole("button", { name: "Save" }))).toBe(
      false,
    );
  });

  it("keeps the drawer's title and footer outside the scrolling element", async () => {
    renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    const body = document.querySelector('[data-slot="surface-body"]');

    expect(body).toHaveClass("overflow-y-auto", "min-h-0");
    expect(
      body?.contains(screen.getByRole("heading", { name: "Demo record" })),
    ).toBe(false);
    expect(body?.contains(screen.getByRole("button", { name: "Save" }))).toBe(
      false,
    );
  });

  it("gives the page variant no scrolling element at all", async () => {
    renderSurface({ surface: "page" });

    await screen.findByLabelText("Name");

    /*
     * A `page` surface renders under `fullHeight: false`, so ADR-0037's chain
     * gives its parent no definite height — an `overflow-y-auto min-h-0` body
     * inside an unbounded parent would scroll nothing and fix nothing. The
     * document scrolls, as it does today.
     */
    expect(
      document.querySelector('[data-slot="surface-body"]'),
    ).not.toHaveClass("overflow-y-auto");
  });

  it("keeps both shipped widths, and the drawer's gutters", async () => {
    const { unmount } = renderSurface({ surface: "drawer" });

    await screen.findByLabelText("Name");

    // What ships today, unchanged by the adoption.
    expect(document.querySelector('[data-slot="sheet-content"]')).toHaveClass(
      "w-full",
      "sm:max-w-lg",
    );
    // `SheetContent` supplies no padding; body and footer both carry it, or
    // Cancel and Save sit flush to the drawer's edge.
    expect(document.querySelector('[data-slot="surface-body"]')).toHaveClass(
      "px-4",
    );
    expect(document.querySelector('[data-slot="surface-footer"]')).toHaveClass(
      "px-4",
      "pb-4",
    );

    unmount();
    renderSurface({ surface: "page" });

    await screen.findByLabelText("Name");

    // The class `AppFormPage` used to hardcode, now the `md` size token.
    expect(document.querySelector('[data-slot="record-surface"]')).toHaveClass(
      "max-w-2xl",
    );
  });
});
