/**
 * The SPA test harness (ADR-0036), extracted at `D14.8` (ADR-0062 §1).
 *
 * **A separate entry point from the kit's own**, and that is the whole reason
 * this directory is reached as `@repo/app-kit/testing`: it imports `msw/node`
 * and `@testing-library/react`, and a single barrel would put both into the
 * module graph of every app that renders a provider — which `pnpm size`
 * would then price in the production bundle.
 *
 * The **render helpers stay in the apps** and this is not an omission: a
 * render helper builds the app's own route tree, its API client at its own
 * segment and its own provider stack, none of which a package may name
 * (ADR-0062 §Consequences). What travels is the part with no app in it — the
 * server, and the jsdom the whole tier runs on.
 */
export { server } from "./msw-server";
