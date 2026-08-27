import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * The form package's harness (`D9.5`, ADR-0036).
 *
 * jest-dom's matchers, and Testing Library's cleanup — registered by hand
 * because `@repo/vitest-config` leaves the test globals off, so the automatic
 * teardown never installs itself.
 *
 * **Nothing here mocks the network, and nothing renders a resource.** The form
 * tests that need the admin's render harness, its MSW server or the demo
 * fixture stayed in `apps/admin/src/shared/form/__tests__` — each of those is
 * that app's. What is left here is what can be asked of this machinery with
 * only its own copy mounted, which today is the zod locale installer: it is
 * the one piece whose whole subject is `@repo/contracts` and this package's
 * own catalogues, with no resource anywhere in it.
 */
afterEach(() => {
  cleanup();
});
