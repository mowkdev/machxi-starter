import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import lv from "../locales/lv.json";

/**
 * The package's two catalogues name the same keys (`D22.2`, ADR-0046 §9).
 *
 * Each app's `i18n:check` measures that app's own `locales/` and cannot see
 * a package's, so the drift it exists to catch — a key `en` has and `lv` does
 * not, which renders English in the middle of a Latvian screen — is asked
 * here, of the two files this package ships.
 */
const leaves = (value: unknown, prefix: readonly string[] = []): string[] =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, child]) =>
        leaves(child, [...prefix, key]),
      )
    : [prefix.join(".")];

describe("the account package's catalogues", () => {
  it("name the same keys in every locale", () => {
    expect(leaves(en).length).toBeGreaterThan(0);
    expect(leaves(lv).sort()).toEqual(leaves(en).sort());
  });

  it("leave no sentence empty", () => {
    for (const catalogue of [en, lv]) {
      const empty = leaves(catalogue).filter((path) => {
        const found = path
          .split(".")
          .reduce<unknown>(
            (node, segment) => (node as Record<string, unknown>)[segment],
            catalogue,
          );

        return typeof found !== "string" || found.trim() === "";
      });

      expect(empty).toEqual([]);
    }
  });
});
