import { useMatches } from "@tanstack/react-router";

/**
 * The title the current route declares, for the layout that frames it.
 *
 * Both shells need it, and ADR-0032's dependency rule says a pattern two
 * widgets share is demoted rather than imported sideways — so it lives here.
 *
 * The deepest match that declares one wins, so a nested route can override its
 * parent without the parent knowing. Declaring it on the route rather than
 * looking it up in the layout is what keeps a page and its heading from
 * drifting apart.
 */
export const useRouteTitle = (fallback: string): string => {
  const matches = useMatches();

  return (
    [...matches].reverse().find((match) => match.staticData.title)?.staticData
      .title ?? fallback
  );
};
