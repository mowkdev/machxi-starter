import { integrationConfig } from "@repo/vitest-config/node";
import { mergeConfig } from "vitest/config";

/**
 * Integration run (ADR-0021): supertest against `createApp(buildContainer(…))`
 * with a real Postgres.
 *
 * `globalSetup` rebuilds `machxi_test` from the committed migrations once;
 * `setupFiles` loads `apps/api/.env.test` inside each forked worker, which is
 * where the app's config is actually parsed.
 */
export default mergeConfig(integrationConfig, {
  test: {
    globalSetup: ["./test/setup/global-setup.ts"],
    setupFiles: ["./test/setup/env.ts"],
  },
});
