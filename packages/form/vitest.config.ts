import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The form machinery's suite (`D9.5`, ADR-0036).
 *
 * `reactConfig` because this package is components — the adapters, the frame
 * and the three shells all render — and because `zod-locale.ts`'s installer is
 * driven through an i18next instance, which is what `@repo/i18n` is built for.
 *
 * **On `@repo/app-kit/testing` since `D22.3`** (ADR-0077 §4). The suites that
 * certified this package through the admin's door moved here, and the three
 * shells need what that harness gives them: Radix's pointer-capture trio and
 * `scrollIntoView`, the media query jsdom lacks, `scrollTo` for the router's
 * scroll restoration, and an MSW server that fails any request nothing
 * answers. The package's own setup file registered only the cleanup, which
 * the harness registers too, so it retired with the move.
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
