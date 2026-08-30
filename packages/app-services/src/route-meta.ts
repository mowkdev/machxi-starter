import { useMatches } from "@tanstack/react-router";

import { useKeyT, type TranslationKey } from "@repo/i18n";

/**
 * What the current route declares about itself, for the shell that frames it.
 *
 * The deepest match that says something wins, so a nested route can override
 * its parent without the parent knowing, and declaring it on the route rather
 * than looking it up in the layout is what keeps a page and the frame around it
 * from drifting apart. Both readers below share that rule; the module is named
 * for the channel rather than for the first field that used it.
 */

/**
 * Per-route data the shells read, declared beside its readers (`D9.6`,
 * ADR-0051; ADR-0032: route files are wiring).
 *
 * **It moved here from `apps/admin/src/app/providers/router.tsx` with the
 * hooks, and had to.** A package that reads `match.staticData.title` needs the
 * property to exist in its own program, so the alternative to owning the
 * channel is type-checking against `StaticDataRouteOption`'s empty upstream
 * shape — which compiles in the app, where the augmentation happens to be
 * present, and not here. Declaration merging is program-global, so every
 * `createFileRoute` in a consuming app still gets the same typed `staticData`
 * and the same compile error for a typo.
 *
 * `Register.router` stayed in that app: it names that app's own
 * `createAppRouter` and could mean nothing here.
 */
declare module "@tanstack/react-router" {
  /**
   * Per-route data the shells read (ADR-0032: route files are wiring).
   * Declared here so `staticData.title` is typed at every `createFileRoute`,
   * and a typo is a compile error rather than a blank header.
   */
  interface StaticDataRouteOption {
    /**
     * A {@link TranslationKey} since `D7.4` (ADR-0046 §7), not a sentence: a
     * route title is copy that travels as data, so it follows the same rule the
     * resource configs and `meta.success` follow, and a typo is a compile error
     * at the route rather than a raw `staff:titel` in the header.
     */
    title?: TranslationKey;
    /**
     * The line under the title in the page-header band (ADR-0054 §5,
     * `D11.3`).
     *
     * A `TranslationKey` for the same reason `title` is one, and on the same
     * channel for the same reason: it is a sentence *about the screen*, so a
     * page and the band above it cannot drift apart, and the shell does not
     * have to hold a table of which path says what. It arrived when the page
     * card retired — the description used to be a `CardDescription` inside
     * each page, and the band is where the design puts it now.
     *
     * Optional everywhere: a screen with nothing to add renders no line.
     */
    description?: TranslationKey;
    /**
     * Whether this page is height-budgeted rather than document-flowed
     * (ADR-0037 §A height-budgeted grid shell). Grid pages opt in; a form
     * taller than the viewport should scroll as a document, not inside a pane,
     * so `false` — the default — is the right answer for most screens.
     *
     * It rides the same channel as `title` for the same reason: the shell must
     * not have to know which paths are grids, and a route already declares
     * what it is.
     */
    fullHeight?: boolean;
    /**
     * The loaded record's own label, for the routes that have one (`D8.6`,
     * ADR-0048 §2). Unlike the two above it is **not** a `TranslationKey`: a
     * record's label is loaded data, not copy, so it bypasses the `t()` wrap
     * `useRouteTitle` applies.
     *
     * **The parameter stays `unknown` and each route narrows inside its own
     * body.** Under `strictFunctionTypes` a declared `(loaderData: unknown)`
     * is checked contravariantly, so a callback written as
     * `(staff: StaffResource) => staff.email` would not satisfy it. What the
     * shape buys is therefore not the absence of a narrowing but its
     * *location*: one per route, written by the code that knows the type, and
     * no cast anywhere in `route-meta.ts` or its hooks.
     *
     * A match that carries no loader data yields `undefined`, and the shell
     * falls back to `staticData.title` — which is correct for the `new`
     * routes, where a record being created has no label yet.
     */
    recordLabel?: (loaderData: unknown) => string | undefined;
  }
}

/**
 * The title the current route declares, for the layout that frames it.
 *
 * Both shells need it, and ADR-0032's dependency rule says a pattern two
 * widgets share is demoted rather than imported sideways — so it lives here.
 *
 * **The route declares a key and this returns words** (`D7.4`, ADR-0046 §7).
 * Resolving it here rather than in the two shells is what keeps them free of
 * i18next: a widget renders whatever string it is given, and the one place that
 * reads `staticData` is the one place that knows the field is a key. The
 * fallback is a key too, because the two shells' own defaults — `Sign in`,
 * `Admin` — are copy an operator reads whenever a route declares nothing.
 */
export const useRouteTitle = (fallback: TranslationKey): string => {
  const matches = useMatches();
  const t = useKeyT();

  return t(
    [...matches].reverse().find((match) => match.staticData.title)?.staticData
      .title ?? fallback,
  );
};

/**
 * Whether the current route is height-budgeted (ADR-0037 §A height-budgeted
 * grid shell).
 *
 * Grid pages fill the viewport and scroll their rows in a pane; every other
 * page keeps normal document flow, because a form taller than the viewport
 * should scroll as a document. Absent means `false`: a new page is
 * document-flowed until it says otherwise, which is the safe default of the
 * two — a page that wanted the budget and did not ask for it looks like D3,
 * while one that got it unasked can be crushed to nothing.
 */
export const useRouteFullHeight = (): boolean => {
  const matches = useMatches();

  return (
    [...matches]
      .reverse()
      .find((match) => match.staticData.fullHeight !== undefined)?.staticData
      .fullHeight ?? false
  );
};

/**
 * The description the current route declares, or nothing (ADR-0054 §5,
 * `D11.3`).
 *
 * **The screen the band describes is not always the deepest match, and
 * `fullHeight` is what says which.** The discriminator is ADR-0048 §2's, not a
 * new one: on a record route `fullHeight === false` *is* the `page` surface.
 *
 * - **Page surface** (`fullHeight` false): the record replaced the list, so
 *   the description is read from the match whose *title* won. That route
 *   declares none, and the band correctly shows a heading with no line under
 *   it — rather than the list's sentence under the record's own name.
 * - **Overlay, or an ordinary list** (`fullHeight` true): the list is still
 *   the screen. The grid is mounted behind the modal and keeps ADR-0037's
 *   budget, so the deepest *description* wins and the band does not change.
 *
 * The second rule is the `D11.3` review's finding and the reason the two are
 * not one scan. Coupled to the title alone, opening a row on either shipped
 * resource — both overlays — took the description away, because the record
 * route declares a title and no description: nineteen pixels of band, handed
 * to the grid behind the dialog on open and taken back on close, twice per
 * edit. The `<h1>` above it does change to the record route's title while an
 * overlay is open; that is ADR-0048 §2's decision and this reader does not
 * revisit it.
 *
 * Unlike the title there is **no fallback**: a screen with nothing to say
 * renders no line, and a default sentence about "the current page" is the
 * kind of copy an operator learns to stop reading.
 */
export const useRouteDescription = (): string | undefined => {
  const matches = useMatches();
  const t = useKeyT();
  const fullHeight = useRouteFullHeight();

  const deepestFirst = [...matches].reverse();
  const key = fullHeight
    ? deepestFirst.find((match) => match.staticData.description)?.staticData
        .description
    : deepestFirst.find((match) => match.staticData.title)?.staticData
        .description;

  return key === undefined ? undefined : t(key);
};

/**
 * The loaded record's own label, where the route declares one (`D8.6`,
 * ADR-0048 §2).
 *
 * Beside {@link useRouteTitle} rather than inside it, and the difference is the
 * `t()` wrap: a title is a `TranslationKey` and a label is loaded data, so one
 * must be translated and the other must not. They also scan independently —
 * the deepest match declaring `recordLabel` is not necessarily the deepest one
 * declaring `title` — which is why this is a third reader rather than a second
 * return value.
 *
 * **No cast here, by construction.** The callback's parameter is `unknown` and
 * each `$id` route narrows inside its own body, because it owns the type of
 * its own loader data and is the only place the narrowing can be justified.
 * A match with no loader data, or a callback that cannot recognise what it was
 * handed, yields `undefined` and the caller falls back to the route title.
 *
 * Two consumers, one channel: the breadcrumb's last crumb takes the label
 * unconditionally, while the shell's `<h1>` takes it only where the record
 * renders as a page (ADR-0048 §2). The place that decides is the `_dashboard`
 * route file, not this reader.
 */
export const useRouteRecordLabel = (): string | undefined => {
  const matches = useMatches();

  const match = [...matches]
    .reverse()
    .find((candidate) => candidate.staticData.recordLabel !== undefined);

  return match?.staticData.recordLabel?.(match.loaderData);
};

/** One entry in the breadcrumb trail: what it says, and where it goes. */
export interface RouteCrumb {
  /**
   * The match's own id, for React's key. Not `to`: a layout route and its
   * index child share a `pathname`, so keying on the target is collision-free
   * only for as long as no index route declares a `title` — a trap that would
   * spring silently on whoever adds one.
   */
  readonly id: string;
  readonly label: string;
  /**
   * The resolved pathname, not a route pattern. It is a `string` rather than
   * one of the router's typed paths, which is the honest cost of linking to
   * whatever the current matches resolved to: a renamed route is a crumb that
   * 404s at runtime rather than a red `check-types`.
   */
  readonly to: string;
}

/**
 * The ancestor trail, in order, for the breadcrumbs the shell frames (`D8.6`,
 * ADR-0048 §2).
 *
 * The two readers above answer about the *deepest* match; this one is the
 * first that enumerates. It keeps the matches that declare a `title` — the
 * pathless `_dashboard` declares none, so it drops out on its own without
 * anything having to name it — translates each through the same `useKeyT` the
 * title reader uses (ADR-0046 §8: an ancestor crumb is operator-facing copy),
 * and pairs it with the resolved pathname to link to.
 *
 * It returns the record's own crumb as a **title**, because that is all
 * `staticData` carries; the caller appends the loaded label from
 * {@link useRouteRecordLabel} where there is one. Keeping the two apart is
 * what lets the trail's last crumb and the shell's heading disagree — which
 * they do on an edit route, where the route title is "Edit staff member" and
 * the label is the record's email.
 */
export const useRouteCrumbs = (): readonly RouteCrumb[] => {
  const matches = useMatches();
  const t = useKeyT();

  /*
   * `flatMap` rather than `filter().map()`: a filter does not narrow the
   * element type, so the map would need a cast to hand `title` to `t()` — and
   * this file is meant to be cast-free (`D8.6`). Dropping the empty array is
   * the same predicate, expressed where the compiler can follow it.
   */
  return matches.flatMap((match) => {
    const { title } = match.staticData;

    return title === undefined
      ? []
      : [{ id: match.id, label: t(title), to: match.pathname }];
  });
};
