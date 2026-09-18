import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The two invariants that keep the shared composition shared (ADR-0062 §1).
 *
 * Both failures this record exists to prevent are **silent**: a stylesheet
 * missing an `@source` still builds, and a file copied back into an app still
 * compiles. Neither lint nor types nor any screen test can see them, and the
 * one that shipped — `apps/customer`'s CSS without `@repo/form`'s utilities —
 * survived a step, a review and a close-out. So they are checked here, in the
 * package that owns what they are about, exactly as ADR-0050 asks: the record
 * says a rule holds and a machine says whether it does.
 *
 * The repo is read from disk because that is what the claims are about. Both
 * comparisons are pure functions taking their input as arguments, so the
 * negative case is a call rather than a temporarily broken tree.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..", "..");

/** Every SPA that composes the kit. A third app adds one entry. */
const APPS = ["admin", "customer"] as const;

/**
 * The platform packages that ship `className` strings and whose sources
 * nothing else registers with Tailwind.
 *
 * `@repo/ui` is deliberately absent: its own `globals.css` carries
 * `@source "../../src"`, so the design system scans itself for every consumer.
 * `api-client`, `app-services`, `resource` and `i18n` hold no class at all.
 */
const RENDERING_PACKAGES = {
  "@repo/app-kit": "app-kit",
  "@repo/form": "form",
  "@repo/grid": "grid",
} as const;

type RenderingPackage = keyof typeof RENDERING_PACKAGES;

/**
 * The two lines an app owes a rendering package it depends on: the directory
 * to scan, and the tests to leave out — a class mentioned only in a test is
 * how the original defect stayed hidden (`D10.4`).
 */
const sourceLinesFor = (pkg: RenderingPackage): readonly string[] => {
  const dir = `../../../../packages/${RENDERING_PACKAGES[pkg]}/src`;

  return [`@source "${dir}";`, `@source not "${dir}/__tests__";`];
};

/**
 * Which `@source` lines an app's stylesheet owes and does not carry.
 *
 * Missing lines only, never the other way round: a `@source` for a package an
 * app has dropped is dead weight rather than a defect, and folding the two
 * together would make one test that fails for two reasons.
 */
export const missingSourceDeclarations = (
  dependencies: readonly string[],
  css: string,
): string[] =>
  (Object.keys(RENDERING_PACKAGES) as RenderingPackage[])
    .filter((pkg) => dependencies.includes(pkg))
    .flatMap((pkg) =>
      sourceLinesFor(pkg).filter((line) => !css.includes(line)),
    );

/**
 * The files `@repo/app-kit` took ownership of at `D14.8`.
 *
 * Paths under an app's `src/`, and the assertion is that **no app has one**:
 * a file that reappeared in one app is a fork of the kit's copy that nothing
 * else would notice, and a file that reappeared in both is the drift this
 * package was created to end.
 */
const EXTRACTED = [
  "app/providers/i18n.tsx",
  "app/providers/query-client.ts",
  "app/providers/ui-strings.tsx",
  "shared/api/query-meta.ts",
  "shared/i18n/create-app-i18n.ts",
  "shared/ui/app-loader.tsx",
  "shared/ui/settings-options.tsx",
  "test/msw/server.ts",
  "test/setup.ts",
  "widgets/auth-layout/index.tsx",
] as const;

const appPackage = (app: string): { dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(REPO, "apps", app, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };

const appStylesheet = (app: string): string =>
  readFileSync(join(REPO, "apps", app, "src", "app", "styles.css"), "utf8");

describe("the extracted composition", () => {
  it("is a set this test can actually see — non-empty, and found where it went", () => {
    // The guard that keeps every assertion below from passing vacuously: an
    // empty list is absent from everywhere and matches nothing.
    expect(EXTRACTED.length).toBeGreaterThan(0);
    expect(APPS.length).toBeGreaterThan(1);
    expect(existsSync(join(HERE, "..", "index.ts"))).toBe(true);
  });

  it.each(APPS)("has no copy left under apps/%s/src (ADR-0062 §1)", (app) => {
    const survivors = EXTRACTED.filter((path) =>
      existsSync(join(REPO, "apps", app, "src", path)),
    );

    expect(
      survivors,
      `these moved into @repo/app-kit and must be reached through apps/${app}'s shared/ doors: ${survivors.join(", ")}`,
    ).toEqual([]);
  });
});

describe("every app's styles.css", () => {
  it.each(APPS)(
    "declares an @source for each rendering package apps/%s depends on (ADR-0062 §1)",
    (app) => {
      const missing = missingSourceDeclarations(
        Object.keys(appPackage(app).dependencies ?? {}),
        appStylesheet(app),
      );

      expect(
        missing,
        `add these to apps/${app}/src/app/styles.css, or Tailwind emits no rule for a class only that package uses:\n${missing.join("\n")}`,
      ).toEqual([]);
    },
  );

  it("reports the pair a dependency has no @source for — the D12.6 defect, as a call", () => {
    // The tree exactly as `apps/customer` shipped it between `D12.6` and this
    // step: `@repo/form` in the dependencies, and a stylesheet with nothing
    // but the design system's import. `gap-5` was in the admin's built CSS and
    // absent from this app's, and nothing in the repository said so.
    expect(
      missingSourceDeclarations(
        ["@repo/form", "@repo/ui"],
        '@import "@repo/ui/globals.css";\n',
      ),
    ).toEqual([
      '@source "../../../../packages/form/src";',
      '@source not "../../../../packages/form/src/__tests__";',
    ]);
  });

  it("asks nothing of a package the app does not depend on", () => {
    // `@repo/grid` is out of `apps/customer` until a domain entity arrives
    // (ADR-0055 §3), and a rule that demanded a scan of a package the app does
    // not have would be a rule nobody could satisfy.
    expect(
      missingSourceDeclarations(
        ["@repo/ui"],
        '@import "@repo/ui/globals.css";\n',
      ),
    ).toEqual([]);
  });
});

/**
 * A rendering package's barrel costs the entry nothing it does not use
 * (`D20.9`, ADR-0073 §5).
 *
 * Each app's composition root imports `@repo/grid` and `@repo/form` through
 * their barrels for a namespace name, a catalogue loader and the zod
 * installer — three exports — and until `D20.9` every module the barrel
 * re-exports travelled with them: without a `sideEffects` declaration Rollup
 * keeps each module's top-level `forwardRef`/`createContext` calls as
 * possible side effects, which put `@dnd-kit` and Radix's select in the
 * admin's entry and react-hook-form in both. The declaration is honest —
 * nothing in either package runs anything on import — and it is what let the
 * two entry ceilings fall. It is asserted here because it is a manifest field
 * nothing else reads, and the failure it prevents is a bigger first paint
 * that `pnpm size` reports as a number without naming the cause.
 *
 * Two of the three rendering packages, and the third is left out on purpose:
 * this package's `testing/setup` entry registers jsdom stubs and MSW hooks
 * *by being imported*, which is a side effect a false declaration would deny.
 * `@repo/ui` lists `**\/*.css` for the same reason — a stylesheet import
 * must not be shaken.
 */
const SHAKEABLE = ["form", "grid"] as const;

const packageManifest = (
  dir: string,
): { sideEffects?: boolean | readonly string[] } =>
  JSON.parse(
    readFileSync(join(REPO, "packages", dir, "package.json"), "utf8"),
  ) as { sideEffects?: boolean | readonly string[] };

describe("the rendering packages the composition roots import by barrel", () => {
  it.each(SHAKEABLE)(
    "declares sideEffects: false in packages/%s (ADR-0073 §5)",
    (dir) => {
      expect(
        packageManifest(dir).sideEffects,
        `packages/${dir}/package.json must declare "sideEffects": false, or a barrel import of one export carries every module in the package into the importer's entry chunk`,
      ).toBe(false);
    },
  );
});
