import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * This app's bundle holds no grid (`D22.2`, ADR-0077 §2; ADR-0055 §3).
 *
 * The admin's `grid-chunk.test.ts` asserts that the table loads only on a list
 * route. This is its twin, and the claim here is the stronger one: **there is
 * no table at all.** ADR-0055 §3 keeps `@repo/grid` out of this app until a
 * domain entity arrives, and until `D22.2` that was true by construction —
 * every file this app ran was its own. It now runs `@repo/account`, which the
 * admin hands a grid preference adapter, so the account package is the first
 * way a grid could arrive here without this app importing one.
 *
 * A jsdom suite has no bundle, so this asserts the **structural facts the
 * bundle follows from**, read from disk in the shape of `@repo/app-kit`'s
 * composition test: what is not in a dependency graph cannot be in a chunk.
 * `pnpm size` weighs the outcome — this app's budget has no `table` chunk to
 * weigh.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(SRC, "..", "..", "..");
const ACCOUNT = join(REPO, "packages", "account");

/** What the account package may never reach (ADR-0077 §2). */
const FORBIDDEN = ["@repo/grid", "@repo/app-kit"] as const;

/** The grid's engine, which only `@repo/grid` draws with. */
const TABLE_ENGINE = "@tanstack/react-table";

type Manifest = Readonly<
  Partial<
    Record<
      "dependencies" | "devDependencies" | "peerDependencies",
      Readonly<Record<string, string>>
    >
  >
>;

const manifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;

const declared = (dir: string): string[] => {
  const { dependencies, devDependencies, peerDependencies } = manifest(dir);

  return Object.keys({
    ...dependencies,
    ...devDependencies,
    ...peerDependencies,
  });
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }

    return /\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)
      ? [path]
      : [];
  });

/** The files under `dir` that import `specifier`, or a subpath of it. */
const importersOf = (dir: string, specifier: string): string[] => {
  const pattern = new RegExp(
    `(?:from|import)\\s*\\(?\\s*["']${specifier}(?:/[^"']*)?["']`,
  );

  return sourceFiles(dir)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(REPO, file).split(sep).join("/"));
};

describe("the account package brings no grid", () => {
  it("reads a package and an app that are really there", () => {
    // The guard against a vacuous pass: a moved directory would make every
    // list below empty and every assertion here true for nothing.
    expect(sourceFiles(join(ACCOUNT, "src")).length).toBeGreaterThan(5);
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
    expect(declared(join(SRC, ".."))).toContain("@repo/account");
    expect(importersOf(SRC, "@repo/account").length).toBeGreaterThan(0);
  });

  it("declares neither the grid nor the kit, in any dependency field", () => {
    expect(
      declared(ACCOUNT).filter((name) =>
        (FORBIDDEN as readonly string[]).includes(name),
      ),
    ).toEqual([]);
    expect(declared(ACCOUNT)).not.toContain(TABLE_ENGINE);
  });

  it("reaches no grid through the workspace packages it depends on", () => {
    // One level down (the D22.2 review): the account package's own manifest
    // is clean, but a grid declared by `@repo/form` or `@repo/ui` would still
    // reach this bundle through it.
    const { dependencies } = manifest(ACCOUNT);
    const workspace = Object.keys(dependencies ?? {}).filter((name) =>
      name.startsWith("@repo/"),
    );

    expect(workspace.length).toBeGreaterThan(3);

    for (const name of workspace) {
      const dir = join(REPO, "packages", name.slice("@repo/".length));
      const reached = declared(dir).filter(
        (dep) => dep === "@repo/grid" || dep === TABLE_ENGINE,
      );

      expect(reached, `${name} declares ${reached.join(", ")}`).toEqual([]);
    }
  });

  it.each(FORBIDDEN)("imports nothing from %s in what it ships", (name) => {
    const importers = importersOf(join(ACCOUNT, "src"), name);

    expect(
      importers,
      `@repo/account depends downward only, and on ${name} never (ADR-0077 §2): ${importers.join(", ")}`,
    ).toEqual([]);
  });

  it("leaves this app with no grid of its own either", () => {
    expect(declared(join(SRC, ".."))).not.toContain("@repo/grid");
    expect(declared(join(SRC, ".."))).not.toContain(TABLE_ENGINE);
    expect(importersOf(SRC, "@repo/grid")).toEqual([]);
  });

  it("reports the import it exists to refuse", () => {
    // The negative case, as a call rather than as a temporarily broken tree:
    // the pattern the three cases above rest on matches what it should.
    const pattern = (specifier: string, source: string): boolean =>
      new RegExp(
        `(?:from|import)\\s*\\(?\\s*["']${specifier}(?:/[^"']*)?["']`,
      ).test(source);

    expect(pattern("@repo/grid", 'import { AppGrid } from "@repo/grid";')).toBe(
      true,
    );
    expect(pattern("@repo/grid", 'await import("@repo/grid/x")')).toBe(true);
    expect(pattern("@repo/grid", 'import { x } from "@repo/gridlock";')).toBe(
      false,
    );
  });
});
