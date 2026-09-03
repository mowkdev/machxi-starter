import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw-server";

/**
 * The SPA suites' setup file (ADR-0036), extracted at `D14.8` (ADR-0062 §1).
 *
 * It was byte-identical in both apps, which is what a jsdom is: neither app's
 * `matchMedia` stub, `ResizeObserver` stub or MSW lifecycle had anything in it
 * about staff or about customers. Each app's `vitest.config.ts` names it as
 * `setupFiles`, and the ceiling below still has to stay under that file's
 * `testTimeout` — the two numbers are a pair and both apps keep the gap.
 */

/**
 * Testing Library's default `findBy*` timeout is one second, which is fine for
 * a component and not for the first render in a file that mounts the whole
 * route tree: the router, the generated tree and the design system all load on
 * that render, and under the parallelism `vitest run` uses across eighteen
 * files it lands either side of the second. The symptom is a suite that passes
 * per file and flakes in the gate, which is the worst shape a suite can take —
 * so the bound is raised once, here, rather than sprinkled per assertion.
 *
 * It is a *ceiling*, not a delay: every query still resolves as soon as the
 * DOM says so, and a genuinely broken assertion costs the ceiling instead of a
 * second before failing.
 *
 * **Raised from five seconds to fifteen at `D4.4`**, on a measurement rather
 * than a hunch. On a loaded machine the first `findByRole` in
 * `staff-page.test.tsx` and `users-page.test.tsx` — the two files that mount
 * the whole route tree and then wait for a list — crossed five seconds
 * consistently, and the same two assertions failed the same way with `D4.4`
 * *stashed*, so the cause is the load the whole suite is under, not any
 * screen's render cost. The bound was set against one machine's idle timings
 * and the number was the only thing standing between "the gate is green" and
 * "the gate is green here"; fifteen has the headroom the file's own paragraph
 * says it wants, and costs nothing when the DOM arrives on time.
 *
 * **Ten, and not fifteen, because `vitest.config.ts` pins `testTimeout` at
 * fifteen for a reason it writes down**: the test ceiling has to sit *above*
 * this one, or a genuinely failing `findBy*` races the test timeout and reports
 * "Test timed out in 15000ms" instead of naming the element it could not find.
 * Setting the two equal — the first version of this raise — would have quietly
 * undone that fix and made the sentence above ("a genuinely broken assertion
 * costs the ceiling before failing") false. Anything raised here has to keep
 * the gap.
 */
/*
 * **Twenty at `D9.4`**, moved with `vitest.config.ts`'s ceiling and for the
 * same reason: the extracted packages are transformed per worker, so the
 * suite's slowest first renders got slower under the full `pnpm test` run.
 * The gap below the test timeout is the point — see that file.
 */
configure({ asyncUtilTimeout: 20_000 });

/**
 * The harness ADR-0036 specifies: jest-dom matchers and the MSW lifecycle.
 *
 * `onUnhandledRequest: "error"` is the half worth stating. A request nobody
 * mocked would otherwise fall through to a real socket and fail slowly, or
 * worse, succeed against whatever is listening; failing loudly at the boundary
 * is what keeps "the suite needs no server" true rather than merely intended.
 */
/*
 * jsdom implements no media queries, and the design system's `useIsMobile`
 * subscribes to one — so the sidebar cannot render without this. ADR-0036 names
 * "jsdom fidelity is a known ceiling" as a consequence; this is the first place
 * it bites, and a stub is the proportionate answer: the suite asserts roles and
 * labels, never layout, so a media query that always answers "desktop" removes
 * nothing it was going to check.
 *
 * The escape hatch, if a future feature genuinely needs real breakpoints, is
 * Vitest browser mode — recorded in ADR-0036 §Alternatives, and reached for
 * before Playwright.
 */
beforeAll(() => {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;

  /*
   * The rest of the jsdom ceiling, in the same place and for the same reason.
   * Radix's menus and popovers use the Pointer Events capture API and
   * `scrollIntoView`, and jsdom implements neither — without these a
   * `user-event` click on a dropdown trigger throws instead of opening it, and
   * every menu in the app becomes untestable for a reason that has nothing to
   * do with the app.
   */
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;

  /*
   * jsdom *has* `scrollTo` and answers every call with a "Not implemented"
   * console error, which TanStack Router's scroll restoration triggers on every
   * navigation — so a routing test's output is mostly that. Assigned rather
   * than `??=`d for exactly that reason: the method exists, it is the behaviour
   * that does not. Nothing in this suite asserts scroll position.
   */
  window.scrollTo = () => undefined;

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  // Testing Library's automatic cleanup only registers itself when the test
  // globals are injected, and `@repo/vitest-config` leaves them off.
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
