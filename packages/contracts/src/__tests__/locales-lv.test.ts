import { describe, expect, it } from "vitest";
import { z } from "zod";

import lv from "../locales/lv.js";

/**
 * The Latvian error map, one case per issue code it translates (ADR-0046 §14).
 *
 * The map is driven **directly** rather than through `z.config`, and that is
 * the point of testing it here: `z.config` is global, so a suite that installed
 * a locale would decide what every other file in the process reads back. A
 * locale map is a pure function of an issue, and a pure function is tested by
 * calling it.
 *
 * The counted nouns are asserted per plural category rather than once, because
 * Latvian's three categories are the reason this deliverable named Latvian as
 * its second locale — `1 rakstzīme`, `2 rakstzīmes`, `11 rakstzīmju`.
 */

const { localeError } = lv();

/** The map's own parameter type, so a hand-built issue is checked against it. */
type RawIssue = Parameters<NonNullable<typeof localeError>>[0];

const message = (issue: Record<string, unknown>): string => {
  const produced = localeError?.({ input: undefined, ...issue } as RawIssue);

  return typeof produced === "string" ? produced : (produced?.message ?? "");
};

describe("the Latvian zod locale", () => {
  it("names both types of an invalid_type", () => {
    expect(
      message({ code: "invalid_type", expected: "string", input: 42 }),
    ).toBe("Nederīga ievade: gaidīts teksts, saņemts skaitlis");
  });

  it("falls back to zod's own word for a type it does not name", () => {
    expect(
      message({ code: "invalid_type", expected: "promise", input: 42 }),
    ).toBe("Nederīga ievade: gaidīts promise, saņemts skaitlis");
  });

  it("distinguishes one expected value from a choice of several", () => {
    expect(message({ code: "invalid_value", values: ["active"] })).toBe(
      'Nederīga ievade: gaidīts "active"',
    );
    expect(
      message({ code: "invalid_value", values: ["active", "disabled"] }),
    ).toBe('Nederīga izvēle: gaidīta viena no "active"|"disabled"');
  });

  it("measures a too_big string in characters and a number in itself", () => {
    expect(
      message({
        code: "too_big",
        origin: "string",
        maximum: 100,
        inclusive: true,
      }),
    ).toBe("Pārāk liels: tekstam jāsatur <=100 rakstzīmju");
    expect(
      message({
        code: "too_big",
        origin: "number",
        maximum: 10,
        inclusive: false,
      }),
    ).toBe("Pārāk liels: skaitlim jābūt <10");
  });

  it("measures a too_small string in characters and a number in itself", () => {
    expect(
      message({
        code: "too_small",
        origin: "string",
        minimum: 12,
        inclusive: true,
      }),
    ).toBe("Pārāk mazs: tekstam jāsatur >=12 rakstzīmju");
    expect(
      message({
        code: "too_small",
        origin: "number",
        minimum: 1,
        inclusive: true,
      }),
    ).toBe("Pārāk mazs: skaitlim jābūt >=1");
  });

  /**
   * The reason `lv` is the second locale rather than a Romance language: the
   * teens are `zero`, an ending `1` that is not `11` is `one`, and everything
   * else is `other`. A map that got this wrong would read fluently and be
   * wrong exactly where a bound happens to land.
   */
  it.each([
    [0, "rakstzīmju"],
    [1, "rakstzīme"],
    [2, "rakstzīmes"],
    [11, "rakstzīmju"],
    [19, "rakstzīmju"],
    [20, "rakstzīmju"],
    [21, "rakstzīme"],
    [24, "rakstzīmes"],
    [100, "rakstzīmju"],
    [101, "rakstzīme"],
  ])("declines the unit for %i", (minimum, unit) => {
    expect(
      message({
        code: "too_small",
        origin: "string",
        minimum,
        inclusive: true,
      }),
    ).toBe(`Pārāk mazs: tekstam jāsatur >=${String(minimum)} ${unit}`);
  });

  it.each([
    ["array", 1, "vienums"],
    ["array", 3, "vienumi"],
    ["array", 11, "vienumu"],
    ["map", 1, "ieraksts"],
    ["map", 2, "ieraksti"],
    ["map", 11, "ierakstu"],
    ["file", 21, "baits"],
    ["set", 5, "vienumi"],
  ])("declines %s at %i", (origin, minimum, unit) => {
    expect(
      message({ code: "too_small", origin, minimum, inclusive: true }),
    ).toContain(` ${unit}`);
  });

  it("names a string format", () => {
    expect(message({ code: "invalid_format", format: "email" })).toBe(
      "Nederīga e-pasta adrese",
    );
    expect(message({ code: "invalid_format", format: "uuid" })).toBe(
      "Nederīga UUID",
    );
    expect(message({ code: "invalid_format", format: "nonesuch" })).toBe(
      "Nederīga nonesuch",
    );
  });

  it("spells out the four shaped string formats", () => {
    expect(
      message({ code: "invalid_format", format: "starts_with", prefix: "AB" }),
    ).toBe('Nederīgs teksts: jāsākas ar "AB"');
    expect(
      message({ code: "invalid_format", format: "ends_with", suffix: "Z" }),
    ).toBe('Nederīgs teksts: jābeidzas ar "Z"');
    expect(
      message({ code: "invalid_format", format: "includes", includes: "x" }),
    ).toBe('Nederīgs teksts: jāsatur "x"');
    expect(
      message({ code: "invalid_format", format: "regex", pattern: "/a/" }),
    ).toBe("Nederīgs teksts: jāatbilst šablonam /a/");
  });

  it("translates the remaining codes", () => {
    expect(message({ code: "not_multiple_of", divisor: 3 })).toBe(
      "Nederīgs skaitlis: jādalās ar 3",
    );
    expect(message({ code: "unrecognized_keys", keys: ["nope"] })).toBe(
      'Neatpazīta atslēga: "nope"',
    );
    expect(message({ code: "unrecognized_keys", keys: ["a", "b"] })).toBe(
      'Neatpazītas atslēgas: "a", "b"',
    );
    expect(message({ code: "invalid_key", origin: "map" })).toBe(
      "Nederīga atslēga: karte",
    );
    expect(message({ code: "invalid_element", origin: "set" })).toBe(
      "Nederīga vērtība: kopa",
    );
    expect(message({ code: "invalid_union", errors: [] })).toBe(
      "Nederīga ievade",
    );
  });

  it("answers a code it has never heard of rather than throwing", () => {
    expect(message({ code: "from_the_future" })).toBe("Nederīga ievade");
  });

  /**
   * The one case that goes through zod itself: installing the map on a parse
   * proves the export is shaped the way `z.config` expects, which no amount of
   * calling `localeError` by hand can show.
   */
  it("is installable as a locale", () => {
    const parsed = z
      .string()
      .min(12)
      .safeParse("short", { error: lv().localeError });

    expect(parsed.error?.issues[0]?.message).toBe(
      "Pārāk mazs: tekstam jāsatur >=12 rakstzīmju",
    );
  });
});
