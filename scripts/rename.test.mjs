// `scripts/rename.mjs` formats what it rewrites (ADR-0084 §1). Each case
// builds a small tree under the OS temp directory, formatted as
// `format:check` reads it with the placeholder name, renames it to a longer
// one, and reads every rewritten file back through Prettier. Nothing here
// touches this repository, and nothing reads its product name but the
// placeholder the script itself removes.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import * as prettier from "prettier";

// The placeholder is the script's own, never spelled here: a fork's rename
// rewrites every file but the script, and a literal in this one would move.
import { TOKEN, renameTree, rewrite } from "./rename.mjs";

/** Longer than the placeholder, so lines grow past what Prettier leaves. */
const NAME = "acme-platform";

const FILES = {
  ".prettierrc.json": '{\n  "endOfLine": "auto"\n}\n',
  ".prettierignore": "ignored/\n",
  // A Markdown table widens with its longest cell.
  "docs/names.md": [
    "# Names",
    "",
    "| Part  | Name              |",
    "| ----- | ----------------- |",
    `| API   | \`${TOKEN}-api\`    |`,
    `| Admin | \`${TOKEN}-admin\`  |`,
    "",
  ].join("\n"),
  // A line that fits at the placeholder's length and wraps at the new one.
  "src/names.ts": `export const names = ["${TOKEN}-api", "${TOKEN}-admin", "${TOKEN}-app"];\n`,
  // A member chain the first pass breaks and the second joins again.
  "src/seed.test.ts": [
    'it("seeds a nameless account", async () => {',
    "  await client.db",
    "    .insert(users)",
    `    .values({ email: "nameless@${TOKEN}.test", emailVerifiedAt: VERIFIED_AT });`,
    "});",
    "",
  ].join("\n"),
  "package.json": `{\n  "name": "${TOKEN}-starter",\n  "private": true\n}\n`,
  // Ignored by `.prettierignore`: rewritten, and left as the rewrite leaves it.
  "ignored/table.md": `| a | \`${TOKEN}\` |\n| - | - |\n`,
};

const dirs = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const optionsFor = async (root, rel) => ({
  ...((await prettier.resolveConfig(path.join(root, rel))) ?? {}),
  filepath: path.join(root, rel),
});

const check = async (root, rel, text) =>
  prettier.check(text, await optionsFor(root, rel));

const formattedFiles = [
  "docs/names.md",
  "src/names.ts",
  "src/seed.test.ts",
  "package.json",
];

/**
 * The fixture under the OS temp directory, each file Prettier reads written
 * as `format:check` would have it with the placeholder — the state a fresh
 * clone is in. Returns the root and what was written.
 */
async function tree() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rename-"));
  dirs.push(root);
  const written = {};
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  for (const [rel, text] of Object.entries(FILES)) {
    written[rel] = formattedFiles.includes(rel)
      ? await prettier.format(text, await optionsFor(root, rel))
      : text;
    writeFileSync(path.join(root, rel), written[rel]);
  }
  return { root, written };
}

describe("rename", () => {
  it("the renamed files pass format:check", async () => {
    const { root, written } = await tree();

    // The bare rewrite of each would fail `format:check`, so the case proves
    // the formatting rather than the fixture.
    for (const rel of ["docs/names.md", "src/names.ts", "src/seed.test.ts"]) {
      assert.equal(
        await check(root, rel, rewrite(written[rel], NAME)),
        false,
        `${rel}'s bare rewrite is not formatted`,
      );
    }

    const { changed, formatted } = await renameTree({ root, name: NAME });

    assert.deepEqual(changed.map((c) => c.relative).sort(), [
      "docs/names.md",
      "ignored/table.md",
      "package.json",
      "src/names.ts",
      "src/seed.test.ts",
    ]);
    assert.deepEqual(formatted.sort(), [
      "docs/names.md",
      "src/names.ts",
      "src/seed.test.ts",
    ]);
    for (const rel of formattedFiles) {
      const text = readFileSync(path.join(root, rel), "utf8");
      assert.ok(!text.includes(TOKEN), `${rel} carries no placeholder`);
      assert.ok(await check(root, rel, text), `${rel} passes format:check`);
    }
    // What `.prettierignore` names is rewritten and not formatted.
    assert.equal(
      readFileSync(path.join(root, "ignored/table.md"), "utf8"),
      rewrite(written["ignored/table.md"], NAME),
    );
  });

  it("a dry run writes and formats nothing", async () => {
    const { root, written } = await tree();
    const result = await renameTree({ root, name: NAME, dryRun: true });

    assert.equal(result.changed.length, 5);
    assert.deepEqual(result.formatted, []);
    for (const [rel, text] of Object.entries(written)) {
      assert.equal(readFileSync(path.join(root, rel), "utf8"), text, rel);
    }
    assert.ok(existsSync(path.join(root, "src/names.ts")));
  });
});
