import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The bundle-size budget for this app (ADR-0052 §The bundle budget, inherited
 * at `D12.1` — ADR-0055 §3 says the mechanism lands with the app rather than
 * being acquired later).
 *
 * `apps/admin/scripts/size.mjs`'s twin: same three measurements, same closed
 * silent-pass paths, and one sentence changed — the file the failure message
 * tells you to edit. It is copied rather than shared because a repo-level
 * script under ADR-0002 §scripts would have to be told which app it is
 * measuring, and the argument-passing is larger than the file.
 *
 * **A number in a committed file, checked by the gate.** The app grew a
 * drag-and-drop dependency at `D10.3` and a stylesheet fix at `D10.4` that let
 * two packages' utilities into the CSS for the first time, and nothing in the
 * repository would have said so — a bundle gets larger one reasonable decision
 * at a time, and the only way to notice is to write the number down and let a
 * machine compare it. Raising a budget is then a reviewed diff of
 * `size-budget.json`, never a silent drift.
 *
 * **Gzipped, because that is what a browser downloads.** Raw bytes are what a
 * build log prints and what a bundler's own limits count, and they overstate
 * the cost of exactly the kind of code this app is mostly made of — long
 * repetitive class strings and JSON catalogues compress to almost nothing.
 *
 * **Three measurements, not one per chunk.** A per-file budget would need
 * editing on every hash change and would say nothing about the total; a single
 * total would let the entry chunk double while lazy routes shrink. So: every
 * JavaScript byte the build emits, every CSS byte, and the **entry chunk**,
 * which is the one every operator pays before anything renders.
 *
 * **Every silent-pass path is closed, because this is a cached gate link.** A
 * check that can quietly measure nothing is worse than no check: it reports
 * "ok" forever and nobody looks again. So the entry is resolved from
 * `dist/index.html` rather than pattern-matched (`D10.5` review — an
 * `index-*.js` glob matched *two* chunks, and would match zero the day Vite's
 * `entryFileNames` changes), and a build that produced no files, or a
 * budgeted total of zero bytes, is an error rather than a pass.
 *
 * Pure and offline — it reads `dist/` and the budget file, opens no socket and
 * asks the environment nothing — so it is cacheable under ADR-0026, and the
 * `size` task declares `build` as its dependency rather than running one.
 *
 * Output goes through `process.stdout` / `process.stderr` rather than
 * `console`, which is the convention `scripts/i18n.mjs` set and which the
 * app's `no-console` rule enforces.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "..", "dist");
const INDEX_HTML = join(DIST, "index.html");
const BUDGET_FILE = join(HERE, "..", "size-budget.json");

/** The module script `dist/index.html` loads — the entry, by definition. */
const ENTRY_SRC = /<script[^>]+type="module"[^>]+src="\/([^"]+\.js)"/;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const walk = (dir) => {
  const entries = [];

  for (const name of readdirSync(dir)) {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      entries.push(...walk(path));
      continue;
    }

    entries.push({ name, path });
  }

  return entries;
};

const gzipBytes = (path) => gzipSync(readFileSync(path), { level: 9 }).length;

/**
 * The entry chunk's path, read from the HTML the browser is served.
 *
 * Anything else is a guess about a bundler's naming, and a guess that stops
 * matching fails *open*: zero bytes measured, every budget satisfied.
 */
const entryPath = () => {
  if (!existsSync(INDEX_HTML)) {
    fail(
      "size: dist/index.html is missing. `size` declares `build` as its dependency, so this means the build did not run or did not finish.",
    );
  }

  const match = ENTRY_SRC.exec(readFileSync(INDEX_HTML, "utf8"));

  if (match === null) {
    fail(
      "size: dist/index.html names no module script, so the entry chunk cannot be identified. If the build's output shape changed, this script has to change with it.",
    );
  }

  const path = join(DIST, match[1]);

  if (!existsSync(path)) {
    fail(`size: dist/index.html points at ${match[1]}, which does not exist.`);
  }

  return path;
};

const measure = () => {
  const entry = entryPath();
  const files = walk(DIST);
  const totals = { js: 0, css: 0, entry: gzipBytes(entry) };

  for (const { name, path } of files) {
    if (name.endsWith(".js")) totals.js += gzipBytes(path);
    else if (name.endsWith(".css")) totals.css += gzipBytes(path);
  }

  return totals;
};

/**
 * The utilities a rendering package puts in this app's CSS — checked in the
 * built output rather than in the stylesheet (`D14.8`, ADR-0062 §1).
 *
 * `packages/app-kit/src/__tests__/composition.test.ts` asserts that
 * `src/app/styles.css` declares an `@source` for every rendering package this
 * app depends on. That is the *intent*; this is the **outcome**, and the two
 * fail for different reasons: a missing `@source` line, and a build that had
 * one and emitted nothing anyway — a renamed package directory, a Tailwind
 * upgrade that resolves `@source` differently, a `dist/` from a stale cache.
 *
 * Each class below is one the package uses and this app's own source does not,
 * so its rule exists only because that package was scanned. This is the check
 * that would have caught `apps/customer` shipping without `@repo/form`'s
 * utilities between `D12.6` and `D14.8`, which nothing else could see.
 */
const REQUIRED_UTILITIES = [
  { className: "gap-5", from: "@repo/form" },
  { className: "max-w-[400px]", from: "@repo/app-kit" },
];

/** `max-w-[400px]` is written `.max-w-\[400px\]` once it is a CSS selector. */
const cssSelector = (className) =>
  `.${className.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`)}`;

const missingUtilities = (css) =>
  REQUIRED_UTILITIES.filter(
    ({ className }) => !css.includes(cssSelector(className)),
  );

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

const main = () => {
  let budget;

  try {
    budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
  } catch {
    fail(
      `size: no budget at ${BUDGET_FILE}. The file is committed on purpose — see ADR-0052 §The bundle budget.`,
    );
  }

  const measured = measure();

  const missing = missingUtilities(
    walk(DIST)
      .filter(({ name }) => name.endsWith(".css"))
      .map(({ path }) => readFileSync(path, "utf8"))
      .join("\n"),
  );

  if (missing.length > 0) {
    fail(
      [
        "",
        ...missing.map(
          ({ className, from }) =>
            `size: the built CSS carries no rule for \`${className}\`, which ${from} uses. That package's @source line in src/app/styles.css is missing or no longer resolves (ADR-0062 §1).`,
        ),
        "",
        "Tailwind emits a utility only for a class it finds in a scanned source, and a missing rule is invisible: the screen renders without the property and nothing errors.",
      ].join("\n"),
    );
  }

  const rows = Object.entries(budget.budgets);
  const breaches = [];
  const lines = ["size (gzipped):"];

  for (const [key, limit] of rows) {
    const actual = measured[key];

    if (actual === undefined) {
      fail(`size: budget names "${key}", which nothing measures.`);
    }

    /*
     * None of the three can legitimately be zero, so zero means the build was
     * empty or partial — a `dist/` that exists and holds nothing would
     * otherwise print "ok" against every budget and pass.
     */
    if (actual === 0) {
      fail(
        `size: measured 0 bytes of ${key}, which no real build produces. The output in dist/ is empty or partial.`,
      );
    }

    const headroom = limit - actual;

    lines.push(
      `  ${key.padEnd(6)} ${kb(actual).padStart(10)} / ${kb(limit).padStart(10)}  ${headroom < 0 ? "OVER" : "ok"}`,
    );

    if (headroom < 0) breaches.push({ key, actual, limit });
  }

  process.stdout.write(`${lines.join("\n")}\n`);

  if (breaches.length > 0) {
    const complaints = breaches.map(
      ({ key, actual, limit }) =>
        `size: ${key} is ${kb(actual)}, over its ${kb(limit)} budget by ${kb(actual - limit)}.`,
    );

    fail(
      [
        "",
        ...complaints,
        "",
        "Either make it smaller, or raise the number in apps/customer/size-budget.json — deliberately, in a diff someone reviews (ADR-0052).",
      ].join("\n"),
    );
  }
};

main();
