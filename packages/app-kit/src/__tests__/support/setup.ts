import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * The kit's own harness (ADR-0036).
 *
 * jest-dom's matchers and Testing Library's cleanup, registered by hand
 * because `@repo/vitest-config` leaves the test globals off, so the automatic
 * teardown never installs itself.
 *
 * **Not `src/testing/setup.ts`**, which is the *apps'* setup file and part of
 * this package's published surface: that one starts an MSW server and stubs
 * the jsdom an SPA suite needs. Nothing here mocks the network, because
 * nothing in the kit fetches.
 */
afterEach(() => {
  cleanup();
});
