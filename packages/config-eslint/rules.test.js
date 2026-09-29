/**
 * The rules this package exists to carry, each refusing a negative fixture.
 *
 * `pnpm lint` passing proves the rule set loads and the tree is clean; it does
 * not prove a rule still fires. A plugin that loads and reports nothing — an
 * ESLint major that changes an API a rule reads, a plugin running outside its
 * declared peer range, a selector that stops matching — leaves every
 * workspace green. So each decision the configs make mechanical is linted
 * here against a snippet that breaks it, and the case asserts the rule that
 * must answer (`D21.2`, where `eslint-plugin-react` runs on ESLint 10 ahead
 * of its peer range).
 *
 * The fixtures are text linted under a virtual path, so nothing is written to
 * a tree another task may be linting. Type information is switched off for
 * them — a virtual file is in no TypeScript program — which leaves every rule
 * below deciding syntactically; `no-literal-string` then reports every JSX
 * literal rather than skipping typed ones, which a negative fixture does not
 * mind.
 */
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

import { adminConfig } from "./admin.js";
import { apiConfig } from "./api.js";
import { doorRules, restrictImports } from "./doors.js";

const root = dirname(fileURLToPath(import.meta.url));

/** Lint `code` as `filePath` under `config`, without a TypeScript program. */
const ruleIds = async (config, filePath, code) => {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [...config, tseslint.configs.disableTypeChecked],
  });
  const [result] = await eslint.lintText(code, { filePath });
  const fatal = result.messages.filter((message) => message.fatal);
  assert.deepEqual(fatal, [], `${filePath} did not parse`);
  return result.messages.map((message) => message.ruleId);
};

const api = apiConfig({ tsconfigRootDir: root });

test("the API layering refuses HTTP in a service (ADR-0009)", async () => {
  const ids = await ruleIds(
    api,
    "src/modules/widgets/widgets.service.ts",
    'import type { Request } from "express";\nexport type Input = Request;\n',
  );
  assert.ok(ids.includes("no-restricted-imports"), String(ids));
});

test("the API layering refuses a table in a controller (ADR-0009)", async () => {
  const ids = await ruleIds(
    api,
    "src/modules/widgets/widgets.controller.ts",
    'import { users } from "@repo/db/schema";\nexport const table = users;\n',
  );
  assert.ok(ids.includes("no-restricted-imports"), String(ids));
});

test("the functional style refuses a class (ADR-0009)", async () => {
  const ids = await ruleIds(
    api,
    "src/modules/widgets/widgets.mapper.ts",
    "export class WidgetMapper {}\n",
  );
  assert.ok(ids.includes("no-restricted-syntax"), String(ids));
});

test("the same API config accepts a clean module file", async () => {
  const ids = await ruleIds(
    api,
    "src/modules/widgets/widgets.mapper.ts",
    "export const toWidget = (row: { id: string }) => ({ id: row.id });\n",
  );
  assert.deepEqual(ids, []);
});

test("a repository may reach the tables a controller may not (ADR-0009)", async () => {
  // The negative control for the two cases above: the restrictions are
  // scoped by layer, so the same import is clean where SQL belongs.
  const ids = await ruleIds(
    api,
    "src/modules/widgets/widgets.repository.ts",
    'import { users } from "@repo/db/schema";\nexport const table = users;\n',
  );
  assert.deepEqual(ids, []);
});

const DOORS = [
  {
    slices: ["ui"],
    group: ["@repo/ui/components/*"],
    message: "Through the ui door (ADR-0051).",
  },
  {
    slices: ["grid"],
    group: ["@repo/grid", "@repo/grid/*"],
    message: "Through the grid door (ADR-0051).",
  },
];

const admin = [
  ...adminConfig({ tsconfigRootDir: root }),
  {
    files: ["src/**"],
    rules: { "no-restricted-imports": restrictImports(DOORS) },
  },
  ...doorRules(DOORS),
];

test("a door refuses its package outside `shared/` (ADR-0051)", async () => {
  const ids = await ruleIds(
    admin,
    "src/pages/widgets/page.ts",
    'import { Button } from "@repo/ui/components/button";\nexport { Button };\n',
  );
  assert.ok(ids.includes("no-restricted-imports"), String(ids));
});

test("a door slice may reach its own package and no other (ADR-0051)", async () => {
  const own = await ruleIds(
    admin,
    "src/shared/ui/button.ts",
    'export { Button } from "@repo/ui/components/button";\n',
  );
  assert.deepEqual(own, []);

  const other = await ruleIds(
    admin,
    "src/shared/ui/grid.ts",
    'import { Grid } from "@repo/grid";\nexport { Grid };\n',
  );
  assert.ok(other.includes("no-restricted-imports"), String(other));
});

const FEATURE_DOORS = [
  ...DOORS,
  {
    slices: ["features/auth", "entities/settings"],
    group: ["@repo/account", "@repo/account/*"],
    message: "Through the account's slices (ADR-0077).",
  },
];

const withFeatureDoor = [
  ...adminConfig({ tsconfigRootDir: root }),
  {
    files: ["src/**"],
    rules: { "no-restricted-imports": restrictImports(FEATURE_DOORS) },
  },
  ...doorRules(FEATURE_DOORS),
];

test("a feature slice is a door for its own groups and no others (ADR-0077)", async () => {
  const account = 'export { useSettings } from "@repo/account";\n';

  // Its own group, from each kind of slice the row names.
  for (const door of [
    "src/features/auth/index.ts",
    "src/entities/settings/index.ts",
  ]) {
    assert.deepEqual(await ruleIds(withFeatureDoor, door, account), [], door);
  }

  // No other group: the slice is a door onto the account and nothing else.
  const other = await ruleIds(
    withFeatureDoor,
    "src/features/auth/index.ts",
    'import { Grid } from "@repo/grid";\nexport { Grid };\n',
  );
  assert.ok(other.includes("no-restricted-imports"), String(other));

  // And nobody else's door: a page, a slice the row does not name, and a
  // `shared/` slice of the same name are all refused the package.
  for (const outside of [
    "src/pages/account/index.tsx",
    "src/features/users-manage/index.ts",
    "src/shared/auth/index.ts",
    "src/shared/ui/index.ts",
  ]) {
    const ids = await ruleIds(withFeatureDoor, outside, account);
    assert.ok(ids.includes("no-restricted-imports"), `${outside}: ${ids}`);
  }
});

test("operator-facing copy refuses a literal (ADR-0046)", async () => {
  const ids = await ruleIds(
    admin,
    "src/pages/widgets/title.tsx",
    "export const Title = () => <h1>Widgets</h1>;\n",
  );
  assert.ok(ids.includes("i18next/no-literal-string"), String(ids));
});

test("React's rules still answer on this ESLint (eslint-plugin-react, react-hooks)", async () => {
  const ids = await ruleIds(
    admin,
    "src/shared/lib/list.tsx",
    [
      'import { useState } from "react";',
      "export const List = ({ items, on }: { items: string[]; on: boolean }) => {",
      "  if (on) useState(0);",
      "  return <ul>{items.map((item) => <li>{item}</li>)}</ul>;",
      "};",
      "",
    ].join("\n"),
  );
  assert.ok(ids.includes("react/jsx-key"), String(ids));
  assert.ok(ids.includes("react-hooks/rules-of-hooks"), String(ids));
});
