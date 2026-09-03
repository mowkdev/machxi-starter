import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The drift check and the extractor (ADR-0046 §9), one tool in two modes.
 *
 * `pnpm i18n:check` reports; `pnpm i18n:extract` writes the half of the report
 * that can be applied mechanically. The check is a pure function of the tree —
 * it reads `src/` and nothing else, opens no socket and asks the environment
 * nothing — so it is cached under ADR-0026 and joins `pnpm check`.
 *
 * **Why this is not `i18next-parser`, which §9 named.** The record's sentence —
 * "the code is the source of truth for which keys exist and the catalogue is
 * derived" — is the right instinct and the wrong direction for a design with
 * typed keys. `en` *is* the type source (§2): `TranslationKey` is a union over
 * it, so a `t()` call or a config value naming a key `en` lacks is already a red
 * `check-types`, and a tool that rewrote `en` from the code could only ever
 * delete the key the compiler is about to demand. The catalogue says which keys
 * exist; the code says which are used; the drift between them is what needs a
 * tool. `i18next-parser` measures that drift by parsing `t()` calls, and in this
 * app the majority of keys never appear in one — ADR-0046 §7 made column
 * headers, field labels, route titles and `meta.success` into `TranslationKey`
 * *values*, and a parser looking for call sites sees none of them. Feeding it
 * those would take a custom lexer, which its plugin contract spells as a class
 * (ADR-0009). So the reference scan below reads both kinds of key, and the
 * dependency is not taken.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = join(HERE, "..", "src");
const LOCALES_DIR = join(SRC, "shared", "i18n", "locales");
const SOURCE_LOCALE = "en";

/** Where a literal is a literal by design (ADR-0046 §8's lint exemption, in prose). */
const I18N_DIR = join(SRC, "shared", "i18n");

/** Generated, never hand-edited, and not a place copy lives (ADR-0032). */
const GENERATED = join(SRC, "app", "routeTree.gen.ts");

/**
 * The i18next plural suffixes, which are the CLDR category names.
 *
 * A key ending in one of these is a *form* of the key before it, so
 * `grid:applied.announce_one` and `grid:applied.announce_other` are one key with
 * two forms — referenced in the code as `applied.announce` and counted here as
 * one.
 */
const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"];

/**
 * The keys no scan can see, because they are composed at runtime.
 *
 * ADR-0046 §7 predicted this list and asked `D7.6` to decide how the extractor
 * is told about it; this is the answer, and it is deliberately an enumeration
 * with a call site beside each entry rather than a rule. The first two exist
 * because an enum declared once in `@repo/contracts` (ADR-0023) must not be
 * copied into a catalogue key list that could then disagree with it; the third
 * exists because a scan of `src/` cannot see a `t()` call in a package.
 */
const DYNAMIC = [
  {
    // `messageForError` in `shared/notifications/messages.ts`: `t(error.code)`.
    // The completeness of this namespace is checked by the compiler instead —
    // `shared/i18n/__checks__/errors.ts` (ADR-0046 §2).
    pattern: /^errors:/,
    reason: "resolved from an ErrorCode by messageForError (ADR-0046 §2)",
  },
  {
    // `optionLabel` in `shared/resource/config.ts`: `t(dynamicKey(...))`.
    pattern: /^common:options\./,
    reason: "composed by dynamicKey from a contracts enum (ADR-0046 §7)",
  },
  {
    /*
     * `common:loading.starting` in `@repo/app-kit`'s `AppLoader`, and
     * `common:brand.authTagline` in its `AuthLayout` (`D14.8`, ADR-0062 §1).
     *
     * The composition both SPAs share lives in a package, and this scan reads
     * `src/` — so a `t()` call that moved out of the app is invisible here
     * exactly as a runtime-composed key is. The sentences are still this app's
     * (the kit resolves them through this app's mounted instance), and the
     * compiler still checks the keys at the kit's call sites against this
     * app's catalogues, which is what keeps this entry an exemption from the
     * *scan* rather than from the type.
     */
    pattern: /^common:(loading\.starting|brand\.authTagline)$/,
    reason: "read inside @repo/app-kit (ADR-0062 §1)",
  },
];

/** `Intl` through `shared/i18n` or not at all (ADR-0046 §5). */
const IMPLICIT_LOCALE = ["toLocaleString(", "toLocaleDateString("];

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const sourceFiles = () =>
  walk(SRC).filter(
    (path) =>
      (path.endsWith(".ts") || path.endsWith(".tsx")) && path !== GENERATED,
  );

const localeNames = () =>
  readdirSync(LOCALES_DIR).filter((entry) =>
    statSync(join(LOCALES_DIR, entry)).isDirectory(),
  );

const namespaceNames = () =>
  readdirSync(join(LOCALES_DIR, SOURCE_LOCALE))
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length));

const catalogue = (locale, namespace) =>
  JSON.parse(
    readFileSync(join(LOCALES_DIR, locale, `${namespace}.json`), "utf8"),
  );

/** Every leaf path in a catalogue, dot-joined, in file order. */
const leaves = (value, prefix = []) =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, child]) =>
        leaves(child, [...prefix, key]),
      )
    : [{ path: prefix.join("."), value }];

/** `applied.announce_one` → `{ base: "applied.announce", category: "one" }`. */
const splitPlural = (path) => {
  const at = path.lastIndexOf("_");

  if (at === -1) return { base: path, category: null };

  const category = path.slice(at + 1);

  return PLURAL_CATEGORIES.includes(category)
    ? { base: path.slice(0, at), category }
    : { base: path, category: null };
};

/**
 * Every string literal in a file, quotes and interpolation-free templates alike.
 *
 * A regex rather than a parse, and the imprecision runs one way on purpose: a
 * key named in a comment counts as a reference, so the worst this can do is let
 * an orphan live. Reporting a key as unused while something uses it would be a
 * red gate for a false reason, which is the failure a check like this must not
 * have.
 */
const literalsIn = (text) =>
  [...text.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\\n$]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );

const KEY_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

/**
 * Which namespaces a file's *unprefixed* keys could belong to.
 *
 * `useT("grid")` binds `grid`; so does a `TFunction<"grid">` annotation, and so
 * does anything else that spells the name — the test is deliberately loose,
 * because a binding this misses turns a live key into a reported orphan.
 * `common` is always in the set: it is `defaultNS`, so an unprefixed key
 * resolves there for every translator in the app (ADR-0046 §3).
 */
const boundNamespaces = (text, namespaces) =>
  namespaces.filter(
    (namespace) =>
      namespace === "common" ||
      new RegExp(`["'<]${namespace}["'>]`).test(text) ||
      text.includes(`${namespace}:`),
  );

/** The set of `ns:base` a source tree refers to, however the key travels. */
const referencedKeys = (files, namespaces) => {
  const referenced = new Set();

  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const bound = boundNamespaces(text, namespaces);

    for (const literal of literalsIn(text)) {
      const [maybeNamespace, ...rest] = literal.split(":");

      if (rest.length === 1 && namespaces.includes(maybeNamespace)) {
        referenced.add(`${maybeNamespace}:${splitPlural(rest[0]).base}`);
        continue;
      }

      if (!KEY_PATH.test(literal)) continue;

      for (const namespace of bound)
        referenced.add(`${namespace}:${splitPlural(literal).base}`);
    }
  }

  return referenced;
};

const isDynamic = (key) => DYNAMIC.some(({ pattern }) => pattern.test(key));

const categoriesFor = (locale) =>
  new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

/**
 * The whole report, as a list of findings.
 *
 * Findings rather than a boolean, because "red" is not useful on its own: the
 * point of the check is to name the key and say which of the four things went
 * wrong with it.
 */
const inspect = () => {
  const namespaces = namespaceNames();
  const locales = localeNames();
  const targets = locales.filter((locale) => locale !== SOURCE_LOCALE);
  const files = sourceFiles();
  const referenced = referencedKeys(files, namespaces);
  const findings = [];

  for (const namespace of namespaces) {
    const source = leaves(catalogue(SOURCE_LOCALE, namespace));
    const sourceForms = new Map();

    for (const { path, value } of source) {
      const { base, category } = splitPlural(path);
      const key = `${namespace}:${base}`;

      sourceForms.set(key, [...(sourceForms.get(key) ?? []), category]);

      if (typeof value !== "string" || value.trim() === "")
        findings.push({
          kind: "empty",
          key: `${namespace}:${path}`,
          detail: `${SOURCE_LOCALE} has no sentence for it`,
        });
    }

    for (const [key, forms] of sourceForms) {
      if (!referenced.has(key) && !isDynamic(key))
        findings.push({
          kind: "orphan",
          key,
          detail: "nothing under src/ refers to it",
        });

      const plural = forms.some((category) => category !== null);

      if (plural) {
        const missing = categoriesFor(SOURCE_LOCALE).filter(
          (category) => !forms.includes(category),
        );

        if (missing.length > 0)
          findings.push({
            kind: "plural",
            key,
            detail: `${SOURCE_LOCALE} is missing the ${missing.join(", ")} form(s)`,
          });
      }

      for (const locale of targets) {
        const translated = leaves(catalogue(locale, namespace))
          .map(({ path }) => splitPlural(path))
          .filter(({ base }) => `${namespace}:${base}` === key)
          .map(({ category }) => category);

        if (translated.length === 0) {
          findings.push({
            kind: "gap",
            key,
            detail: `${locale} has no entry`,
          });
          continue;
        }

        const translatedPlural = translated.some(
          (category) => category !== null,
        );

        if (plural && !translatedPlural) {
          findings.push({
            kind: "plural",
            key,
            detail: `${locale} answers a counted key with one form`,
          });
          continue;
        }

        if (!translatedPlural) continue;

        const missing = categoriesFor(locale).filter(
          (category) => !translated.includes(category),
        );

        if (missing.length > 0)
          findings.push({
            kind: "plural",
            key,
            detail: `${locale} is missing the ${missing.join(", ")} form(s)`,
          });
      }
    }

    for (const locale of targets)
      for (const { path } of leaves(catalogue(locale, namespace))) {
        const key = `${namespace}:${splitPlural(path).base}`;

        if (!sourceForms.has(key))
          findings.push({
            kind: "stale",
            key: `${locale} → ${key}`,
            detail: `${SOURCE_LOCALE} does not have it`,
          });
      }
  }

  for (const path of files) {
    if (path.startsWith(I18N_DIR + sep)) continue;

    const text = readFileSync(path, "utf8");

    for (const call of IMPLICIT_LOCALE)
      if (text.includes(call))
        findings.push({
          kind: "implicit-locale",
          key: relative(SRC, path).split(sep).join("/"),
          detail: `${call}) takes the browser's locale; format through shared/i18n (ADR-0046 §5)`,
        });
  }

  return findings;
};

/**
 * The half of the report a machine can apply: an orphan is removed from every
 * locale, a stale translation is removed.
 *
 * **It only ever deletes**, and the asymmetry is the point. The opposite
 * direction — the code names a key `en` lacks — belongs to the compiler and not
 * here: `en` is the type source (ADR-0046 §2), so that call is already a red
 * `check-types` naming the file, the line and the nearest spelling, which is
 * more than this scan could say. And it is the one direction the scan must not
 * take: `literalsIn` over-reports references on purpose, which is safe while it
 * decides what to delete and exactly wrong while deciding what to add, because
 * every key-shaped literal that is not a key — a dotted fixture path, a token
 * name — would arrive as a key to create.
 *
 * A `gap` is not applied either: filling one means inventing a sentence, and an
 * empty `lv` entry would silence the finding without translating anything. The
 * gap is the report's whole product, and `i18n:check` stays red until a person
 * writes the words.
 */
const rewrite = (findings) => {
  const edits = new Map();

  const load = (locale, namespace) => {
    const id = `${locale}/${namespace}`;

    if (!edits.has(id)) edits.set(id, catalogue(locale, namespace));

    return edits.get(id);
  };

  const deleteIn = (object, path) => {
    const parts = path.split(".");
    let cursor = object;

    for (const part of parts.slice(0, -1)) {
      if (typeof cursor?.[part] !== "object") return;
      cursor = cursor[part];
    }

    delete cursor[parts.at(-1)];
  };

  const forms = (locale, namespace, base) =>
    leaves(catalogue(locale, namespace))
      .map(({ path }) => path)
      .filter((path) => splitPlural(path).base === base);

  for (const finding of findings) {
    if (finding.kind === "orphan") {
      const [namespace, base] = finding.key.split(":");

      for (const locale of localeNames())
        for (const path of forms(locale, namespace, base))
          deleteIn(load(locale, namespace), path);

      continue;
    }

    if (finding.kind === "stale") {
      const [locale, key] = finding.key.split(" → ");
      const [namespace, base] = key.split(":");

      for (const path of forms(locale, namespace, base))
        deleteIn(load(locale, namespace), path);
    }
  }

  const written = [];

  for (const [id, value] of edits) {
    const [locale, namespace] = id.split("/");
    const path = join(LOCALES_DIR, locale, `${namespace}.json`);
    const next = `${JSON.stringify(value, null, 2)}\n`;

    if (next === readFileSync(path, "utf8")) continue;

    writeFileSync(path, next, "utf8");
    written.push(`${locale}/${namespace}.json`);
  }

  return written;
};

const write = process.argv.includes("--write");
const findings = inspect();

if (write) {
  const written = rewrite(findings);

  process.stdout.write(
    written.length === 0
      ? "i18n: catalogues are already what the code says they are.\n"
      : `i18n: rewrote ${written.join(", ")}.\n` +
          "Fill in any key that was added empty, then run `pnpm i18n:check`.\n",
  );
} else if (findings.length > 0) {
  process.stderr.write(
    `i18n: ${String(findings.length)} finding(s).\n\n` +
      findings
        .map(({ kind, key, detail }) => `  ${kind}  ${key} — ${detail}\n`)
        .join("") +
      "\n`pnpm i18n:extract` applies what can be applied mechanically.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write("i18n: catalogues, code and locales agree.\n");
}
