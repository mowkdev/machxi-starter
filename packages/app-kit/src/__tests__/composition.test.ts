import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * `@repo/account` joined at `D22.2` (ADR-0077 §2): its forms spell the auth
 * card's 38px rung themselves.
 */
const RENDERING_PACKAGES = {
  "@repo/account": "account",
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
 * The files `@repo/app-kit` took ownership of at `D14.8`, and the two
 * `D20.10` added.
 *
 * Paths under an app's `src/`, and the assertion is that **no app has one**:
 * a file that reappeared in one app is a fork of the kit's copy that nothing
 * else would notice, and a file that reappeared in both is the drift this
 * package was created to end.
 *
 * The two MSW handler helpers are the list's first *proof* rather than its
 * first guard: they were already the drift, copied from `apps/admin` into
 * `apps/customer` at `D15.5` with a comment in each copy saying so, and the
 * only reason nothing caught it is that neither path was in this list.
 */
const EXTRACTED = [
  "app/providers/i18n.tsx",
  "app/providers/query-client.ts",
  "app/providers/ui-strings.tsx",
  "shared/api/query-meta.ts",
  // `D22.1` (ADR-0077 §1): the context's shape moved with the reporter's
  // factory. `index.ts` and `reporter.ts` stay — the binding and the one file
  // a fork replaces.
  "shared/error-reporting/context.ts",
  "shared/i18n/create-app-i18n.ts",
  "shared/ui/app-loader.tsx",
  "shared/ui/settings-options.tsx",
  "test/msw/handlers/envelope.ts",
  "test/msw/handlers/list-query.ts",
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
 * A package's barrel costs the entry nothing it does not use (`D20.9`,
 * ADR-0073 §5; widened at `D28.9`, ADR-0074 §7, `FE-13`).
 *
 * Each app's composition root imports the platform packages through their
 * barrels for a handful of names, and without a `sideEffects` declaration
 * Rollup keeps every re-exported module's top-level calls as possible side
 * effects: until `D20.9` that put `@dnd-kit` and Radix's select in the
 * admin's entry and react-hook-form in both. It is asserted here because it
 * is a manifest field nothing else reads, and the failure it prevents is a
 * bigger first paint that `pnpm size` reports as a number without naming the
 * cause.
 *
 * The declaration must be honest, so it is not always `false`:
 *
 * - `@repo/contracts` names the one module that runs on import —
 *   `locales/source.ts` installs the keyed custom-message map with
 *   `z.config`, deliberately, so the API needs no localisation code. A
 *   `false` would license a bundler to drop that install.
 * - This package names the one module that acts on import (`D22.4`,
 *   ADR-0077 §1 as amended): its `testing/setup` entry registers jsdom stubs
 *   and MSW hooks *by being imported*, which a false declaration would deny.
 *   Nothing its `.` barrel re-exports runs on import. Until `D22.4` the kit
 *   was left out of this map for that entry, which was a hole in the guard
 *   exactly where both roots import most.
 * - `@repo/ui` lists `**\/*.css` for the same reason — a stylesheet import
 *   must not be shaken — and is priced by its own subpath exports rather than
 *   a barrel.
 */
const SHAKEABLE = {
  // `D22.2` (ADR-0077 §2): both roots reach it through `entities/settings`,
  // for the settings gate, and through `shared/i18n` for its catalogue.
  account: false,
  "api-client": false,
  // `D22.4` (ADR-0077 §1 as amended): the barrel both roots import most.
  "app-kit": ["./src/testing/setup.ts"],
  "app-services": false,
  contracts: ["./src/locales/source.ts"],
  form: false,
  grid: false,
  i18n: false,
  resource: false,
} as const satisfies Record<string, false | readonly string[]>;

const packageManifest = (
  dir: string,
): { sideEffects?: boolean | readonly string[] } =>
  JSON.parse(
    readFileSync(join(REPO, "packages", dir, "package.json"), "utf8"),
  ) as { sideEffects?: boolean | readonly string[] };

/**
 * The barrel imports a source file makes of a workspace package: a bare
 * `@repo/<name>`, with no subpath.
 *
 * A subpath import (`@repo/ui/components/button`) names one module and is
 * priced by that module, so it is not a barrel and not this check's subject.
 * A type-only import is erased before a bundler sees it. A regex rather than a
 * parse, and the imprecision runs one way on purpose: a specifier inside a
 * comment counts, so the worst this can do is ask for a declaration that was
 * not strictly needed.
 */
export const barrelImports = (source: string): string[] => [
  ...new Set(
    [
      ...source.matchAll(
        /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["'](@repo\/[a-z0-9-]+)["']/g,
      ),
      ...source.matchAll(/(?:^|\n)\s*import\s+["'](@repo\/[a-z0-9-]+)["']/g),
      ...source.matchAll(/import\(\s*["'](@repo\/[a-z0-9-]+)["']\s*\)/g),
    ].map((match) => match[1] ?? ""),
  ),
];

/**
 * The barrels a set of sources import that {@link SHAKEABLE} does not name.
 *
 * No package is exempt (`D22.4`): the kit's own barrel, which both roots
 * import most, is held to the map like every other, and the kit's sources are
 * read as part of every root, so what the kit imports by barrel is held to the
 * same rule as what an app does.
 */
export const unnamedBarrels = (
  sources: readonly string[],
  shakeable: readonly string[],
): string[] =>
  [...new Set(sources.flatMap(barrelImports))]
    .filter(
      (specifier) => !shakeable.includes(specifier.slice("@repo/".length)),
    )
    .sort();

/** Every `.ts`/`.tsx` under `dir` that ships: no tests, no harness. */
const shippedSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory())
      return entry.name === "__tests__" || entry.name === "testing"
        ? []
        : shippedSources(path);

    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

/** The file an app-local specifier names, or `undefined` for anything else. */
const resolveLocal = (
  app: string,
  from: string,
  specifier: string,
): string | undefined => {
  const base = specifier.startsWith("@/")
    ? join(REPO, "apps", app, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : undefined;

  if (base === undefined) return undefined;

  return [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ].find((candidate) => existsSync(candidate));
};

/** The file the router's split begins at: past it, a route is its own chunk. */
const ROUTE_TREE = "routeTree.gen.ts";

/**
 * What a composition root is made of: `app/index.tsx`, every app file it
 * reaches — its providers, the slices they bind and the doors under those —
 * and the kit's own shipped sources, where the root's join has lived since
 * `D22.1`.
 *
 * **Followed until the route tree and no further** (`D22.2`). Until this step
 * the walk stopped one hop from the root, which was every barrel the root
 * could then reach; `@repo/account` arrives three hops away — the root
 * imports its settings provider, which imports `entities/settings`, which is
 * the package's door — so a one-hop walk would have held over a root whose
 * newest barrel nothing had declared. The walk stops at the generated route
 * tree because that is where the entry stops: `autoCodeSplitting` gives each
 * route's component its own chunk, which is `grid-chunk.test.ts`'s subject.
 */
const appRootFiles = (app: string): string[] => {
  const root = join(REPO, "apps", app, "src", "app", "index.tsx");
  const seen = new Set<string>([root]);
  const queue = [root];

  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const text = readFileSync(file, "utf8");

    for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const reached = resolveLocal(app, file, match[1] ?? "");

      if (
        reached === undefined ||
        seen.has(reached) ||
        reached.endsWith(ROUTE_TREE)
      ) {
        continue;
      }

      seen.add(reached);
      queue.push(reached);
    }
  }

  return [...seen];
};

const appRootSources = (app: string): string[] =>
  appRootFiles(app).map((path) => readFileSync(path, "utf8"));

const compositionRootSources = (app: string): string[] => [
  ...appRootSources(app),
  ...shippedSources(join(HERE, "..")).map((path) => readFileSync(path, "utf8")),
];

describe("the packages the composition roots import by barrel", () => {
  it("are the nine this test names", () => {
    expect(Object.keys(SHAKEABLE)).toHaveLength(9);
  });

  it("follows a root past its first hop, to the account's door", () => {
    // The guard on the walk itself: `@repo/account` is three hops from each
    // root, so a walk that stopped short would never read the file that
    // imports it and the case below would hold for nothing.
    for (const app of APPS) {
      const door = join("entities", "settings", "index.ts");

      expect(
        appRootFiles(app).some((path) => path.endsWith(door)),
        `apps/${app}'s root no longer reaches ${door}`,
      ).toBe(true);
      expect(appRootSources(app).flatMap(barrelImports)).toContain(
        "@repo/account",
      );
      expect(appRootFiles(app).some((path) => path.endsWith(ROUTE_TREE))).toBe(
        false,
      );
    }
  });

  it("reads a root that is really there", () => {
    // The guard against a vacuous pass: a root that resolved to nothing
    // imports no barrel at all.
    for (const app of APPS) {
      // The app's own half alone: the kit's sources are always there, so
      // counting them would let this hold over a root that resolved nothing.
      const sources = appRootSources(app);

      expect(sources.length).toBeGreaterThan(5);
      expect(sources.flatMap(barrelImports)).toContain("@repo/app-kit");
    }
  });

  it("a composition root imports only shakeable barrels", () => {
    for (const app of APPS) {
      const unnamed = unnamedBarrels(
        compositionRootSources(app),
        Object.keys(SHAKEABLE),
      );

      expect(
        unnamed,
        `apps/${app}'s composition root imports these by barrel and SHAKEABLE does not name them, so nothing checks that they declare their side effects and every module they re-export may land in the entry: ${unnamed.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("reports the barrel a root imports and the map does not name", () => {
    // A root that reached past its doors for a package nobody declared, as a
    // call rather than as a temporarily broken tree.
    expect(
      unnamedBarrels(
        [
          'import { AppRoot } from "@repo/app-kit";\nimport { useT } from "@repo/i18n";\nimport { widget } from "@repo/unnamed";\n',
        ],
        Object.keys(SHAKEABLE),
      ),
    ).toEqual(["@repo/unnamed"]);
  });

  it("asks nothing about a subpath or a type", () => {
    expect(
      unnamedBarrels(
        [
          'import { Button } from "@repo/ui/components/button";\nimport type { Thing } from "@repo/unnamed";\n',
        ],
        Object.keys(SHAKEABLE),
      ),
    ).toEqual([]);
  });

  it.each(Object.entries(SHAKEABLE))(
    "declares its side effects honestly in packages/%s (ADR-0073 §5, ADR-0074 §7)",
    (dir, declared) => {
      expect(
        packageManifest(dir).sideEffects,
        `packages/${dir}/package.json must declare "sideEffects" — false, or the modules that run on import — or a barrel import of one export carries every module in the package into the importer's entry chunk`,
      ).toEqual(declared);
    },
  );
});
