import { useMatches } from "@tanstack/react-router";

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
 * The title the current route declares, for the layout that frames it.
 *
 * Both shells need it, and ADR-0032's dependency rule says a pattern two
 * widgets share is demoted rather than imported sideways — so it lives here.
 */
export const useRouteTitle = (fallback: string): string => {
  const matches = useMatches();

  return (
    [...matches].reverse().find((match) => match.staticData.title)?.staticData
      .title ?? fallback
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
