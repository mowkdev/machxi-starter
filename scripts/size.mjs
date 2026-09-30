#!/usr/bin/env node
// The bundle-size budget (ADR-0052 §The bundle budget, ADR-0062 §4,
// ADR-0073 §5), one script for every SPA.
//
// Usage, from an app directory — which is where Turbo runs the `size` task:
//   node ../../scripts/size.mjs
//
// It reads the app it is standing in: `dist/` for the build, `size-budget.json`
// for the numbers, `package.json` for which rendering packages the app
// composes. Nothing else is passed and nothing else is read.
//
// **A number in a committed file, checked by the gate.** An app grows a
// dependency here and a stylesheet fix there, and nothing in the repository
// would say so — a bundle gets larger one reasonable decision at a time, and
// the only way to notice is to write the number down and let a machine
// compare it. Raising a budget is a reviewed diff of `size-budget.json`, never
// a silent drift (ADR-0052).
//
// **Gzipped, because that is what a browser downloads.** Raw bytes overstate
// the cost of exactly the kind of code these apps are mostly made of — long
// repetitive class strings and JSON catalogues compress to almost nothing.
//
// **Three totals and a ceiling per vendor chunk** (ADR-0062 §4). Totals alone
// leave the *shape* of the bundle unpriced: a dependency can move from a lazy
// route into the entry and `js` will not blink. So the file prices every
// JavaScript byte, every CSS byte, the **entry** — the app code every visitor pays
// before anything renders, and each **vendor chunk** `vite.config.ts` names.
//
// **Every ceiling is at most 15% over its baseline** (ADR-0073 §5). Before
// this rule a ceiling was a number somebody chose, and the review found both
// files 2–5% above measurement with nothing bounding a raise — the ratchet
// could be loosened by editing one number. Now a raise past the bound is
// refused until the baseline beside it is re-measured, so a raise is always a
// diff that shows both numbers.
//
// **A measurement drifting away from its baseline is reported** (`D28.7`,
// `CI-12`). The headroom rule bounds the ceiling, not the build: a
// measurement may climb to its ceiling one step at a time with nothing said
// until the day it trips — the 2026-09-11 re-baseline. So a row measuring more
// than {@link DRIFT_PERCENT}% over its baseline prints a warning under the
// table. It never fails the link: the ceiling is the gate, and the warning is
// the note that the baseline has gone stale and the next raise will be larger
// than it looks.
//
// **The built page carries nothing the policy would refuse** (ADR-0074 §6,
// `D28.7`, `SEC-10`). The Content-Security-Policy lives in each image's
// `nginx.conf`, and the browser tier runs against dev servers that send none,
// so a plugin that starts emitting an inline bootstrap would break the app in
// production and nowhere else. This link already reads `dist/index.html` to
// find the entry; it also refuses an inline `<script>`, any `<style>` element
// and any `on*=` attribute there. It is stricter than the policy on styles
// on purpose — `'unsafe-inline'` is Tailwind's runtime price, and the built
// page does not spend it. Since `D31.3` (ADR-0080 §5) the page's root must
// also open with the static boot indicator, and no element may carry a
// `style` attribute, so the wait before the script runs is painted from the
// stylesheet and never from the page.
//
// **Every silent-pass path is closed, because this is a cached gate link.** A
// check that can quietly measure nothing reports "ok" forever. So the entry is
// resolved from `dist/index.html` rather than pattern-matched (an `index-*.js`
// glob once matched two chunks and would match zero the day `entryFileNames`
// changes); a build that produced no files, a budgeted total of zero bytes, a
// budgeted chunk no file matches, and a vendor chunk nothing budgets are each
// an error rather than a pass.
//
// **One script, addressed by its working directory.** It was a copy per app
// until `D20.9`, on the argument that a root script "would have to be told
// which app it is measuring". Turbo already tells it — a package task runs in
// the package directory — and the one line that differed between the copies
// (which utilities the built CSS must carry) is a fact about the app's
// dependencies, so it is read from `package.json` rather than written twice.
// What the move buys is a rule that can be tested: `size.test.mjs` imports the
// pure functions below, which two copies executing `main()` on import never
// allowed.
//
// Pure and offline — it reads the tree and asks the environment nothing — so
// the `size` task is cacheable under ADR-0026 and declares `build` as its
// dependency rather than running one. Output goes through `process.stdout` /
// `process.stderr` rather than `console`, the convention the app scripts set.
// ADR-0002 §scripts: nothing here is covered by `lint` or `check-types`; the
// rules that bind this file are kept by hand.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** ADR-0073 §5: a ceiling may sit at most this many percent over its baseline. */
export const HEADROOM_PERCENT = 15;

/**
 * The highest ceiling a baseline allows, in whole bytes.
 *
 * Integer arithmetic on purpose: `100000 * 1.15` is `114999.999…` in a
 * double, and a rule that refused a ceiling one byte under its own line
 * would be wrong in the direction nobody would notice.
 */
export const maxCeiling = (baseline) =>
  baseline + Math.floor((baseline * HEADROOM_PERCENT) / 100);

/**
 * A measurement more than this many percent over its baseline is reported
 * (`D28.7`, `CI-12`) — below the 15% a ceiling may sit at, so the warning
 * arrives while there is still room under the ceiling.
 */
export const DRIFT_PERCENT = 10;

/**
 * The rows measuring more than {@link DRIFT_PERCENT}% over their baseline.
 *
 * `rows` are the `{ key, actual }` pairs `check` measures — the totals by
 * name, the chunks by their budget name — and each is compared with
 * `baseline[key]` or `baseline.chunks[key]`. Integer arithmetic, for the
 * reason {@link maxCeiling} gives. A row with no numeric baseline is not
 * reported here: {@link headroomViolations} already refuses it.
 */
export const driftWarnings = (baseline, rows) =>
  rows.flatMap(({ key, actual, chunk }) => {
    const base = chunk ? baseline?.chunks?.[key] : baseline?.[key];

    if (typeof base !== "number" || !(base > 0)) return [];

    return actual * 100 > base * (100 + DRIFT_PERCENT)
      ? [{ key: chunk ? `chunks.${key}` : key, actual, baseline: base }]
      : [];
  });

/**
 * What a built `index.html` may not carry (ADR-0074 §6): an inline script, a
 * style element, an event-handler attribute. Returns one sentence per
 * offence; an empty array is a page the policy's `script-src 'self'` serves
 * whole.
 *
 * A `<script>` is inline when it has no `src` or has a body — a body beside a
 * `src` is ignored by the browser and is still somebody's inline code. Tags
 * are read as `<name …>` spans, which is enough for the page a bundler
 * writes; this is not a general HTML parser and does not need to be. Comments
 * are dropped first, and a tag's quoted values are blanked before a handler
 * is looked for, so neither a commented-out tag nor `content="Sign on=now"`
 * is read as code; `/` separates attributes as whitespace does
 * (`<img/onerror=…>`), so it may precede a handler name too (`D28.7`'s
 * review).
 */
export const inlinePageViolations = (source) => {
  const found = [];
  const html = source.replace(/<!--[\s\S]*?-->/g, "");

  for (const [, attrs, body] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (!/\ssrc\s*=/i.test(` ${attrs}`) || body.trim() !== "") {
      found.push(
        `an inline <script${attrs}> — the policy's script-src 'self' refuses it`,
      );
    }
  }

  for (const [tag] of html.matchAll(/<style\b[^>]*>/gi)) {
    found.push(
      `a ${tag} element — the built page spends none of the policy's 'unsafe-inline'`,
    );
  }

  for (const [tag, name] of html.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    const handler = /[\s/](on[a-z]+)\s*=/i.exec(
      tag.replace(/"[^"]*"|'[^']*'/g, '""'),
    );

    if (handler !== null) {
      found.push(
        `an event-handler attribute \`${handler[1]}\` on <${name}> — inline code the policy refuses`,
      );
    }
  }

  return found;
};

/**
 * What a built page's root must carry, and what the page may not (`D31.3`,
 * ADR-0080 §5): the static boot indicator, and no inline `style` attribute.
 * Returns one sentence per offence; an empty array is a page that shows a
 * wait before its script runs and spends none of the policy's
 * `'unsafe-inline'` doing it.
 *
 * The indicator is the element the root opens with, marked
 * `data-boot-indicator`, so a root emptied by an `index.html` edit or a
 * plugin fails here rather than quietly reverting to a blank page. It is
 * styled from the app's stylesheet, and a `style=` attribute anywhere on the
 * page is refused beside it: {@link inlinePageViolations} refuses style
 * *elements*, and an attribute is the other road inline paint takes. Comments
 * are dropped and quoted values blanked first, for the reasons given there.
 */
export const bootIndicatorViolations = (source) => {
  const found = [];
  const html = source.replace(/<!--[\s\S]*?-->/g, "");
  const root =
    /<div\b(?=[^>]*\sid\s*=\s*["']?root["'\s/>])[^>]*>\s*(<[a-z][\w-]*\b[^>]*>)?/i.exec(
      html,
    );

  if (root === null) {
    found.push('no `<div id="root">` for the app to render into');
  } else if (
    root[1] === undefined ||
    !/[\s/]data-boot-indicator\b/i.test(
      root[1].replace(/"[^"]*"|'[^']*'/g, '""'),
    )
  ) {
    found.push(
      "a root that does not open with the boot indicator (an element marked `data-boot-indicator`) — the page is blank until the script runs",
    );
  }

  for (const [tag, name] of html.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    if (/[\s/]style\s*=/i.test(tag.replace(/"[^"]*"|'[^']*'/g, '""'))) {
      found.push(
        `an inline \`style\` attribute on <${name}> — the built page is styled from its stylesheet`,
      );
    }
  }

  return found;
};

/**
 * The entry may not be budgeted above 60% of all JavaScript (ADR-0062 §4).
 *
 * A ceiling is only a ceiling if nobody can quietly raise it to the sky.
 * Before `D14.9` the entry was about 76% of `js`; the vendor split is what
 * brought it down, and this is the line that stops a later step handing that
 * back by editing one number.
 */
export const ENTRY_SHARE_OF_JS = 0.6;

/**
 * The utilities a rendering package puts in an app's CSS — checked in the
 * built output rather than in the stylesheet (`D14.8`, ADR-0062 §1).
 *
 * `packages/app-kit/src/__tests__/composition.test.ts` asserts that each
 * app's `styles.css` declares an `@source` for every rendering package it
 * depends on. That is the *intent*; this is the **outcome**, and the two fail
 * for different reasons: a missing `@source` line, and a build that had one
 * and emitted nothing anyway — a renamed package directory, a Tailwind upgrade
 * that resolves `@source` differently, a `dist/` from a stale cache.
 *
 * Each class is one the package uses and no app's own source does, so its
 * rule exists only because that package was scanned. This is the check that
 * would have caught `apps/customer` shipping without `@repo/form`'s utilities
 * between `D12.6` and `D14.8`, which nothing else could see. Which entries
 * apply is read from the app's dependencies — the customer draws no grid.
 */
export const UTILITY_BY_PACKAGE = Object.freeze({
  "@repo/form": "gap-5",
  "@repo/grid": "size-[34px]",
  "@repo/app-kit": "max-w-[400px]",
});

/** The module script `dist/index.html` loads — the entry, by definition. */
const ENTRY_SRC = /<script[^>]+type="module"[^>]+src="\/([^"]+\.js)"/;

/** Every chunk `dist/index.html` preloads beside the entry, by `href`. */
const MODULEPRELOAD_HREF =
  /<link\b(?=[^>]*\brel="modulepreload")[^>]*\bhref="\/([^"]+\.js)"/g;

/** Every `<link>` that says `modulepreload` at all, however it is written. */
const PRELOAD_LINK = /<link\b[^>]*\bmodulepreload\b[^>]*>/g;

/**
 * The files the `entry` row prices, from the page the browser is served: the
 * module script, and every chunk the page preloads beside it that is not a
 * vendor chunk. Returns `undefined` when the page names no module script, and
 * refuses a page with a preload link it cannot read.
 *
 * **The entry is the app's own code paid before anything renders**, and the
 * vendor chunks are priced by their own ceilings (ADR-0062 §4). Under Rollup
 * that was one file: every module the entry reached statically went into the
 * entry chunk, and the page preloaded only the vendor chunks. Rolldown
 * (Vite 8, `D21.3`) splits the same graph differently — a module the entry
 * shares with a lazy route goes to a common chunk the page preloads — so the
 * entry *file* fell from 156 kB to 38 kB while nothing moved behind the
 * first paint. Measuring the one file would have passed every later growth
 * of that code, which is the silent pass this script exists to refuse. The
 * preload list is the bundler's own statement of what the entry needs, so
 * the row stays true whichever way a bundler cuts it.
 */
export const initialAppChunks = (source) => {
  const entry = ENTRY_SRC.exec(source);

  if (entry === null) return undefined;

  const matched = [...source.matchAll(MODULEPRELOAD_HREF)];

  // A preload link the pattern cannot read (an unquoted `rel`, a relative
  // `href`) would drop its chunk from the row and pass every ceiling — so
  // the page's preload links are counted, and a shortfall is refused.
  const links = source.match(PRELOAD_LINK)?.length ?? 0;

  if (links !== matched.length) {
    refuse(
      `dist/index.html has ${links} modulepreload links and ${matched.length} this script can read, so the entry cannot be priced. If the page's markup changed, this script has to change with it.`,
    );
  }

  const preloaded = matched
    .map((match) => match[1])
    .filter((href) => !href.startsWith("assets/vendor/"));

  return [...new Set([entry[1], ...preloaded])];
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

/** `max-w-[400px]` is written `.max-w-\[400px\]` once it is a CSS selector. */
const cssSelector = (className) =>
  `.${className.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`)}`;

/**
 * The `{ className, from }` rows an app with these dependencies owes.
 *
 * **An empty list is refused rather than returned** (`D20.9`'s review). The
 * two copies this script replaces hard-coded their rows; deriving them from
 * the manifest is what let one script serve both apps, and it opens a way for
 * the check to measure nothing: move `@repo/grid` from `dependencies` to
 * `devDependencies` and a workspace package still resolves, Vite still
 * bundles it, the build still succeeds — and the `size-[34px]` outcome check
 * quietly stops existing. Every SPA here composes at least `@repo/app-kit`,
 * so no rows means either a dependency left `dependencies` or a rendering
 * package was added to the apps and not to {@link UTILITY_BY_PACKAGE}.
 */
export const requiredUtilities = (dependencies) => {
  const rows = Object.entries(UTILITY_BY_PACKAGE)
    .filter(([pkg]) => Object.hasOwn(dependencies ?? {}, pkg))
    .map(([from, className]) => ({ className, from }));

  if (rows.length === 0) {
    refuse(
      `package.json names none of the rendering packages (${Object.keys(UTILITY_BY_PACKAGE).join(", ")}) among its dependencies, so the built-CSS check would look for nothing and report ok. Either one of them left \`dependencies\`, or a package the apps now render from needs an entry in UTILITY_BY_PACKAGE.`,
    );
  }

  return rows;
};

export const missingUtilities = (css, required) =>
  required.filter(({ className }) => !css.includes(cssSelector(className)));

/**
 * The headroom rule, as a pure function of the budget file (ADR-0073 §5).
 *
 * Every row in `budgets` and `chunks` needs a baseline beside it — a ceiling
 * with no measurement under it cannot be bounded, so a missing or non-numeric
 * baseline is a violation rather than a pass — and the ceiling may exceed
 * that baseline by at most {@link HEADROOM_PERCENT}. Returns one row per violation;
 * an empty array is the rule satisfied.
 */
export const headroomViolations = (budget) => {
  const rows = [
    ...Object.entries(budget.budgets ?? {}).map(([key, ceiling]) => ({
      key,
      ceiling,
      baseline: budget.baseline?.[key],
    })),
    ...Object.entries(budget.chunks ?? {}).map(([name, ceiling]) => ({
      key: `chunks.${name}`,
      ceiling,
      baseline: budget.baseline?.chunks?.[name],
    })),
  ];

  return rows.flatMap(({ key, ceiling, baseline }) => {
    if (typeof baseline !== "number" || !(baseline > 0)) {
      return [{ key, ceiling, baseline, max: undefined }];
    }

    const max = maxCeiling(baseline);

    return ceiling > max ? [{ key, ceiling, baseline, max }] : [];
  });
};

/**
 * The 60% cap (ADR-0062 §4) as a sentence, or `null` when it holds.
 *
 * Both rows have to exist for the rule to mean anything: with either missing
 * the comparison is against `undefined`, which is `false`, and the cap would
 * report "ok" for a budget file that had deleted it.
 */
export const entryShareViolation = (budgets) => {
  if (typeof budgets?.entry !== "number" || typeof budgets?.js !== "number") {
    return 'the budget file must name both "js" and "entry" totals — ADR-0062 §4 caps one against the other, and a missing row would make that cap silently vacuous.';
  }

  if (budgets.entry > budgets.js * ENTRY_SHARE_OF_JS) {
    return `the entry budget (${kb(budgets.entry)}) is more than ${ENTRY_SHARE_OF_JS * 100}% of the js budget (${kb(budgets.js)}). ADR-0062 §4 caps it there: the vendor split is what made the entry small, and a ceiling raised past this line gives that back without anyone having to say so.`;
  }

  return null;
};

class SizeError extends Error {}

const refuse = (message) => {
  throw new SizeError(message);
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
 * The entry's files, read from the HTML the browser is served
 * ({@link initialAppChunks}).
 *
 * Anything else is a guess about a bundler's naming, and a guess that stops
 * matching fails *open*: zero bytes measured, every budget satisfied.
 */
const entryPaths = (dist) => {
  const indexHtml = join(dist, "index.html");

  if (!existsSync(indexHtml)) {
    refuse(
      "dist/index.html is missing. `size` declares `build` as its dependency, so this means the build did not run or did not finish.",
    );
  }

  const files = initialAppChunks(readFileSync(indexHtml, "utf8"));

  if (files === undefined) {
    refuse(
      "dist/index.html names no module script, so the entry chunk cannot be identified. If the build's output shape changed, this script has to change with it.",
    );
  }

  return files.map((file) => {
    const path = join(dist, file);

    if (!existsSync(path)) {
      refuse(`dist/index.html points at ${file}, which does not exist.`);
    }

    return path;
  });
};

/** The three totals, gzipped, over everything the build emitted. */
export const measure = (dist) => {
  const entry = entryPaths(dist).reduce(
    (sum, path) => sum + gzipBytes(path),
    0,
  );
  const totals = { js: 0, css: 0, entry };

  for (const { name, path } of walk(dist)) {
    if (name.endsWith(".js")) totals.js += gzipBytes(path);
    else if (name.endsWith(".css")) totals.css += gzipBytes(path);
  }

  return totals;
};

/**
 * The per-chunk measurements (ADR-0062 §4), keyed by file name.
 *
 * `vite.config.ts` routes every manual vendor chunk to `dist/assets/vendor/`,
 * which is a boundary a glob cannot get wrong — a hashed name is
 * `<name>-<hash>.js` and Vite's hash alphabet includes `-`, so `query-*.js`
 * over `assets/` would match the vendor chunk *and* an app's own
 * `query-error-<hash>.js`.
 */
const vendorChunkSizes = (dist) => {
  const vendorDir = join(dist, "assets", "vendor");

  if (!existsSync(vendorDir)) {
    refuse(
      "dist/assets/vendor/ is missing. vite.config.ts routes every manual vendor chunk there, so an absent directory means the build emitted none of them.",
    );
  }

  const sizes = new Map();

  for (const name of readdirSync(vendorDir)) {
    if (name.endsWith(".js")) sizes.set(name, gzipBytes(join(vendorDir, name)));
  }

  return sizes;
};

/**
 * Matches each budgeted chunk name to exactly one file, in both directions:
 * a budgeted chunk that no file matches is an error rather than a pass, and a
 * vendor chunk *nothing* budgets is an error too, so adding a group to
 * `VENDOR_GROUPS` cannot ship unpriced.
 */
export const chunkMeasurements = (chunkBudgets, measuredChunks) => {
  const rows = [];
  const claimed = new Set();

  for (const [name, limit] of Object.entries(chunkBudgets)) {
    const matches = [...measuredChunks.keys()].filter((file) =>
      file.startsWith(`${name}-`),
    );

    if (matches.length !== 1) {
      refuse(
        `budget names chunk "${name}", which matches ${matches.length} files in dist/assets/vendor/. Either vite.config.ts no longer emits that group, or two chunks share a prefix — and a budget that measures nothing would pass forever.`,
      );
    }

    const [file] = matches;

    claimed.add(file);
    rows.push({ key: name, actual: measuredChunks.get(file), limit });
  }

  for (const file of measuredChunks.keys()) {
    if (!claimed.has(file)) {
      refuse(
        `dist/assets/vendor/${file} is a vendor chunk nothing budgets. Give it a ceiling in the "chunks" table (ADR-0062 §4) rather than letting it grow unpriced.`,
      );
    }
  }

  return rows;
};

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return refuse(`no ${what} at ${path}.`);
  }
};

/** Runs every check over the app in `appDir`; returns the report lines. */
export const check = (appDir) => {
  const dist = join(appDir, "dist");
  const budgetFile = join(appDir, "size-budget.json");
  const budget = readJson(
    budgetFile,
    "budget — the file is committed on purpose, see ADR-0052 §The bundle budget",
  );
  const manifest = readJson(join(appDir, "package.json"), "package.json");

  /*
   * The build is measured first, and only then read for utilities (`D20.9`'s
   * review). `walk(dist)` on a directory that is not there throws a bare
   * `ENOENT` straight past the handler at the foot of this file — a stack
   * trace in place of the one sentence a reader needs, which is that `build`
   * did not run or did not finish. `measure` resolves the entry through
   * `entryPaths`, which says exactly that.
   */
  const measured = measure(dist);

  // `measure` has proved `index.html` exists; what it carries is the policy's
  // business before it is the budget's (ADR-0074 §6).
  const builtPage = readFileSync(join(dist, "index.html"), "utf8");
  const inline = inlinePageViolations(builtPage);

  if (inline.length > 0) {
    refuse(
      [
        ...inline.map((sentence) => `dist/index.html carries ${sentence}.`),
        "The Content-Security-Policy in nginx.conf serves scripts from 'self' only, and nothing but the production image sends it — so this page would break there and nowhere else (ADR-0074 §6). Find the plugin or the index.html edit that emitted it and move the code into a module.",
      ].join("\n"),
    );
  }

  const boot = bootIndicatorViolations(builtPage);

  if (boot.length > 0) {
    refuse(
      [
        ...boot.map((sentence) => `dist/index.html carries ${sentence}.`),
        "ADR-0080 §5: index.html's root opens with a static indicator styled from the app's stylesheet, which the first render replaces. Restore the markup in index.html, and move any inline paint into src/app/styles.css.",
      ].join("\n"),
    );
  }

  const missing = missingUtilities(
    walk(dist)
      .filter(({ name }) => name.endsWith(".css"))
      .map(({ path }) => readFileSync(path, "utf8"))
      .join("\n"),
    requiredUtilities(manifest.dependencies),
  );

  if (missing.length > 0) {
    refuse(
      [
        ...missing.map(
          ({ className, from }) =>
            `the built CSS carries no rule for \`${className}\`, which ${from} uses. That package's @source line in src/app/styles.css is missing or no longer resolves (ADR-0062 §1).`,
        ),
        "Tailwind emits a utility only for a class it finds in a scanned source, and a missing rule is invisible: the screen renders without the property and nothing errors.",
      ].join("\n"),
    );
  }

  const rows = [];

  for (const [key, limit] of Object.entries(budget.budgets ?? {})) {
    const actual = measured[key];

    if (actual === undefined) {
      refuse(`budget names "${key}", which nothing measures.`);
    }

    /*
     * None of the three can legitimately be zero, so zero means the build was
     * empty or partial — a `dist/` that exists and holds nothing would
     * otherwise print "ok" against every budget and pass.
     */
    if (actual === 0) {
      refuse(
        `measured 0 bytes of ${key}, which no real build produces. The output in dist/ is empty or partial.`,
      );
    }

    rows.push({ key, actual, limit });
  }

  const chunkBudgets = budget.chunks ?? {};

  if (Object.keys(chunkBudgets).length === 0) {
    refuse(
      "the budget file names no chunks. Per-chunk ceilings are not optional (ADR-0062 §4) — an empty table prices nothing and passes forever.",
    );
  }

  rows.push(
    ...chunkMeasurements(chunkBudgets, vendorChunkSizes(dist)).map((row) => ({
      ...row,
      chunk: true,
    })),
  );

  const share = entryShareViolation(budget.budgets);

  if (share !== null) refuse(share);

  const headroom = headroomViolations(budget);

  if (headroom.length > 0) {
    refuse(
      [
        ...headroom.map(({ key, ceiling, baseline, max }) =>
          max === undefined
            ? `"${key}" has a ceiling (${kb(ceiling)}) and no baseline. Every ceiling needs the measurement it was set against (ADR-0073 §5); add \`baseline.${key}\` from a build of this tree.`
            : `"${key}" is budgeted at ${kb(ceiling)} against a baseline of ${kb(baseline)} — more than ${HEADROOM_PERCENT}% over it (the most a ceiling may sit above its baseline is ${kb(max)}, ADR-0073 §5).`,
        ),
        "A ceiling this far from its measurement is not a ceiling. Re-measure the baseline in the same diff — `baseline.measuredAt` says when — and set the ceiling against what the build actually produces.",
      ].join("\n"),
    );
  }

  const lines = ["size (gzipped):"];
  const breaches = [];

  for (const { key, actual, limit } of rows) {
    const over = actual > limit;

    lines.push(
      `  ${key.padEnd(6)} ${kb(actual).padStart(10)} / ${kb(limit).padStart(10)}  ${over ? "OVER" : "ok"}`,
    );

    if (over) breaches.push({ key, actual, limit });
  }

  if (breaches.length > 0) {
    lines.push(
      "",
      ...breaches.map(
        ({ key, actual, limit }) =>
          `size: ${key} is ${kb(actual)}, over its ${kb(limit)} budget by ${kb(actual - limit)}.`,
      ),
      "",
      "Either make it smaller, or raise the number in size-budget.json — deliberately, in a diff someone reviews (ADR-0052), re-measuring the baseline beside it (ADR-0073 §5).",
    );
  }

  const drift = driftWarnings(budget.baseline, rows);

  if (drift.length > 0) {
    lines.push(
      "",
      ...drift.map(
        ({ key, actual, baseline }) =>
          `size: warning — ${key} measures ${kb(actual)}, more than ${DRIFT_PERCENT}% over its ${kb(baseline)} baseline (measured ${budget.baseline?.measuredAt ?? "on an unrecorded date"}).`,
      ),
      "The baseline has gone stale. Nothing fails for it; re-measure it in the next diff that touches size-budget.json, so the next raise shows what it really moves.",
    );
  }

  return { lines, ok: breaches.length === 0 };
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { lines, ok } = check(process.cwd());

    (ok ? process.stdout : process.stderr).write(`${lines.join("\n")}\n`);

    if (!ok) process.exit(1);
  } catch (error) {
    if (!(error instanceof SizeError)) throw error;

    process.stderr.write(`size: ${error.message}\n`);
    process.exit(1);
  }
}
