import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * The grid package's harness (`D9.4`, ADR-0036).
 *
 * jest-dom's matchers, and Testing Library's cleanup — which has to be
 * registered by hand because `@repo/vitest-config` leaves the test globals
 * off, so the automatic teardown never installs itself.
 *
 * **Nothing here mocks the network**, and that is the shape of what stayed:
 * the grid tests that needed MSW, the app's render harness or the demo
 * resource went back to `apps/admin/src/shared/grid/__tests__`, where those
 * things live. What is left in this package is what can be asked of the grid
 * with only React mounted.
 */
afterEach(() => {
  cleanup();
});
