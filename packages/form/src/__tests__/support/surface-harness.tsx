import { zodResolver } from "@hookform/resolvers/zod";
import {
  useRouteFullHeight,
  useRouteRecordLabel,
  useRouteTitle,
} from "@repo/app-services";
import { initialValuesFor, type EditSurfaceKey } from "@repo/resource";
import { AppShell } from "@repo/ui/compositions/app-shell";
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";

import { createAppFormInput } from "../../app-form-input";
import { AppFormSurface } from "../../app-form-surface";
import {
  demoCreateBody,
  demoResourceConfig,
  type DemoCreateBody,
} from "./demo-resource";
import { createTestI18n } from "./render";

/**
 * The harness the two `app-form-surface` files render the three shells
 * through (`D4.2`, ADR-0040; moved `D22.3`, ADR-0077 §4).
 *
 * It is the top half of the admin's `shared/form/__tests__/app-form-surface.test.tsx`,
 * which reached this package through the door and was the fifth file over
 * six hundred lines the 2026-09-21 review named (`FE-15`). It moved here and
 * split as it landed: the shells' shared behaviour in
 * `app-form-surface.test.tsx`, the inverted frame's structure in
 * `app-form-surface-layout.test.tsx`, and this module between them. The route
 * channel's hooks are `@repo/app-services`' and the shell is `@repo/ui`'s —
 * the same two the admin's door re-exported — and the shell's fallback title is
 * the fixture's `demo:shellFallback`, where the admin passed its own
 * `dashboard:` key.
 */

export const DemoFormInput = createAppFormInput(demoResourceConfig.fields);

export const SURFACES: readonly EditSurfaceKey[] = ["dialog", "drawer", "page"];

export const DemoSurface = ({
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
export const RECORD_LABEL = "ada@example.com";

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
  const routeTitle = useRouteTitle("demo:shellFallback");
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
export type HarnessOptions = Parameters<typeof DemoSurface>[0] & {
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
export const renderSurface = ({
  route = "create",
  ...props
}: HarnessOptions): RenderResult => {
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
   *
   * **The render result alone since `D22.3`.** The router rode along in the
   * admin, where no case read it; exported from a module of its own, its
   * inferred type is one the declaration emit cannot name portably, so it is
   * dropped rather than annotated for nobody.
   */
  return render(
    <I18nextProvider i18n={createTestI18n().instance}>
      <RouterProvider router={router as never} />
    </I18nextProvider>,
  );
};
