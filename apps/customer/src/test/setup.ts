import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw/server";

/**
 * The harness ADR-0036 specifies, on its second app (ADR-0055 §2).
 *
 * `onUnhandledRequest: "error"` is the half worth stating. A request nobody
 * mocked would otherwise fall through to a real socket and fail slowly, or
 * worse, succeed against whatever is listening; failing loudly at the boundary
 * is what keeps "the suite needs no server" true rather than merely intended —
 * and in this app it is also what catches a handler written on the wrong
 * segment, since `/api/v1/admin` is exactly a URL nothing here answers.
 *
 * `asyncUtilTimeout` is a *ceiling*, not a delay: every query still resolves as
 * soon as the DOM says so, and a genuinely broken assertion costs the ceiling
 * instead of a second before failing. Twenty, matching the admin's, and it has
 * to stay **below** `vitest.config.ts`'s `testTimeout` — or a genuinely failing
 * `findBy*` races the test timeout and reports "Test timed out" instead of
 * naming the element it could not find. Anything raised here keeps the gap.
 */
configure({ asyncUtilTimeout: 20_000 });

/**
 * The jsdom ceiling ADR-0036 names as a known consequence, stubbed where the
 * design system needs it.
 *
 * jsdom implements no media queries and the design system's `useIsMobile`
 * subscribes to one; Radix's menus and popovers use the Pointer Events capture
 * API and `scrollIntoView`, and jsdom implements neither. The suite asserts
 * roles and labels, never layout, so a media query that always answers
 * "desktop" removes nothing it was going to check.
 *
 * `scrollTo` is *assigned* rather than `??=`d for a different reason: jsdom
 * has it and answers every call with a "Not implemented" console error, which
 * TanStack Router's scroll restoration triggers on every navigation. The method
 * exists; it is the behaviour that does not.
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

  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;

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
