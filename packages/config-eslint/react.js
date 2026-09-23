import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import { config as baseConfig } from "./index.js";

/**
 * A custom ESLint configuration for libraries that use React.
 */
export const config = [
  ...baseConfig,
  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat["jsx-runtime"],
  {
    settings: {
      /*
       * The React major, stated rather than `"detect"`ed (`D21.2`). Detection
       * calls `context.getFilename()`, which ESLint 10 removed, and
       * `eslint-plugin-react` 7.37.5 has no release that stops calling it
       * (jsx-eslint/eslint-plugin-react#4018, the wait named in
       * `pnpm-workspace.yaml`'s `peerDependencyRules`). The plugin reads the
       * version only to decide rules written for React before 16, so the
       * major is all it needs; every workspace here declares React 19.
       */
      react: { version: "19" },
    },
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  pluginReactHooks.configs.flat.recommended,
];
