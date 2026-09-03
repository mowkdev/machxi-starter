import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The bundle-size budget (ADR-0052 §The bundle budget, `D10.5`).
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
 * **Three totals and a ceiling per vendor chunk.** Three totals alone (`D10.5`)
 * left the *shape* of the bundle unpriced: a dependency can move from a lazy
 * route into the entry and `js` will not blink. A ceiling per *file* is the
 * opposite mistake — it needs editing on every hash change. So `D14.9`
 * (ADR-0062 §4) prices the four things that are stable enough to review: every
 * JavaScript byte, every CSS byte, the **entry chunk** every operator pays
 * before anything renders, and each **vendor chunk** `vite.config.ts` names.
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
/** Where `vite.config.ts` routes the manual vendor chunks (`D14.9`). */
const VENDOR_DIR = join(DIST, "assets", "vendor");
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
  { className: "size-[34px]", from: "@repo/grid" },
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

/**
 * The per-chunk ceilings (ADR-0062 §4, `D14.9`), beside the three totals.
 *
 * The totals cannot see the shape of a bundle. `js` stays flat while the entry
 * doubles and the lazy routes shrink; `entry` stays flat while a dependency
 * quietly moves from one vendor group to another. So each vendor chunk
 * `vite.config.ts` declares gets its own number in the budget file, under the
 * rule ADR-0052 wrote for the totals: a committed byte count, raised only in a
 * diff someone reviewed.
 *
 * **Both directions are closed.** A budgeted chunk that no file matches is an
 * error rather than a pass — that is the silent-pass class this script exists
 * to refuse — and a vendor chunk *nothing* budgets is an error too, so adding
 * a group to `VENDOR_GROUPS` cannot ship unpriced.
 */
const vendorChunkSizes = () => {
  if (!existsSync(VENDOR_DIR)) {
    fail(
      "size: dist/assets/vendor/ is missing. vite.config.ts routes every manual vendor chunk there, so an absent directory means the build emitted none of them.",
    );
  }

  const sizes = new Map();

  for (const name of readdirSync(VENDOR_DIR)) {
    if (name.endsWith(".js"))
      sizes.set(name, gzipBytes(join(VENDOR_DIR, name)));
  }

  return sizes;
};

/**
 * The entry may not be budgeted above 60% of all JavaScript (ADR-0062 §4).
 *
 * A ceiling is only a ceiling if nobody can quietly raise it to the sky. Before
 * `D14.9` the entry was about 76% of `js`; the vendor split is what brought it
 * down, and this is the line that stops a later step handing that back by
 * editing one number.
 */
const ENTRY_SHARE_OF_JS = 0.6;

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

  const chunkBudgets = Object.entries(budget.chunks ?? {});

  if (chunkBudgets.length === 0) {
    fail(
      "size: the budget file names no chunks. Per-chunk ceilings are not optional (ADR-0062 §4) — an empty table prices nothing and passes forever.",
    );
  }

  const measuredChunks = vendorChunkSizes();
  const claimed = new Set();

  for (const [name, limit] of chunkBudgets) {
    const matches = [...measuredChunks.keys()].filter((file) =>
      file.startsWith(`${name}-`),
    );

    if (matches.length !== 1) {
      fail(
        `size: budget names chunk "${name}", which matches ${matches.length} files in dist/assets/vendor/. Either vite.config.ts no longer emits that group, or two chunks share a prefix — and a budget that measures nothing would pass forever.`,
      );
    }

    const file = matches[0];
    const actual = measuredChunks.get(file);
    const headroom = limit - actual;

    claimed.add(file);

    lines.push(
      `  ${name.padEnd(6)} ${kb(actual).padStart(10)} / ${kb(limit).padStart(10)}  ${headroom < 0 ? "OVER" : "ok"}`,
    );

    if (headroom < 0) breaches.push({ key: name, actual, limit });
  }

  for (const file of measuredChunks.keys()) {
    if (!claimed.has(file)) {
      fail(
        `size: dist/assets/vendor/${file} is a vendor chunk nothing budgets. Give it a ceiling in the "chunks" table (ADR-0062 §4) rather than letting it grow unpriced.`,
      );
    }
  }

  /*
   * Both rows have to exist for the rule below to mean anything: with either
   * missing the comparison is against `undefined`, which is `false`, and the
   * cap would report "ok" for a budget file that had deleted it.
   */
  if (
    typeof budget.budgets.entry !== "number" ||
    typeof budget.budgets.js !== "number"
  ) {
    fail(
      'size: the budget file must name both "js" and "entry" totals — ADR-0062 §4 caps one against the other, and a missing row would make that cap silently vacuous.',
    );
  }

  if (budget.budgets.entry > budget.budgets.js * ENTRY_SHARE_OF_JS) {
    fail(
      `size: the entry budget (${kb(budget.budgets.entry)}) is more than ${ENTRY_SHARE_OF_JS * 100}% of the js budget (${kb(budget.budgets.js)}). ADR-0062 §4 caps it there: the vendor split is what made the entry small, and a ceiling raised past this line gives that back without anyone having to say so.`,
    );
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
        "Either make it smaller, or raise the number in apps/admin/size-budget.json — deliberately, in a diff someone reviews (ADR-0052).",
      ].join("\n"),
    );
  }
};

main();
