import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The grid's suite (`D9.4`, ADR-0036).
 *
 * `reactConfig` because this package is components: the grid renders, and its
 * suite drives it through Testing Library exactly as the app's did.
 *
 * **On `@repo/app-kit/testing` since `D22.3`** (ADR-0077 §4). The door-level
 * suites that certified this package from inside the admin moved here, and
 * they brought the harness they ran on: the jsdom the SPA tier stands on —
 * `matchMedia`, `ResizeObserver`, the pointer-capture trio `@dnd-kit` and
 * Radix ask for — and an MSW server that fails any request nothing answers.
 * The package's own setup file carried a subset of the same stubs and retired
 * with the move rather than stay a second copy.
 *
 * `testTimeout` sits above the harness's twenty-second `asyncUtilTimeout` for
 * the reason both apps give: a failing `findBy*` must name the element it
 * could not find rather than lose the race to "Test timed out".
 */
export default mergeConfig(
  reactConfig,
  defineConfig({
    test: {
      setupFiles: ["@repo/app-kit/testing/setup"],
      testTimeout: 30_000,
    },
  }),
);
