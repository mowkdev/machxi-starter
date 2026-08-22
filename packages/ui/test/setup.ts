import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare global {
  // React reads this as a global var, not a property
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * jsdom implements no media queries and `sidebar.tsx`'s `useIsMobile`
 * subscribes to one, so the sidebar primitives cannot render without this. The
 * admin app's harness carries the same stub for the same reason (ADR-0036 names
 * jsdom fidelity as a known ceiling); it arrives here at `D7.3`, which is the
 * first time this package's own suite renders one of them.
 *
 * Answering "desktop" removes nothing these tests check: they assert roles and
 * accessible names, never layout.
 */
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

// Testing Library's automatic cleanup only registers itself when the test
// globals are injected, and `@repo/vitest-config` leaves them off.
afterEach(() => {
  cleanup();
});

export {};
