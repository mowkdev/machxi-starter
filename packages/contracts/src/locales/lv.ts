import { z } from "zod";

/**
 * zod's error map in Latvian (ADR-0046 §6, `D7.5`).
 *
 * zod 4 ships fifty locales and **no Latvian**, so this one is ours. It mirrors
 * the shape of zod's own locale modules exactly — a default-exported factory
 * returning `{ localeError }`, a `Sizable` table, a `FormatDictionary`, one
 * `switch` over `issue.code` — so that the day upstream adds `lv`, replacing
 * this file is a one-line import change and not a redesign.
 *
 * **It depends on `zod` alone**, which is what
 * [ADR-0023](../../../docs/adr/0023-shared-contracts-package.md) permits word
 * for word: this package may hold zod-only code, and a locale map is zod-only
 * code. What it does *not* hold is a translation of any sentence this package
 * writes — those are keyed (`./source.ts`) and catalogued by the app, so
 * `@repo/contracts` still ships copy in the source language and only in the
 * source language.
 *
 * **Reached through the `@repo/contracts/locales/lv` subpath**, never through
 * the root export: a client that never switches to Latvian never bundles it,
 * and the package's root export stays what it always was.
 *
 * **Machine-drafted, `pending native review`** (ADR-0046 §11) — the same honest
 * status the `lv` catalogues carry. The grammar below was written to be right
 * rather than to be finished: Latvian's three plural categories are resolved
 * for every counted noun, because a category is grammar and not style.
 */

/**
 * Latvian's three plural categories, as CLDR defines them.
 *
 * - `zero` — a multiple of ten, and the teens: `0 rakstzīmju`, `11 rakstzīmju`
 * - `one` — ends in 1, except 11: `1 rakstzīme`, `21 rakstzīme`
 * - `other` — everything else: `2 rakstzīmes`, `24 rakstzīmes`
 *
 * The teens are tested **before** the ones digit, which is the whole of what
 * makes `11` differ from `21`. Written out rather than delegated to
 * `Intl.PluralRules` because a locale map must stay a pure function of the
 * issue: this package runs in Node, in a browser and in a test runner, and an
 * `Intl` lookup per issue would be all three paying for a table of three.
 */
type UnitCategory = "zero" | "one" | "other";

const unitCategory = (value: number): UnitCategory => {
  const abs = Math.abs(value);
  const ones = abs % 10;
  const teens = abs % 100;

  if (ones === 0 || (teens >= 11 && teens <= 19)) return "zero";
  if (ones === 1) return "one";

  return "other";
};

const error: () => z.core.$ZodErrorMap = () => {
  /**
   * What a bounded thing is measured in, declined for each category.
   *
   * The unit is the half English gets wrong for free — `characters` however
   * many there are — and the half this locale exists to get right.
   */
  const Sizable: Record<string, Record<UnitCategory, string>> = {
    string: { zero: "rakstzīmju", one: "rakstzīme", other: "rakstzīmes" },
    file: { zero: "baitu", one: "baits", other: "baiti" },
    array: { zero: "vienumu", one: "vienums", other: "vienumi" },
    set: { zero: "vienumu", one: "vienums", other: "vienumi" },
    map: { zero: "ierakstu", one: "ieraksts", other: "ieraksti" },
  };

  const sizing = (origin: string, bound: number | bigint): string | null =>
    Sizable[origin]?.[unitCategory(Number(bound))] ?? null;

  /** The string formats, named the way a Latvian reader would name them. */
  const FormatDictionary: Record<string, string> = {
    regex: "ievade",
    email: "e-pasta adrese",
    url: "URL adrese",
    emoji: "emocijzīme",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datums un laiks",
    date: "ISO datums",
    time: "ISO laiks",
    duration: "ISO ilgums",
    ipv4: "IPv4 adrese",
    ipv6: "IPv6 adrese",
    mac: "MAC adrese",
    cidrv4: "IPv4 diapazons",
    cidrv6: "IPv6 diapazons",
    base64: "base64 virkne",
    base64url: "base64url virkne",
    json_string: "JSON virkne",
    e164: "E.164 numurs",
    jwt: "JWT",
    template_literal: "ievade",
  };

  /**
   * Type names. A missing entry falls back to zod's own raw word, which is the
   * same rule zod's `en` map follows — an untranslated type name reads as a
   * technical token, which is what it is.
   */
  const TypeDictionary: Record<string, string> = {
    string: "teksts",
    number: "skaitlis",
    bigint: "veselais skaitlis",
    boolean: "loģiskā vērtība",
    date: "datums",
    array: "saraksts",
    object: "objekts",
    set: "kopa",
    map: "karte",
    file: "fails",
    null: "null",
    undefined: "undefined",
    nan: "NaN",
  };

  const typeName = (value: string): string => TypeDictionary[value] ?? value;

  /**
   * The same nouns in the dative, because "too small" is said about a subject
   * in Latvian: *tekstam jāsatur*, not *teksts jāsatur*. A noun with no entry
   * falls back to the nominative, which reads as a foreign word in a sentence
   * — and a foreign word is what an untranslated origin is.
   */
  const DativeDictionary: Record<string, string> = {
    string: "tekstam",
    number: "skaitlim",
    bigint: "veselajam skaitlim",
    boolean: "loģiskajai vērtībai",
    date: "datumam",
    array: "sarakstam",
    object: "objektam",
    set: "kopai",
    map: "kartei",
    file: "failam",
  };

  const subject = (value: string): string =>
    DativeDictionary[value] ?? typeName(value);

  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        const expected = typeName(issue.expected);
        const received = typeName(z.core.util.parsedType(issue.input));

        return `Nederīga ievade: gaidīts ${expected}, saņemts ${received}`;
      }

      case "invalid_value": {
        if (issue.values.length === 1) {
          return `Nederīga ievade: gaidīts ${z.core.util.stringifyPrimitive(issue.values[0])}`;
        }

        return `Nederīga izvēle: gaidīta viena no ${z.core.util.joinValues(issue.values, "|")}`;
      }

      case "too_big": {
        const adj = issue.inclusive ? "<=" : "<";
        const unit = sizing(issue.origin, issue.maximum);
        const bound = issue.maximum.toString();

        if (unit !== null) {
          return `Pārāk liels: ${subject(issue.origin)} jāsatur ${adj}${bound} ${unit}`;
        }

        return `Pārāk liels: ${subject(issue.origin)} jābūt ${adj}${bound}`;
      }

      case "too_small": {
        const adj = issue.inclusive ? ">=" : ">";
        const unit = sizing(issue.origin, issue.minimum);
        const bound = issue.minimum.toString();

        if (unit !== null) {
          return `Pārāk mazs: ${subject(issue.origin)} jāsatur ${adj}${bound} ${unit}`;
        }

        return `Pārāk mazs: ${subject(issue.origin)} jābūt ${adj}${bound}`;
      }

      case "invalid_format": {
        if (issue.format === "starts_with") {
          return `Nederīgs teksts: jāsākas ar "${issue.prefix}"`;
        }
        if (issue.format === "ends_with") {
          return `Nederīgs teksts: jābeidzas ar "${issue.suffix}"`;
        }
        if (issue.format === "includes") {
          return `Nederīgs teksts: jāsatur "${issue.includes}"`;
        }
        if (issue.format === "regex") {
          return `Nederīgs teksts: jāatbilst šablonam ${issue.pattern}`;
        }

        return `Nederīga ${FormatDictionary[issue.format] ?? issue.format}`;
      }

      case "not_multiple_of":
        return `Nederīgs skaitlis: jādalās ar ${issue.divisor.toString()}`;

      case "unrecognized_keys":
        return `Neatpazīt${issue.keys.length > 1 ? "as atslēgas" : "a atslēga"}: ${z.core.util.joinValues(issue.keys, ", ")}`;

      case "invalid_key":
        return `Nederīga atslēga: ${typeName(issue.origin)}`;

      case "invalid_union":
        return "Nederīga ievade";

      case "invalid_element":
        return `Nederīga vērtība: ${typeName(issue.origin)}`;

      default:
        return "Nederīga ievade";
    }
  };
};

/**
 * The default export is the factory, because that is what every zod locale
 * module exports and what `z.config(lv())` expects to be handed.
 */
export default function (): { localeError: z.core.$ZodErrorMap } {
  return { localeError: error() };
}
