import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ENTRY_SHARE_OF_JS,
  HEADROOM_PERCENT,
  UTILITY_BY_PACKAGE,
  check,
  chunkMeasurements,
  entryShareViolation,
  headroomViolations,
  maxCeiling,
  missingUtilities,
  requiredUtilities,
} from "./size.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** A budget file in the shape both apps commit, every row 5% over its baseline. */
const budget = () => ({
  baseline: {
    measuredAt: "2026-09-18",
    step: "D20.9",
    js: 100000,
    css: 10000,
    entry: 50000,
    chunks: { react: 20000, router: 8000 },
  },
  budgets: { js: 105000, css: 10500, entry: 52500 },
  chunks: { react: 21000, router: 8400 },
});

test("a ceiling within 15% of its baseline passes", () => {
  assert.deepEqual(headroomViolations(budget()), []);

  // The bound itself is inside, and it is computed in whole bytes rather
  // than as `baseline * 1.15`, which a double puts one byte short.
  assert.equal(HEADROOM_PERCENT, 15);
  assert.equal(maxCeiling(100000), 115000);
  assert.equal(maxCeiling(160915), 185052);

  const atTheLine = budget();
  atTheLine.budgets.js = maxCeiling(100000);
  assert.deepEqual(headroomViolations(atTheLine), []);
});

test("a ceiling more than 15% over its baseline fails, naming the row", () => {
  const loose = budget();
  loose.budgets.js = 115001;

  assert.deepEqual(headroomViolations(loose), [
    { key: "js", ceiling: 115001, baseline: 100000, max: 115000 },
  ]);
});

test("a chunk ceiling is bounded the same way as a total", () => {
  // The shape ADR-0062 §4 added is under the same rule, or a vendor group
  // could be raised past the line the totals hold.
  const loose = budget();
  loose.chunks.react = 23001;

  assert.deepEqual(headroomViolations(loose), [
    { key: "chunks.react", ceiling: 23001, baseline: 20000, max: 23000 },
  ]);
});

test("a ceiling with no baseline under it is a violation, not a pass", () => {
  // A budget file that deleted a baseline row would otherwise have unbounded
  // that ceiling — the silent-pass class the script exists to refuse.
  const orphaned = budget();
  delete orphaned.baseline.entry;
  delete orphaned.baseline.chunks.router;

  assert.deepEqual(
    headroomViolations(orphaned).map((v) => v.key),
    ["entry", "chunks.router"],
  );
  assert.deepEqual(
    headroomViolations({ budgets: { js: 1 }, chunks: {} }).map((v) => v.key),
    ["js"],
  );
});

test("the entry may not be budgeted above 60% of js, and both rows must exist", () => {
  assert.equal(entryShareViolation({ js: 100000, entry: 60000 }), null);
  assert.match(
    entryShareViolation({ js: 100000, entry: 60001 }) ?? "",
    /more than 60% of the js budget/,
  );
  assert.match(entryShareViolation({ js: 100000 }) ?? "", /must name both/);
  assert.equal(ENTRY_SHARE_OF_JS, 0.6);
});

test("the utilities the built CSS must carry follow the app's dependencies", () => {
  // The one line that differed between the two copies of this script: the
  // customer draws no grid, so it owes no rule only the grid uses.
  const admin = { "@repo/form": "*", "@repo/grid": "*", "@repo/app-kit": "*" };
  const customer = { "@repo/form": "*", "@repo/app-kit": "*" };

  assert.deepEqual(
    requiredUtilities(admin).map((u) => u.from),
    Object.keys(UTILITY_BY_PACKAGE),
  );
  assert.deepEqual(
    requiredUtilities(customer).map((u) => u.className),
    ["gap-5", "max-w-[400px]"],
  );
});

test("a manifest naming no rendering package is refused, not measured as nothing", () => {
  // The way deriving the list from the manifest could fail open: move a
  // workspace package to `devDependencies` and it still resolves, still
  // bundles, and its outcome check silently stops existing.
  for (const dependencies of [undefined, {}, { react: "*" }]) {
    assert.throws(
      () => requiredUtilities(dependencies),
      /names none of the rendering packages/,
    );
  }
});

test("a utility is looked for as the selector Tailwind writes, escaped", () => {
  const required = requiredUtilities({
    "@repo/app-kit": "*",
    "@repo/form": "*",
  });

  assert.deepEqual(
    missingUtilities(".max-w-\\[400px\\]{max-width:400px}", required).map(
      (u) => u.className,
    ),
    ["gap-5"],
  );
  // The unescaped spelling is not a CSS selector and must not count.
  assert.deepEqual(
    missingUtilities(".max-w-[400px]{}.gap-5{}", required).map(
      (u) => u.className,
    ),
    ["max-w-[400px]"],
  );
});

test("a budgeted chunk matches exactly one vendor file, and every vendor file is budgeted", () => {
  const measured = new Map([
    ["react-D9l_3wHM.js", 100],
    ["router-Bsr5BqoO.js", 50],
  ]);

  assert.deepEqual(chunkMeasurements({ react: 110, router: 55 }, measured), [
    { key: "react", actual: 100, limit: 110 },
    { key: "router", actual: 50, limit: 55 },
  ]);
  assert.throws(
    () => chunkMeasurements({ react: 110 }, measured),
    /router-Bsr5BqoO\.js is a vendor chunk nothing budgets/,
  );
  assert.throws(
    () => chunkMeasurements({ react: 110, router: 55, query: 10 }, measured),
    /chunk "query", which matches 0 files/,
  );
});

test("a missing build is named as one, rather than thrown as an ENOENT", async () => {
  // The order of the checks inside `check` is load-bearing: reading the built
  // CSS first put a bare `readdirSync` ahead of the one sentence that says
  // `build` did not run, and the handler at the foot of the script only
  // dresses its own refusals.
  const appDir = await mkdtemp(path.join(tmpdir(), "size-"));

  try {
    await writeFile(
      path.join(appDir, "size-budget.json"),
      JSON.stringify(budget()),
    );
    await writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({ dependencies: { "@repo/app-kit": "workspace:*" } }),
    );

    assert.throws(() => check(appDir), /dist\/index\.html is missing/);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test("both committed budget files satisfy the headroom rule today", async () => {
  // The rule is only worth having if the tree it lands in already keeps it;
  // this is the tree, read rather than restated.
  for (const app of ["admin", "customer"]) {
    const file = path.join(repoRoot, "apps", app, "size-budget.json");
    const parsed = JSON.parse(await readFile(file, "utf8"));

    assert.deepEqual(headroomViolations(parsed), [], `apps/${app}`);
    assert.equal(entryShareViolation(parsed.budgets), null, `apps/${app}`);
    assert.match(
      parsed.baseline.measuredAt,
      /^\d{4}-\d{2}-\d{2}$/,
      `apps/${app}: baseline.measuredAt is the date the baseline was measured`,
    );
  }
});
