import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

/**
 * The account package's harness (`D22.2`, ADR-0077 §4, ADR-0036).
 *
 * jest-dom's matchers, Testing Library's cleanup — registered by hand because
 * `@repo/vitest-config` leaves the test globals off — and an MSW server of
 * this package's own, because most of what is here fetches.
 *
 * **Not `@repo/app-kit/testing`.** That harness is the apps', and this package
 * depends on the kit never (ADR-0077 §2), so the few lines it needs are
 * written here: the server's lifecycle, the media query jsdom does not
 * implement and the theme reads, and the pointer-capture trio Radix's dialog
 * asks for.
 */
configure({ asyncUtilTimeout: 10_000 });

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

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // A request nothing answered fails the test that made it (ADR-0036).
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
