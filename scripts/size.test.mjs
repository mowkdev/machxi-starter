import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  DRIFT_PERCENT,
  ENTRY_SHARE_OF_JS,
  HEADROOM_PERCENT,
  UTILITY_BY_PACKAGE,
  check,
  chunkMeasurements,
  driftWarnings,
  entryShareViolation,
  headroomViolations,
  initialAppChunks,
  inlinePageViolations,
  maxCeiling,
  measure,
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

/** The `<head>` Vite writes today, as `apps/admin/dist/index.html` carries it. */
const VITE_HEAD = [
  '<script type="module" crossorigin src="/assets/index-A1b2.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/vendor/react-C3d4.js">',
  '<link rel="stylesheet" crossorigin href="/assets/index-E5f6.css">',
].join("\n");

const page = ({ head = "", body = "" } = {}) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n${VITE_HEAD}\n${head}</head>\n<body>\n<div id="root"></div>\n${body}</body>\n</html>\n`;

/**
 * A whole app directory `check` can run over: a built page, an entry, a
 * route chunk, a vendor chunk, the CSS the manifest owes, and a budget set
 * against what it measures. `staleJs` sets the `js` baseline 12% under the
 * measurement — past the drift line, inside the headroom rule.
 */
const withApp = async ({ html = page(), staleJs = false } = {}, run) => {
  const appDir = await mkdtemp(path.join(tmpdir(), "size-"));
  const dist = path.join(appDir, "dist");
  // Random hex, so gzip cannot fold the chunks into nothing.
  const noise = (bytes) => randomBytes(bytes).toString("hex");

  try {
    await mkdir(path.join(dist, "assets", "vendor"), { recursive: true });
    await writeFile(path.join(dist, "index.html"), html);
    await writeFile(
      path.join(dist, "assets", "index-A1b2.js"),
      `export const a = "${noise(200)}";\n`,
    );
    await writeFile(
      path.join(dist, "assets", "route-G7h8.js"),
      `export const b = "${noise(2000)}";\n`,
    );
    await writeFile(
      path.join(dist, "assets", "vendor", "react-C3d4.js"),
      `export const c = "${noise(400)}";\n`,
    );
    await writeFile(
      path.join(dist, "assets", "index-E5f6.css"),
      ".gap-5{gap:1.25rem}.max-w-\\[400px\\]{max-width:400px}\n",
    );
    await writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        dependencies: { "@repo/app-kit": "*", "@repo/form": "*" },
      }),
    );

    const { js, css, entry } = measure(dist);
    const react = gzipSync(
      await readFile(path.join(dist, "assets", "vendor", "react-C3d4.js")),
      { level: 9 },
    ).length;

    await writeFile(
      path.join(appDir, "size-budget.json"),
      JSON.stringify({
        baseline: {
          measuredAt: "2026-09-21",
          js: staleJs ? Math.floor(js / 1.12) : js,
          css,
          entry,
          chunks: { react },
        },
        budgets: { js, css, entry },
        chunks: { react },
      }),
    );

    return await run(appDir);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
};

test("a built page with an inline script fails the link", async () => {
  // The page Vite writes today is clean: one module script by `src`, links.
  assert.deepEqual(inlinePageViolations(page()), []);
  // Neither a value that reads like a handler nor a comment is code.
  assert.deepEqual(
    inlinePageViolations(
      page({
        head: '<meta name="description" content="Sign on=now" />\n<!-- <script>old()</script> -->\n',
      }),
    ),
    [],
  );

  // ADR-0074 §6: an inline script, a style element, an event-handler
  // attribute — and a script whose `src` sits beside a body, which the
  // browser ignores and is still inline code somebody wrote.
  const cases = [
    [page({ body: "<script>window.boot = 1;</script>\n" }), /inline <script>/],
    [
      page({ head: '<script type="module">import "/x.js";</script>\n' }),
      /inline <script type="module">/,
    ],
    [page({ head: '<script src="/a.js">boot()</script>\n' }), /inline <script/],
    [page({ head: "<style>body{margin:0}</style>\n" }), /a <style> element/],
    [
      page({ head: '<link rel="stylesheet" href="/a.css" onload="go()">\n' }),
      /`onload` on <link>/,
    ],
    [
      page({ body: '<img src="/x.png" ONERROR="x()">\n' }),
      /`ONERROR` on <img>/,
    ],
    [page({ body: "<img/onerror=x()>\n" }), /`onerror` on <img>/],
  ];

  for (const [html, pattern] of cases) {
    const found = inlinePageViolations(html);
    assert.equal(found.length, 1, html);
    assert.match(found[0], pattern);
  }

  // Through the link itself: the page is refused before any budget rule runs.
  await withApp({ html: page() }, (appDir) =>
    assert.equal(check(appDir).ok, true),
  );
  await withApp(
    { html: page({ body: "<script>window.boot = 1;</script>\n" }) },
    (appDir) =>
      assert.throws(
        () => check(appDir),
        /dist\/index\.html carries an inline <script>[\s\S]*ADR-0074 §6/,
      ),
  );
});

test("a measurement ten percent over its baseline is reported", async () => {
  // CI-12: the headroom rule bounds the ceiling, not the build, so a
  // measurement could climb to its ceiling with nothing said.
  assert.equal(DRIFT_PERCENT, 10);

  const baseline = { js: 1000, css: 100, chunks: { react: 500 } };

  assert.deepEqual(
    driftWarnings(baseline, [
      { key: "js", actual: 1100 }, // exactly ten percent: not reported
      { key: "css", actual: 111 },
      { key: "react", actual: 551, chunk: true },
      { key: "entry", actual: 9999 }, // no baseline: headroom's business
    ]),
    [
      { key: "css", actual: 111, baseline: 100 },
      { key: "chunks.react", actual: 551, baseline: 500 },
    ],
  );

  // Through the link: reported under the table, and the link stays green —
  // the ceiling is the gate, the warning is the note that the baseline aged.
  await withApp({ staleJs: true }, (appDir) => {
    const { lines, ok } = check(appDir);
    assert.equal(ok, true);
    assert.equal(
      lines.filter((line) => line.startsWith("size: warning")).length,
      1,
    );
    assert.match(
      lines.join("\n"),
      /size: warning — js measures [\d.]+ kB, more than 10% over its [\d.]+ kB baseline \(measured 2026-09-21\)/,
    );
  });
  await withApp({}, (appDir) =>
    assert.doesNotMatch(check(appDir).lines.join("\n"), /warning/),
  );
});

test("the entry is the module script and every app chunk the page preloads", async () => {
  // `D21.3`: Rolldown moves what the entry shares with a lazy route into a
  // common chunk the page preloads, so the entry *file* stopped being the
  // app code paid before anything renders. Vendor chunks keep their own rows.
  const html = page({
    head: [
      '<link rel="modulepreload" crossorigin href="/assets/route-G7h8.js">',
      '<link crossorigin href="/assets/route-G7h8.js" rel="modulepreload">',
    ].join("\n"),
  });

  assert.deepEqual(initialAppChunks(html), [
    "assets/index-A1b2.js",
    "assets/route-G7h8.js",
  ]);
  // Either attribute order is read — alone, so the dedupe above cannot hide it.
  assert.deepEqual(
    initialAppChunks(
      page({
        head: '<link crossorigin href="/assets/route-G7h8.js" rel="modulepreload">',
      }),
    ),
    ["assets/index-A1b2.js", "assets/route-G7h8.js"],
  );
  // A preload link the pattern cannot read is refused, never skipped: an
  // unquoted `rel` would otherwise drop its chunk from the row.
  assert.throws(
    () =>
      initialAppChunks(
        page({
          head: '<link rel=modulepreload crossorigin href="/assets/route-G7h8.js">',
        }),
      ),
    /modulepreload links and \d+ this script can read/,
  );
  // Rollup's page: the vendor chunks were the only preloads.
  assert.deepEqual(initialAppChunks(page()), ["assets/index-A1b2.js"]);
  assert.equal(initialAppChunks("<html><head></head></html>"), undefined);

  await withApp({ html }, async (appDir) => {
    const dist = path.join(appDir, "dist");
    const gz = async (file) =>
      gzipSync(await readFile(path.join(dist, "assets", file)), { level: 9 })
        .length;

    assert.equal(
      measure(dist).entry,
      (await gz("index-A1b2.js")) + (await gz("route-G7h8.js")),
    );
  });

  // A preload naming a file the build did not emit is refused, not skipped —
  // by the measurement `withApp` takes to write its budget.
  await assert.rejects(
    withApp(
      {
        html: page({
          head: '<link rel="modulepreload" crossorigin href="/assets/gone-X1.js">\n',
        }),
      },
      () => assert.fail("measured a page that preloads a missing chunk"),
    ),
    /points at assets\/gone-X1\.js, which does not exist/,
  );
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
