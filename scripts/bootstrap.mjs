#!/usr/bin/env node
// `pnpm bootstrap --prefix <name>` — a fork's journal reset (ADR-0084 §1, a
// delta on ADR-0065 §3 and §5).
//
// A fork carries the starter's records and machinery and none of its journal:
// `docs/plan/` and `docs/CHANGELOG.md` record how the starter got here, and a
// fork starts its own. This script is the mechanical half of `/bootstrap`:
//
// - it removes the starter's plans, notes and lane files, keeping
//   `docs/plan/lanes/README.md`, which describes the shape and keeps the
//   directory when no lane is open;
// - it writes the empty ledger from the starter's own: the header under the
//   fork's `Tag prefix:`, an empty table, the Rules and The window sections,
//   the generated block reading no lane open, and no sentence that links a
//   section it drops — the starter's frozen window history among them;
// - it resets the changelog to its preamble under the fork's prefix, without
//   what the preamble says about the starter's own older entries.
//
// It refuses a tree that is not a fresh clone of the starter — no git work
// tree, a dirty one, a ledger under another prefix, a journal missing a part
// it rewrites — and writes nothing then. It commits nothing: the operator
// reads the diff. What needs judgement — the rename, the licence, the
// `starter` remote — stays in the skill.
//
// Usage:
//   node scripts/bootstrap.mjs --prefix <name>

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHANGELOG, TAG_PREFIX_LINE, parseTagPrefix } from "./docs-hygiene.mjs";
import { LANES_DIR, LEDGER, applyBlock, renderLanes } from "./lanes.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The starter's own tag namespace (ADR-0081 §5), which a fork never takes. */
export const STARTER_PREFIX = "starter";

/** The plan directory, and the one file in it and in `lanes/` that stays. */
const PLAN_DIR = "docs/plan";
const KEPT = new Set([LEDGER, `${LANES_DIR}/README.md`]);

/** The ledger's sections a fork keeps, by heading; every other one goes. */
const KEPT_SECTIONS = ["## Rules", "## The window"];

const USAGE = "usage: pnpm bootstrap --prefix <name>";

/** A refusal: the tree is left as it was, and the message says why. */
export class BootstrapRefusal extends Error {}

const refuse = (message) => {
  throw new BootstrapRefusal(`bootstrap: ${message}`);
};

/**
 * Why `prefix` cannot be a fork's tag prefix, or `null`. The grammar is the
 * ledger's own `Tag prefix:` line's, so a prefix written here always parses
 * there; `starter` is the starter's namespace, and a fork's tag of the same
 * name would collide with the one `git fetch starter --tags` brings down.
 */
export function prefixProblem(prefix) {
  if (typeof prefix !== "string" || prefix === "") {
    return `name the fork's tag prefix (${USAGE})`;
  }
  if (!TAG_PREFIX_LINE.test(`Tag prefix: \`${prefix}\``)) {
    return `"${prefix}" is not a tag prefix: a lowercase letter, then lowercase letters, digits or hyphens, and never \`v\` and a digit, which a release tag's \`v[0-9]*\` would match (ADR-0081 §5)`;
  }
  if (prefix === STARTER_PREFIX) {
    return `"${STARTER_PREFIX}" is the starter's namespace; a fork's tags would collide with the ones \`git fetch starter --tags\` brings down (ADR-0081 §5)`;
  }
  return null;
}

/** A heading's GitHub anchor: `## The window's history` → `the-windows-history`. */
export function anchorOf(heading) {
  return heading
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** `[text](#anchor)` — an in-page link. */
const ANCHOR_LINK = /\]\(#([^)\s]+)\)/g;

/** `[D34](0034-lanes-on-one-machine.md)` — a link to one of the plans. */
const PLAN_LINK = /\]\((?:\.\/)?\d{4}-[^)\s]*\.md[^)\s]*\)/;

/**
 * Sentence boundaries inside one line of prose: a full stop and a space before
 * a capital, emphasis, a link or code. Good enough for the ledger's prose,
 * which is all this reads, and only a sentence with a dropped link is removed.
 */
const SENTENCE_BREAK = /(?<=\.)\s+(?=[A-Z*[`])/;

/**
 * The line with every sentence removed that links a section not in `anchors`
 * or one of the starter's plans, or the line unchanged when it links neither.
 * `null` when nothing of it is left.
 */
function dropDanglingSentences(line, anchors) {
  const dangling = (text) =>
    PLAN_LINK.test(text) ||
    [...text.matchAll(ANCHOR_LINK)].some((m) => !anchors.has(m[1]));
  if (!dangling(line)) return line;
  const kept = line.split(SENTENCE_BREAK).filter((s) => !dangling(s));
  if (kept.length === 0) return null;
  // A list item whose opening sentence went keeps its marker.
  const marker = line.match(/^(\s*[-*] )/)?.[1] ?? "";
  const joined = kept.join(" ");
  return marker && !joined.startsWith(marker) ? marker + joined : joined;
}

/** A table row's cells, trimmed: `| # | Title |` → `["#", "Title"]`. */
const rowCells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

/** The header of an empty table, padded as Prettier pads it. */
function emptyTable(header) {
  const cells = rowCells(header);
  const widths = cells.map((cell) => Math.max(3, cell.length));
  const row = (values) =>
    `| ${values.map((v, i) => v.padEnd(widths[i])).join(" | ")} |`;
  return [row(cells), row(widths.map((w) => "-".repeat(w)))];
}

/**
 * The fork's empty ledger, made from the starter's: its header with the
 * fork's prefix, the table's header and no row, the Rules and The window
 * sections, no sentence linking a section this drops or one of the starter's
 * plans, and the generated block as `pnpm lanes` writes it with no lane open.
 */
export function resetLedger(text, prefix) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const firstSection = lines.findIndex((l) => l.startsWith("## "));
  const tableStart = lines.findIndex(
    (l, i) => l.startsWith("|") && (firstSection === -1 || i < firstSection),
  );
  if (tableStart === -1) refuse(`${LEDGER} has no table above its sections`);

  const header = lines.slice(0, tableStart);
  const prefixLines = header
    .map((l, i) => (TAG_PREFIX_LINE.test(l) ? i : -1))
    .filter((i) => i !== -1);
  if (prefixLines.length !== 1) {
    refuse(`${LEDGER}'s header does not name one \`Tag prefix:\``);
  }
  header[prefixLines[0]] = `Tag prefix: \`${prefix}\``;
  while (header.at(-1) === "") header.pop();

  const sections = new Map();
  let current = null;
  for (const line of lines.slice(firstSection)) {
    if (line.startsWith("## ")) {
      current = KEPT_SECTIONS.includes(line) && !sections.has(line) ? [] : null;
      if (current) sections.set(line, current);
    }
    if (current) current.push(line);
  }
  for (const heading of KEPT_SECTIONS) {
    if (!sections.has(heading)) refuse(`${LEDGER} has no \`${heading}\``);
  }

  const anchors = new Set(
    [lines.find((l) => l.startsWith("# ")) ?? "", ...KEPT_SECTIONS]
      .filter(Boolean)
      .map(anchorOf),
  );
  const body = KEPT_SECTIONS.map((heading) => {
    const section = sections
      .get(heading)
      .map((line) => dropDanglingSentences(line, anchors))
      .filter((line) => line !== null);
    while (section.at(-1) === "") section.pop();
    return section.join("\n");
  });

  const ledger = [
    header.join("\n"),
    emptyTable(lines[tableStart]).join("\n"),
    ...body,
  ].join("\n\n");
  try {
    return `${applyBlock(ledger, renderLanes([]))}\n`;
  } catch (error) {
    return refuse(error.message);
  }
}

/**
 * What the starter's changelog preamble says of its own entries, and what a
 * fork's says instead. Each is replaced exactly once, or the reset refuses:
 * a preamble that no longer reads this way is a change this script follows.
 */
const PREAMBLE_EDITS = (prefix) => [
  [
    "every entry from the deliverable that decided this on carries",
    "every entry carries",
  ],
  [
    `— \`${STARTER_PREFIX}\` here — and the entries below that point predate it (`,
    `— \`${prefix}\` here (`,
  ],
];

/** The fork's changelog: the starter's title and preamble, under `prefix`. */
export function resetChangelog(text, prefix) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const firstEntry = lines.findIndex((l) => l.startsWith("## "));
  const preamble = lines.slice(
    0,
    firstEntry === -1 ? lines.length : firstEntry,
  );
  while (preamble.at(-1) === "") preamble.pop();
  let next = preamble.join("\n");
  for (const [from, to] of PREAMBLE_EDITS(prefix)) {
    if (next.split(from).length !== 2) {
      refuse(
        `${CHANGELOG}'s preamble does not read "${from}" once; follow its wording in scripts/bootstrap.mjs`,
      );
    }
    next = next.replace(from, to);
  }
  return `${next}\n`;
}

/** Every file under `docs/plan/` but the two that stay, as repository paths. */
async function journalFiles(root) {
  const files = [];
  const walk = async (rel) => {
    for (const entry of await readdir(path.join(root, rel), {
      withFileTypes: true,
    })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (!KEPT.has(child)) files.push(child);
    }
  };
  await walk(PLAN_DIR);
  return files.sort();
}

/**
 * Refuses a tree that is not the top of a clean git work tree — a directory
 * inside some other repository is not a clone of the starter.
 */
function assertCleanClone(root, env) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  let top;
  try {
    top = realpathSync(git("rev-parse", "--show-toplevel").trim());
  } catch {
    top = null;
  }
  if (top !== realpathSync(root)) {
    refuse(
      `${root} is not a git work tree; a fork is a clone that keeps history (ADR-0065 §1)`,
    );
  }
  const status = git("status", "--porcelain", "--untracked-files=all");
  if (status.trim() !== "") {
    refuse(
      "the working tree is not clean; commit or stash first, so the reset is one diff to read",
    );
  }
}

/**
 * Resets the fork's journal under `prefix`. Every check runs, and both new
 * files are rendered, before anything is written, so a refusal leaves the
 * tree as it was. Returns what it removed and wrote.
 */
export async function bootstrap({
  root = repoRoot,
  prefix,
  env = process.env,
}) {
  const problem = prefixProblem(prefix);
  if (problem) refuse(problem);

  assertCleanClone(root, env);

  const at = (rel) => path.join(root, ...rel.split("/"));
  for (const rel of [LEDGER, `${LANES_DIR}/README.md`, CHANGELOG]) {
    if (!existsSync(at(rel))) {
      refuse(
        `${rel} is missing; this is not a fresh clone of the starter (ADR-0084 §1)`,
      );
    }
  }
  const ledger = await readFile(at(LEDGER), "utf8");
  const { prefixes } = parseTagPrefix(ledger);
  if (prefixes.length !== 1 || prefixes[0].prefix !== STARTER_PREFIX) {
    const found = prefixes.map((p) => `\`${p.prefix}\``).join(", ") || "none";
    refuse(
      `${LEDGER}'s tag prefix is ${found}, not \`${STARTER_PREFIX}\`: this tree is already bootstrapped, or is not the starter (ADR-0084 §1)`,
    );
  }

  const nextLedger = resetLedger(ledger, prefix);
  const nextChangelog = resetChangelog(
    await readFile(at(CHANGELOG), "utf8"),
    prefix,
  );
  const removed = await journalFiles(root);

  for (const rel of removed) await rm(at(rel), { force: true });
  await writeFile(at(LEDGER), nextLedger);
  await writeFile(at(CHANGELOG), nextChangelog);
  return { removed, ledger: LEDGER, changelog: CHANGELOG };
}

/** `--prefix acme` or `--prefix=acme`; anything else is refused. */
export function parseArgs(args) {
  let prefix;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--prefix") {
      prefix = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--prefix=")) {
      prefix = arg.slice("--prefix=".length);
    } else {
      refuse(`unknown argument ${JSON.stringify(arg)} (${USAGE})`);
    }
  }
  return { prefix };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { prefix } = parseArgs(process.argv.slice(2));
    const { removed } = await bootstrap({ prefix });
    console.log(
      `bootstrap: removed ${removed.length} file(s) under ${PLAN_DIR}/ — the starter's plans, notes and lane files; kept ${LANES_DIR}/README.md`,
    );
    console.log(
      `bootstrap: wrote ${LEDGER} — an empty ledger under \`${prefix}\`, no lane open`,
    );
    console.log(
      `bootstrap: reset ${CHANGELOG} to its preamble under \`${prefix}\``,
    );
    console.log(
      "next: read the diff and commit it; then the rename, the licence and the `starter` remote (/bootstrap), and `pnpm docs:check` and `pnpm test:scripts` green",
    );
  } catch (error) {
    if (!(error instanceof BootstrapRefusal)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
