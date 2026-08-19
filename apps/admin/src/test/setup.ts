import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw/server";

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
