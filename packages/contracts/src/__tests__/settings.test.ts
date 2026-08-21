import { describe, expect, it } from "vitest";

import {
  LOCALES,
  MAX_COLUMN_WIDTH,
  MAX_GRID_COLUMNS,
  MAX_SETTINGS_GRIDS,
  MIN_COLUMN_WIDTH,
  THEMES,
  gridPreferencesSchema,
  updateStaffSettingsBody,
  updateUserSettingsBody,
  type GridPreferencesV1,
} from "../index.js";

const arrangement = {
  v: 1,
  sizing: { email: 240 },
  order: ["email", "status"],
  hidden: ["createdAt"],
};

describe("the settings enums", () => {
  it("declares the three themes and the one locale D7 will append to", () => {
    expect(THEMES).toEqual(["light", "dark", "system"]);
    expect(LOCALES).toEqual(["en"]);
  });
});

describe("gridPreferencesSchema", () => {
  it("parses an arrangement into the resource's own type", () => {
    const result = gridPreferencesSchema.safeParse(arrangement);

    expect(result.success).toBe(true);
    // The hand-written resource type and the schema's output agree; a drift
    // between the two is a compile error rather than a runtime surprise.
    expect(result.data satisfies GridPreferencesV1 | undefined).toEqual(
      arrangement,
    );
  });

  it("refuses a version it does not know", () => {
    expect(
      gridPreferencesSchema.safeParse({ ...arrangement, v: 2 }).success,
    ).toBe(false);
  });

  it("clamps widths on the way in as the store clamps them on the way out", () => {
    // A stored `1` is a column an operator can see and cannot grab; a stored
    // `1e12` is one column that is the whole table (ADR-0041, amended D4.5).
    for (const width of [MIN_COLUMN_WIDTH - 1, MAX_COLUMN_WIDTH + 1, 240.5]) {
      expect(
        gridPreferencesSchema.safeParse({
          ...arrangement,
          sizing: { email: width },
        }).success,
      ).toBe(false);
    }

    for (const width of [MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]) {
      expect(
        gridPreferencesSchema.safeParse({
          ...arrangement,
          sizing: { email: width },
        }).success,
      ).toBe(true);
    }
  });

  it("bounds column ids and the length of both arrays", () => {
    expect(
      gridPreferencesSchema.safeParse({
        ...arrangement,
        sizing: { ["a".repeat(65)]: 240 },
      }).success,
    ).toBe(false);
    expect(
      gridPreferencesSchema.safeParse({ ...arrangement, order: [""] }).success,
    ).toBe(false);
    expect(
      gridPreferencesSchema.safeParse({
        ...arrangement,
        order: Array.from(
          { length: MAX_GRID_COLUMNS + 1 },
          (_, i) => `c${String(i)}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("strips an unknown key rather than discarding the whole entry", () => {
    // The move is intact: the store has always stripped, so an entry a newer
    // client wrote a field into still restores the three slices v1 knows.
    const result = gridPreferencesSchema.safeParse({
      ...arrangement,
      pinned: ["email"],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(arrangement);
  });
});

describe("the update body", () => {
  it("is the same schema on both segments, today", () => {
    // Identical by construction (ADR-0045 §Contracts); the pair is the split
    // point, not a pair of independently maintained shapes.
    expect(updateUserSettingsBody).toBe(updateStaffSettingsBody);
  });

  it("takes every key on its own, and none of them", () => {
    expect(updateStaffSettingsBody.safeParse({ theme: "dark" }).success).toBe(
      true,
    );
    expect(updateStaffSettingsBody.safeParse({ locale: "en" }).success).toBe(
      true,
    );
    // A coalescing writer flushing with nothing to say is a no-op, not an error.
    expect(updateStaffSettingsBody.safeParse({}).success).toBe(true);
  });

  it("is strict, so a misspelled key is refused rather than dropped", () => {
    expect(updateStaffSettingsBody.safeParse({ them: "dark" }).success).toBe(
      false,
    );
  });

  it("refuses a theme or a locale outside the tuples", () => {
    expect(updateStaffSettingsBody.safeParse({ theme: "sepia" }).success).toBe(
      false,
    );
    expect(updateStaffSettingsBody.safeParse({ locale: "lv" }).success).toBe(
      false,
    );
  });

  it("takes null per grid key, which is how an entry is deleted", () => {
    const result = updateStaffSettingsBody.safeParse({
      grids: { staff: arrangement, users: null },
    });

    expect(result.success).toBe(true);
    expect(result.data?.grids).toEqual({ staff: arrangement, users: null });
  });

  it("refuses a grid entry that fails the arrangement schema", () => {
    expect(
      updateStaffSettingsBody.safeParse({
        grids: { staff: { ...arrangement, sizing: { email: 1 } } },
      }).success,
    ).toBe(false);
  });

  it("drops a __proto__ grid key rather than carrying it into the merge", () => {
    // Not a bound this schema declares — a property of `z.record` this one
    // relies on, pinned because the service's per-key merge depends on it.
    // `JSON.parse('{"__proto__": ...}')` produces an **own** property, so the
    // key survives transport as an ordinary string; a merge that deletes on
    // `null` has to assign per key rather than spread, and
    // `merged["__proto__"] = entry` would set the merged object's prototype
    // instead of adding an entry to it. Zod never hands the key over: it
    // parses, and the entry is simply absent from the result.
    const parsed = JSON.parse(
      String.raw`{"grids": {"__proto__": {"v": 1, "sizing": {}, "order": [], "hidden": []}}}`,
    ) as unknown;
    const result = updateStaffSettingsBody.safeParse(parsed);

    expect(result.success).toBe(true);
    expect(Object.keys(result.data?.grids ?? {})).toEqual([]);
    expect(Object.getPrototypeOf(result.data?.grids ?? {})).toBe(
      Object.prototype,
    );
  });

  it("bounds the grid id and the number of grids one body may carry", () => {
    expect(
      updateStaffSettingsBody.safeParse({
        grids: { ["g".repeat(65)]: arrangement },
      }).success,
    ).toBe(false);

    const grids = Object.fromEntries(
      Array.from({ length: MAX_SETTINGS_GRIDS + 1 }, (_, i) => [
        `g${String(i)}`,
        arrangement,
      ]),
    );

    expect(updateStaffSettingsBody.safeParse({ grids }).success).toBe(false);
    // The bound that matters is on the merged row, and only the service can
    // check it: forty existing keys plus twenty new ones is a valid body.
    delete grids[`g${String(MAX_SETTINGS_GRIDS)}`];
    expect(updateStaffSettingsBody.safeParse({ grids }).success).toBe(true);
  });
});
