import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare global {
  // React reads this as a global var, not a property
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Testing Library's automatic cleanup only registers itself when the test
// globals are injected, and `@repo/vitest-config` leaves them off.
afterEach(() => {
  cleanup();
});

export {};
