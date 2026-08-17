import { defineConfig, mergeConfig } from "vitest/config";
import { reactConfig } from "@repo/vitest-config/react";

export default mergeConfig(
  reactConfig,
  defineConfig({
    test: {
      setupFiles: ["./test/setup.ts"],
    },
  }),
);
