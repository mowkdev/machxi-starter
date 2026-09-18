import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The grid's table is requested only on a list route (`D20.9`, ADR-0073 §5).
 *
 * In the built app that claim is about a chunk: `autoCodeSplitting` gives
 * every route's `component` its own file, so `@repo/grid`'s `AppGrid` lands
 * in `app-grid-<hash>.js`, imported by the three list routes' chunks and by
 * nothing the entry loads. A jsdom suite has no chunks — under Vitest the
 * route files import their pages statically and everything is one module
 * graph — so this asserts the **structural fact the split rests on**: the
 * door onto the table, `shared/grid/app-grid`, is imported by list pages and
 * by nothing else. A provider, a widget or an entity that reached for it
 * would put the table above the route split, which is the one way the entry
 * can grow the grid back; `pnpm size`'s entry ceiling would then trip on the
 * next build, and this names the file first.
 *
 * Read from disk rather than mocked, in the shape of `@repo/app-kit`'s
 * composition test: the claim is about the tree, and a module mock could only
 * prove what the test had itself arranged.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The one specifier that renders the table (ADR-0051's door rule). */
const GRID_DOOR = "@/shared/grid/app-grid";

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

const importsGridDoor = (file: string): boolean =>
  new RegExp(`from\\s+["']${GRID_DOOR}["']`).test(readFileSync(file, "utf8"));

/** `pages/staff/index.tsx` → `pages/staff`; anything else → its own path. */
const sliceOf = (file: string): string => {
  const rel = relative(SRC, file).split(sep).join("/");
  const match = /^pages\/([^/]+)\//.exec(rel);

  return match ? `pages/${match[1]}` : rel;
};

describe("the grid's table", () => {
  const importers = sourceFiles(SRC).filter(importsGridDoor).map(sliceOf);

  it("is imported by the list pages — the set is real, not empty", () => {
    // The guard against a vacuous pass: a renamed door would make the list
    // below empty and every other assertion here true for nothing.
    expect(importers).toEqual(
      expect.arrayContaining([
        "pages/staff",
        "pages/users",
        "pages/organizations",
      ]),
    );
  });

  it("is imported by nothing outside a list page, so its chunk loads only on a list route", () => {
    const aboveTheSplit = importers.filter(
      (slice) => !slice.startsWith("pages/"),
    );

    expect(
      aboveTheSplit,
      `these reach ${GRID_DOOR} from above the route split, which puts the table in the entry chunk: ${aboveTheSplit.join(", ")}`,
    ).toEqual([]);
  });
});
