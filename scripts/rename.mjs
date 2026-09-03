/**
 * `node scripts/rename.mjs <name> [--dry-run]` — the mechanical half of a fork
 * (ADR-0064 §3).
 *
 * The other half is two variables: `APP_ID` in the API's `.env` and
 * `VITE_APP_ID` in each app's, from which every cookie name, the JWT audience
 * and every device-storage key are derived at runtime. This script rewrites
 * the identity that is **not** runtime-derived and therefore cannot be
 * configured: the fixture email domain, the compose project, container,
 * network and role names, the root package name, the `brand` block in each
 * app's `common` catalogue, and the two document titles.
 *
 * A script rather than a checklist, which is the whole argument of ADR-0064:
 * `machxi` appears in hundreds of places and nearly all of them are fixtures,
 * seeds and the `@machxi.local` email domain — mechanical, no judgement. A
 * checklist of them grows with every deliverable and has nothing that fails
 * when it drifts.
 *
 * **One token, replaced literally.** Every name above is built from the same
 * word, so `machxi_app`, `machxi-api`, `machxi.local` and `machxi_test` all
 * fall out of replacing `machxi` — and doing it that way is what keeps the
 * connection strings agreeing with the roles the init SQL creates. Case
 * matters: the token is lowercase everywhere it is load-bearing, and the
 * rendered brand is seeded separately below.
 *
 * `--dry-run` lists what would change and writes nothing, which is also the
 * repository's own smoke test of this file: `machxi` is the placeholder here,
 * so a real run would rewrite the blueprint into something else.
 *
 * Nothing here calls `process.exit()`, for the reason `postman.mjs` gives:
 * failures set `process.exitCode` and return, and Node exits once its handles
 * are closed.
 */
import {
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The placeholder identity this blueprint ships with (ADR-0064 §1). */
const TOKEN = "machxi";

/**
 * The same grammar the API's `APP_ID` and both SPAs' `VITE_APP_ID` accept.
 *
 * Checked here as well as there because this word *becomes* those variables in
 * the env files below: a name this script wrote and the config schema refuses
 * would be a repository that no longer starts.
 */
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 32;

/** Directories with nothing a fork owns. */
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

/**
 * What is deliberately left alone (ADR-0064 §3, and §7 of the checklist it
 * replaces).
 *
 * **The records keep the name.** ADRs, plan files and the ledger are the
 * history of this blueprint's decisions; a fork inherits the decisions, not
 * the name in the telling, and rewriting them would make every quotation false
 * and every upstream merge a conflict. `CLAUDE.md` and `.claude/**` are the
 * same material. `LICENSE` names a copyright holder, which is a legal fact
 * rather than a brand. `pnpm-lock.yaml` is generated. This file is excluded
 * because it documents the placeholder it removes.
 *
 * A directory entry ends in `/` and is matched as a prefix; everything else is
 * matched exactly, so `LICENSE` cannot also skip a future
 * `LICENSE-THIRD-PARTY`.
 */
const SKIP_PATHS = [
  ".claude/",
  "CLAUDE.md",
  "LICENSE",
  "docs/adr/",
  "docs/plan/",
  "docs/rebranding.md",
  "pnpm-lock.yaml",
  "scripts/rename.mjs",
];

/**
 * The **gitignored** env files, left to the operator (ADR-0064 §3).
 *
 * `.env.example` and `.env.test` are committed and are rewritten; a developer's
 * own `.env` is not, for two reasons that both matter. It is the one thing here
 * `git diff` cannot show, so rewriting it would put a change outside the review
 * step this script's own output tells the operator to perform — and outside
 * anything git could restore. And it carries live credentials for a Postgres
 * volume whose roles are named after the *old* identifier, so rewriting it
 * would point a working stack at roles that do not exist.
 *
 * Setting `APP_ID` and `VITE_APP_ID` there is step 1 of the recipe in
 * `docs/rebranding.md`, and the closing line below repeats it.
 */
const isPrivateEnvFile = (base) =>
  base === ".env" || base.startsWith(".env.local");

/** Extensions with no text to rewrite. */
const SKIP_EXTENSIONS = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);

/**
 * The four catalogues whose `brand` block is the rendered identity
 * (ADR-0046, ADR-0064 §3).
 *
 * The catalogue **is** the brand config — typed keys, per app and per locale,
 * so a missing one fails `check-types` — and this script seeds its values
 * rather than replacing it with a config object. `brand.mark` is the sidebar
 * monogram and is not derived by the token replacement, so it is set here.
 */
const BRAND_CATALOGUES = [
  "apps/admin/src/shared/i18n/locales/en/common.json",
  "apps/admin/src/shared/i18n/locales/lv/common.json",
  "apps/customer/src/shared/i18n/locales/en/common.json",
  "apps/customer/src/shared/i18n/locales/lv/common.json",
];

/**
 * `process.stderr` rather than `console.error`: `no-console` is on everywhere,
 * CLI scripts included (ADR-0005 §Scope), and this file sits outside every
 * lint config's `files` glob only by accident of layout.
 */
const write = (stream, line) => {
  stream.write(`${line}\n`);
};

const fail = (message) => {
  write(process.stderr, message);
  process.exitCode = 1;
};

const isSkipped = (relative) =>
  SKIP_PATHS.some((skip) =>
    skip.endsWith("/") ? relative.startsWith(skip) : relative === skip,
  ) ||
  isPrivateEnvFile(path.basename(relative)) ||
  SKIP_EXTENSIONS.has(path.extname(relative));

/** Every candidate file, with the heavy directories pruned during the walk. */
const walk = (directory, files = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;

      walk(path.join(directory, entry.name), files);

      continue;
    }

    if (!entry.isFile()) continue;

    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");

    if (isSkipped(relative)) continue;

    files.push({ absolute, relative });
  }

  return files;
};

/**
 * The monogram, from the new name.
 *
 * The first character, in the case the name was given in: the shipped mark is
 * the lowercase `m` because this blueprint's wordmark is lowercase, and a fork
 * that wants something else edits four catalogue entries — which is the point
 * of the brand living in a typed catalogue rather than in a constant.
 */
const markFor = (name) => name.slice(0, 1);

/**
 * Rewrites one file's text. Exported shape kept pure so it can be tested
 * without a filesystem.
 */
export const rewrite = (text, name) => text.split(TOKEN).join(name);

const rewriteBrandMark = (text, name) =>
  text.replace(/("mark":\s*)"[^"]*"/, `$1"${markFor(name)}"`);

const run = () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const names = args.filter((arg) => !arg.startsWith("--"));

  /*
   * An unrecognised flag is a refusal, not a shrug.
   *
   * `--dryrun`, `--dry` or a typo would otherwise be filtered out as "not a
   * name" and the rewrite would run for real, across hundreds of files, with
   * no confirmation — which is the one mistake this script must not make
   * quietly.
   */
  const unknown = args.filter(
    (arg) => arg.startsWith("--") && arg !== "--dry-run",
  );

  if (unknown.length > 0) {
    fail(
      `unknown option: ${String(unknown[0])} (usage: node scripts/rename.mjs <name> [--dry-run])`,
    );

    return;
  }

  if (names.length !== 1) {
    fail("usage: node scripts/rename.mjs <name> [--dry-run]");

    return;
  }

  const [name] = names;

  if (!NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    fail(
      `"${name}" is not a usable identifier: lowercase letters, digits and hyphens, starting and ending with a letter or digit, at most ${String(MAX_NAME_LENGTH)} characters. It becomes APP_ID and VITE_APP_ID, which name cookies.`,
    );

    return;
  }

  if (name === TOKEN) {
    fail(`"${TOKEN}" is the placeholder this script removes; pick another.`);

    return;
  }

  const brandCatalogues = new Set(BRAND_CATALOGUES);
  const changed = [];

  for (const { absolute, relative } of walk(root)) {
    let text;

    try {
      const bytes = readFileSync(absolute);

      text = bytes.toString("utf8");

      /*
       * Round-tripped rather than trusted. `SKIP_EXTENSIONS` is a deny-list and
       * will always be missing something (`.otf`, `.wasm`, `.zip`); decoding a
       * binary file as UTF-8 replaces every invalid sequence with U+FFFD, and
       * writing that back would corrupt the file silently. If the bytes do not
       * survive the trip, this is not text.
       */
      if (!Buffer.from(text, "utf8").equals(bytes)) continue;
    } catch {
      // Unreadable: nothing a rename can do with it.
      continue;
    }

    const isBrand = brandCatalogues.has(relative);
    const next = isBrand
      ? rewriteBrandMark(rewrite(text, name), name)
      : rewrite(text, name);

    if (next === text) continue;

    const occurrences = text.split(TOKEN).length - 1;

    changed.push({ relative, occurrences });

    if (!dryRun) writeFileSync(absolute, next);
  }

  /*
   * The one file whose *name* carries the token: the Postman collection.
   * `scripts/postman.mjs` and the CI workflow both open it by path, and both
   * have just had their copy of that path rewritten — so leaving the file
   * itself named `machxi-api…` would break `pnpm test:postman` in exactly the
   * way a rename is supposed not to.
   */
  const renamed = [];

  for (const { absolute, relative } of walk(root)) {
    const base = path.basename(relative);

    if (!base.includes(TOKEN)) continue;

    const next = path.join(path.dirname(absolute), rewrite(base, name));

    renamed.push({
      from: relative,
      to: path.relative(root, next).split(path.sep).join("/"),
    });

    if (!dryRun) renameSync(absolute, next);
  }

  const total = changed.reduce((sum, file) => sum + file.occurrences, 0);

  for (const file of changed) {
    write(process.stdout, `  ${file.relative} (${String(file.occurrences)})`);
  }

  for (const file of renamed) {
    write(process.stdout, `  ${file.from} -> ${file.to}`);
  }

  write(
    process.stdout,
    `${dryRun ? "would rewrite" : "rewrote"} ${String(total)} occurrence${
      total === 1 ? "" : "s"
    } of "${TOKEN}" across ${String(changed.length)} file${
      changed.length === 1 ? "" : "s"
    }, and ${dryRun ? "would rename" : "renamed"} ${String(renamed.length)}`,
  );

  /*
   * Said every time, in both modes, because it is the one consequence a
   * reader of the diff might not weigh: `0008_database_roles.sql` names the
   * application role in `GRANT`, `REVOKE` and two guard clauses, so a fork
   * that renames the compose roles has to rewrite that migration or migrate
   * against a role that does not exist. Editing a committed migration is
   * otherwise forbidden (ADR-0008) — this is a fork-day action on a database
   * that has never been migrated, which is the same condition ADR-0064 §2 puts
   * on `APP_ID` itself.
   */
  write(
    process.stdout,
    "note: committed migrations under packages/db/migrations name the database roles and are rewritten too. Safe before the first migrate; not after (ADR-0008, ADR-0064 §2).",
  );

  if (dryRun) {
    write(process.stdout, "nothing was written (--dry-run)");

    return;
  }

  write(
    process.stdout,
    `your own .env files were left alone: set APP_ID=${name} in .env and VITE_APP_ID=${name} in apps/admin/.env and apps/customer/.env, run \`pnpm docker:reset\` (the volume's roles are named after the old identifier), then review the diff`,
  );
};

// `statSync` proves the root resolved to a directory before the walk; a bad
// resolution would otherwise surface as a confusing ENOENT mid-walk.
if (!statSync(root).isDirectory()) {
  fail(`not a directory: ${root}`);
} else {
  run();
}
