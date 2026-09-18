import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

/**
 * The stylesheet, compiled the way an app's build compiles it (ADR-0047).
 *
 * Every other suite in this package renders a component and asks jsdom about
 * roles and names; jsdom loads no stylesheet and computes no style, so a rule
 * that lives only in `globals.css` is invisible to all of them. This one runs
 * the file through Tailwind's own compiler and reads the emitted CSS, which is
 * the first place a rule can be *absent* for a reason that is not a typo — an
 * `@utility` nothing references is dropped, a rule inside an `@theme` block
 * is not a rule, and an `@import` that fails resolves to nothing at all.
 *
 * No candidates are handed to `build`, so no utility is generated: what comes
 * out is preflight, the theme, and the rules this file writes by hand — which
 * is exactly the surface these cases are about.
 */

// `fileURLToPath` on the string, not on a `URL`: under jsdom the global `URL`
// is jsdom's, and Node refuses it as "not of scheme file".
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const stylesheet = path.join(packageRoot, "src", "styles", "globals.css");

interface StylesheetPackage {
  readonly exports?: Readonly<Record<string, { readonly style?: string }>>;
  readonly style?: string;
  readonly main?: string;
}

/**
 * Resolves an `@import` the way the Vite plugin does, in miniature: a relative
 * id against the importing file's directory, a bare id through this package's
 * own `node_modules` to the `style` entry its manifest exports. Both
 * stylesheets this file imports are this package's dependencies (ADR-0047
 * says why they are `dependencies` and not the app's), so the lookup is one
 * directory and needs no resolver.
 */
async function loadStylesheet(
  id: string,
  base: string,
): Promise<{ path: string; base: string; content: string }> {
  let file: string;

  if (id.startsWith(".") || path.isAbsolute(id)) {
    file = path.resolve(base, id);
  } else {
    const dir = path.join(packageRoot, "node_modules", id);
    const manifest = JSON.parse(
      await readFile(path.join(dir, "package.json"), "utf8"),
    ) as StylesheetPackage;
    const entry =
      manifest.exports?.["."]?.style ?? manifest.style ?? manifest.main;

    if (entry === undefined) throw new Error(`${id} exports no stylesheet`);

    file = path.join(dir, entry);
  }

  return {
    path: file,
    base: path.dirname(file),
    content: await readFile(file, "utf8"),
  };
}

async function emitted(): Promise<string> {
  const compiler = await compile(await readFile(stylesheet, "utf8"), {
    base: path.dirname(stylesheet),
    from: stylesheet,
    loadStylesheet,
  });

  return compiler.build([]);
}

/** The body of the first `@media` block whose query is `query`. */
function mediaBlock(css: string, query: string): string {
  const open = css.indexOf(`@media ${query} {`);

  expect(open, `no \`@media ${query}\` in the emitted CSS`).not.toBe(-1);

  // Tailwind prints a block's closing brace at the indentation it opened at,
  // so the media block — which opens at column 0 — closes at the first `}`
  // that starts a line.
  const close = css.indexOf("\n}", open);

  expect(close).not.toBe(-1);

  return css.slice(open, close);
}

describe("globals.css, compiled", () => {
  it("emits the reduced-motion rule with the durations collapsed", async () => {
    // The 2026-09-13 review's FE-06 (ADR-0073 §9's companion): a person who
    // has asked their operating system for less motion gets none of
    // `tw-animate-css`'s, from every surface, out of this one rule. Not `0`:
    // Radix unmounts a closing overlay on `animationend`, and the event has
    // to fire.
    const block = mediaBlock(
      await emitted(),
      "(prefers-reduced-motion: reduce)",
    );

    expect(block).toMatch(/animation-duration:\s*0?\.01ms\s*!important/);
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0?\.01ms\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it("keeps the rule outside every cascade layer, so it wins", async () => {
    // A layered rule loses to any unlayered one regardless of specificity or
    // `!important`'s ordinary meaning being inverted inside layers; the
    // preference has to beat the `utilities` layer, so the rule must not be
    // inside a layer. Tailwind prints a layered block indented under its
    // `@layer`, and this one opens at column 0.
    const css = await emitted();

    expect(css).toMatch(/^@media \(prefers-reduced-motion: reduce\) \{/m);
  });
});
