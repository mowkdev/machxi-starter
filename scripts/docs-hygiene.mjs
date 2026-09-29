#!/usr/bin/env node
// Checks the documents a fork inherits (ADR-0065 §5) and the behaviour specs
// (ADR-0068 §1).
//
// `.claude/**` and `CLAUDE.md` travel into every fork. A fork renumbers nothing
// and re-dates everything, so a step number, a ship date or a bare record range
// in those files is inherited as somebody else's biography. Window and
// supersession state has one home — the ledger — and everywhere else links to
// it.
//
// `docs/specs/*.md` travel too, under the same rules, and carry a shape of
// their own: every requirement cites records that exist and test files that
// exist, and has at least one scenario with a WHEN and a THEN — so a deleted
// test reddens every spec that claimed it.
//
// The ledger's window section names every open lane with its records
// (ADR-0079 §2), and two lanes may not share a record or both add migrations
// (ADR-0079 §1, §3). The ledger itself is not an inherited document — it is
// this repository's journal and carries dates by design — so only its lane
// entries are read.
//
// Usage:
//   node scripts/docs-hygiene.mjs        report violations, exit 1 if any

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The one place window, supersession and date history is written. */
export const LEDGER_WINDOW = "plan/README.md#the-window";

export const RULES = [
  {
    id: "step-reference",
    // `D14.12` — a step number. The literal placeholder `D<n>.<step>` is fine.
    pattern: /\bD\d{1,3}\.\d{1,3}\b/g,
    message: "a step number; a fork renumbers its own steps",
  },
  {
    id: "date",
    pattern: /\b\d{4}-\d{2}-\d{2}\b/g,
    message: "a date; the dates belong to this repository's journal",
  },
  {
    id: "bare-range",
    // "ADRs 0030–0054", "0001-0058" — a range names records a fork does not have.
    pattern: /\b\d{4}\s*[–—-]\s*\d{4}\b/g,
    message: "a bare record range; cite one record with a topic gloss instead",
  },
];

/**
 * A line that states amendment-window status must link to the ledger rather
 * than restate it. The pattern is deliberately narrower than the bare word:
 * "the grace window" and "a browser window" are not statements about the
 * lifecycle, and flagging them would teach the writer to avoid the word.
 */
export const WINDOW_RULE = {
  id: "unlinked-window",
  pattern:
    /\bamendment window\b|\bwindows?(?!\.) (is|was|are|were|has|have|shut|shuts|closed|close|opened|opens|remains|belongs|covers|covered)\b|\b(the|a|an|its|this|that|no|one|each|every) windows?(?!\.)\b/i,
  message: `states window status without linking to the ledger (${LEDGER_WINDOW})`,
};

export function checkText(file, text) {
  const violations = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.pattern)) {
        violations.push({
          file,
          line: index + 1,
          rule: rule.id,
          found: match[0],
          message: rule.message,
        });
      }
    }
    if (WINDOW_RULE.pattern.test(line) && !line.includes(LEDGER_WINDOW)) {
      violations.push({
        file,
        line: index + 1,
        rule: WINDOW_RULE.id,
        found: line.trim().slice(0, 60),
        message: WINDOW_RULE.message,
      });
    }
  });
  return violations;
}

/**
 * Paths this scan never walks, repo-relative and POSIX-separated.
 *
 * `.claude/worktrees/` is where a session parks a git worktree of this same
 * repository: a whole second checkout, untracked, sitting inside a directory
 * the inherited-document scan otherwise reads in full. Left in, every
 * document in it is scanned twice — once as itself and once as somebody
 * else's biography — and a worktree on a branch mid-step reddens this check
 * for every session in the tree over files git does not track.
 * `.git/info/exclude` and `.prettierignore` skip the same path.
 */
export const EXCLUDED_PATHS = [".claude/worktrees"];

/** True for a path inside one of `EXCLUDED_PATHS` (or naming one). */
export function isExcluded(rel) {
  return EXCLUDED_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));
}

async function markdownUnder(dir, base) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) out.push(...(await markdownUnder(full, rel)));
    else if (entry.name.endsWith(".md")) out.push({ full, rel });
  }
  return out;
}

/** Every document a fork inherits: `.claude/**` plus the always-loaded summary. */
export async function inheritedDocuments(root = repoRoot) {
  const files = await markdownUnder(path.join(root, ".claude"), ".claude");
  files.push({ full: path.join(root, "CLAUDE.md"), rel: "CLAUDE.md" });
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function scan(root = repoRoot) {
  const violations = [];
  for (const { full, rel } of await inheritedDocuments(root)) {
    violations.push(...checkText(rel, await readFile(full, "utf8")));
  }
  return violations;
}

/** Where the behaviour specs live (ADR-0068 §1). */
export const SPECS_DIR = "docs/specs";

const REQUIREMENT = /^## Requirement: (.+)$/;
const SCENARIO = /^### Scenario: (.+)$/;
/** `[ADR-0018](../adr/0018-….md)` — the relative link a spec writes. */
const RECORD_LINK = /\]\(\.\.\/adr\/(\d{4}-[^)]+\.md)\)/g;
/** `` `apps/api/test/auth.int.test.ts` `` — a backticked repo-relative path. */
const TEST_PATH = /`([^`\s]+)`/g;

/**
 * Checks one spec's shape (ADR-0068 §1).
 *
 * `exists(relPath)` answers for a repo-relative path, injected so the negative
 * cases can run against text alone. Violations name the requirement or the
 * scenario, so the message reads as an instruction rather than a line number.
 */
export function checkSpec(file, text, exists) {
  const violations = [];
  const push = (line, rule, found, message) =>
    violations.push({ file, line, rule, found, message });
  const requirements = [];
  let current = null;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd();
    const n = index + 1;

    const requirement = line.match(REQUIREMENT);
    if (requirement) {
      current = {
        line: n,
        name: requirement[1],
        records: 0,
        proved: 0,
        scenarios: [],
      };
      requirements.push(current);
      return;
    }
    if (current === null) return;

    const scenario = line.match(SCENARIO);
    if (scenario) {
      current.scenarios.push({
        line: n,
        name: scenario[1],
        when: false,
        then: false,
      });
      return;
    }

    if (line.startsWith("Records:")) {
      const links = [...line.matchAll(RECORD_LINK)].map((m) => m[1]);
      current.records += links.length;
      for (const rel of links) {
        if (!exists(`docs/adr/${rel}`)) {
          push(
            n,
            "spec-record-missing",
            rel,
            "cites a record that does not exist",
          );
        }
      }
      return;
    }

    if (line.startsWith("Proved by:")) {
      const paths = [...line.matchAll(TEST_PATH)].map((m) => m[1]);
      current.proved += paths.length;
      for (const rel of paths) {
        if (!exists(rel)) {
          push(
            n,
            "spec-test-missing",
            rel,
            "names a test file that does not exist",
          );
        }
      }
      return;
    }

    const last = current.scenarios.at(-1);
    if (last) {
      if (line.includes("**WHEN**")) last.when = true;
      if (line.includes("**THEN**")) last.then = true;
    }
  });

  if (requirements.length === 0) {
    push(1, "spec-empty", file, "a spec holds at least one `## Requirement:`");
  }
  for (const r of requirements) {
    if (r.records === 0) {
      push(
        r.line,
        "spec-record-missing",
        r.name,
        "a requirement carries a `Records:` line linking at least one record",
      );
    }
    if (r.proved === 0) {
      push(
        r.line,
        "spec-test-missing",
        r.name,
        "a requirement carries a `Proved by:` line naming at least one test file",
      );
    }
    if (r.scenarios.length === 0) {
      push(
        r.line,
        "spec-no-scenario",
        r.name,
        "a requirement has at least one `### Scenario:`",
      );
    }
    for (const s of r.scenarios) {
      if (!s.when || !s.then) {
        push(
          s.line,
          "spec-scenario-shape",
          s.name,
          "a scenario has a **WHEN** and a **THEN**",
        );
      }
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

/** Every spec — the capability files, not the directory's own README. */
export async function specDocuments(root = repoRoot) {
  const dir = path.join(root, SPECS_DIR);
  return (
    (await readdir(dir))
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .sort()
      .map((name) => ({
        full: path.join(dir, name),
        rel: path.posix.join(SPECS_DIR, name),
      }))
      // No path under `docs/specs/` can match an `EXCLUDED_PATHS` entry today.
      // The filter is here so the two scans stay one rule rather than two: an
      // entry added under `docs/` later is honoured by both without a second
      // edit.
      .filter(({ rel }) => !isExcluded(rel))
  );
}

export async function scanSpecs(root = repoRoot) {
  const exists = (rel) => existsSync(path.join(root, ...rel.split("/")));
  const violations = [];
  for (const { full, rel } of await specDocuments(root)) {
    const text = await readFile(full, "utf8");
    // The inherited-document rules first — a spec travels into a fork too —
    // then its own shape.
    violations.push(...checkText(rel, text), ...checkSpec(rel, text, exists));
  }
  return violations;
}

/** The ledger whose window section names the open lanes (ADR-0079 §2). */
export const LEDGER = "docs/plan/README.md";

/**
 * One open lane, in the one shape the window section writes it:
 * `- **Lane [D30](0030-….md)** — opened 2026-09-29 · records [0079](…), [0025](…) · schema: no`
 */
const LANE_ENTRY =
  /^- \*\*Lane \[(D\d+)\]\([^)]+\)\*\* — opened (\d{4}-\d{2}-\d{2}) · records (.+?) · schema: (yes|no)\s*$/;
/**
 * `[0079](../adr/0079-….md)` — a record as a lane entry links it, the label
 * and the file agreeing. The records field is nothing but these, joined by
 * `, `: a record written any other way would escape the check.
 */
const LANE_RECORD = /^\[(\d{4})\]\(\.\.\/adr\/(\d{4})-[^)]+\.md\)$/;

/** `| [D30](…) | Title | **in progress** | …` — a ledger row that is open. */
const TABLE_ROW = /^\|([^|]+)\|[^|]*\|([^|]+)\|/;

/**
 * Reads the open lanes out of the ledger's window section (ADR-0079 §2), and
 * the deliverables its table marks `in progress`.
 *
 * The entries are the list under `**Open lanes:**` inside `## The window`,
 * ending at the first unindented line that is neither blank nor a list item —
 * the running paragraph. A ledger with no such list (a fresh fork's, before
 * its first deliverable opens) has no open lanes; the table is what says
 * whether it should have some. A list item that does not parse, and an
 * indented line inside the list, are returned as `malformed` rather than
 * dropped, so a typo cannot hide a lane or a record from the check.
 */
export function parseLanes(text) {
  const lanes = [];
  const malformed = [];
  const inProgress = [];
  let inWindow = false;
  let inList = false;
  const bad = (n, line) => malformed.push({ line: n, text: line.slice(0, 60) });
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd();
    const n = index + 1;
    const row = line.match(TABLE_ROW);
    if (row && row[2].trim() === "**in progress**") {
      const id = row[1].match(/\bD\d+\b/);
      if (id) inProgress.push({ line: n, deliverable: id[0] });
    }
    if (/^## /.test(line)) {
      inWindow = line === "## The window";
      inList = false;
      return;
    }
    if (!inWindow) return;
    if (line === "**Open lanes:**") {
      inList = true;
      return;
    }
    if (!inList || line === "") return;
    if (/^\s/.test(line)) {
      bad(n, line.trim());
      return;
    }
    if (!line.startsWith("- ")) {
      inList = false;
      return;
    }
    const entry = line.match(LANE_ENTRY);
    if (!entry) {
      bad(n, line);
      return;
    }
    const parts = entry[3].split(", ").map((p) => p.match(LANE_RECORD));
    if (parts.some((m) => !m || m[1] !== m[2])) {
      bad(n, line);
      return;
    }
    const records = parts.map((m) => m[1]);
    lanes.push({
      line: n,
      deliverable: entry[1],
      opened: entry[2],
      records,
      schema: entry[4] === "yes",
    });
  });
  return { lanes, malformed, inProgress };
}

/**
 * The condition two open lanes meet (ADR-0079 §1 and §3): no record belongs to
 * two of them, and at most one adds migrations — and the entries it is read
 * from are the table's `in progress` rows, one each (§2), so a list the parser
 * cannot find is a violation rather than zero lanes.
 */
export function checkLanes(file, text) {
  const violations = [];
  const push = (line, rule, found, message) =>
    violations.push({ file, line, rule, found, message });
  const { lanes, malformed, inProgress } = parseLanes(text);

  const entered = new Set();
  for (const lane of lanes) {
    if (entered.has(lane.deliverable)) {
      push(
        lane.line,
        "lane-duplicate",
        lane.deliverable,
        "a deliverable has one open-lane entry (ADR-0079 §2)",
      );
    }
    entered.add(lane.deliverable);
  }
  const open = new Set(inProgress.map((r) => r.deliverable));
  for (const row of inProgress) {
    if (!entered.has(row.deliverable)) {
      push(
        row.line,
        "lane-missing",
        row.deliverable,
        "a deliverable `in progress` has an entry under `**Open lanes:**` in the window section (ADR-0079 §2)",
      );
    }
  }
  for (const lane of lanes) {
    if (!open.has(lane.deliverable)) {
      push(
        lane.line,
        "lane-not-open",
        lane.deliverable,
        "an open-lane entry names a deliverable the table does not mark `in progress`",
      );
    }
  }

  for (const m of malformed) {
    push(
      m.line,
      "lane-malformed",
      m.text,
      "an open-lane entry reads `- **Lane [D<n>](plan)** — opened YYYY-MM-DD · records [NNNN](../adr/…), … · schema: yes|no`",
    );
  }

  const owner = new Map();
  for (const lane of lanes) {
    for (const record of new Set(lane.records)) {
      const first = owner.get(record);
      if (first && first !== lane.deliverable) {
        push(
          lane.line,
          "lane-shared-record",
          record,
          `ADR-${record} is already in ${first}'s lane; a record belongs to one open lane (ADR-0079 §1)`,
        );
      } else {
        owner.set(record, lane.deliverable);
      }
    }
  }

  const schemaLanes = lanes.filter((l) => l.schema);
  for (const lane of schemaLanes.slice(1)) {
    push(
      lane.line,
      "lane-second-schema",
      lane.deliverable,
      `${schemaLanes[0].deliverable} already owns the schema; at most one open lane adds migrations (ADR-0079 §3)`,
    );
  }

  return violations.sort((a, b) => a.line - b.line);
}

export async function scanLanes(root = repoRoot) {
  const full = path.join(root, ...LEDGER.split("/"));
  // A corpus with no ledger yet (`/bootstrap --empty` before it writes one)
  // has no lanes to check.
  if (!existsSync(full)) return { violations: [], lanes: 0 };
  const text = await readFile(full, "utf8");
  return {
    violations: checkLanes(LEDGER, text),
    lanes: parseLanes(text).lanes.length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const inherited = await scan();
  const specs = await scanSpecs();
  const lanes = await scanLanes();
  const violations = [...inherited, ...specs, ...lanes.violations];
  for (const v of violations) {
    console.error(
      `${v.file}:${v.line}  [${v.rule}] ${JSON.stringify(v.found)} — ${v.message}`,
    );
  }
  if (violations.length > 0) {
    console.error(`\n${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log("inherited documents: clean");
  console.log(
    `behaviour specs: clean (${(await specDocuments()).length} files)`,
  );
  console.log(`open lanes: disjoint (${lanes.lanes} open)`);
}
