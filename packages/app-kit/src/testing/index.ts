/**
 * The SPA test harness (ADR-0036), extracted at `D14.8` (ADR-0062 §1).
 *
 * **A separate entry point from the kit's own**, and that is the whole reason
 * this directory is reached as `@repo/app-kit/testing`: it imports `msw/node`
 * and `@testing-library/react`, and a single barrel would put both into the
 * module graph of every app that renders a provider — which `pnpm size`
 * would then price in the production bundle.
 *
 * What is here is the part with no app in it: the server, the jsdom the whole
 * tier runs on, and — since `D20.10` — the two response builders every MSW
 * handler in both apps goes through. `envelope.ts` names only
 * `@repo/contracts` types and `msw`; `list-query.ts` names neither, and reads
 * a URL back the way Express would. Neither has a segment, a route, a fixture
 * or a dictionary in it, which is the test ADR-0062 §1 applies — "can a door
 * bind the difference with a value" — answered by there being no difference.
 *
 * The **render helpers stay in the apps** and this is not an omission: a
 * render helper builds the app's own route tree, its API client at its own
 * segment and its own provider stack, none of which a package may name
 * (ADR-0062 §Consequences, and §1's `D14.8` amendment, which names
 * `test/render.tsx` among the files that stay for exactly that reason).
 * ADR-0077 §1 moved the session and the root's join into the kit and left
 * the render helpers where they were, with the router and the route tree.
 */
export { fail, listOk, ok } from "./envelope";
export { nestSearchParams, parseListSearch } from "./list-query";
export { server } from "./msw-server";
