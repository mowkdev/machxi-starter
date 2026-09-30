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
// Each open lane is a file under `docs/plan/lanes/` (ADR-0082 §4, a delta on
// ADR-0079 §2), and two lanes may not share a record or both add migrations
// (ADR-0079 §1, §3); each carries the tier its plan names (ADR-0082 §5). The
// ledger itself is not an inherited document — it is this repository's
// journal and carries dates by design — so only its table's `in progress`
// rows, the block `pnpm lanes` generates into its window section, and the one
// header line naming the tag prefix `/ship` writes (ADR-0081 §5) are read.
//
// A plan carries no close-out step (ADR-0082 §2): its last step builds, and
// `/ship` runs the definition of done. Plans scoped or shipped by the day the
// record withdrew the close-out are exempt by that date.
//
// Usage:
//   node scripts/docs-hygiene.mjs        report violations, exit 1 if any

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  LANES_DIR,
  LANE_SHAPE,
  LEDGER,
  TIERS,
  findBlock,
  parseLaneFile,
  readLaneFiles,
  renderLanes,
} from "./lanes.mjs";

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

/** The ledger whose window section links the open lanes (ADR-0079 §2). */
export { LEDGER };

/** `| [D30](…) | Title | **in progress** | …` — a ledger row that is open. */
const TABLE_ROW = /^\|([^|]+)\|[^|]*\|([^|]+)\|/;

/** `- Tier: package (…)` — the tier a plan's header names (ADR-0082 §5). */
const PLAN_TIER = /^- Tier: (\S+)/;

/**
 * The tier a plan's header names, or `null`: the first `- Tier:` line above
 * the plan's first section.
 */
export function planTier(text) {
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("## ")) break;
    const m = raw.match(PLAN_TIER);
    if (m) return m[1];
  }
  return null;
}

/**
 * Reads the open lanes out of their files under `docs/plan/lanes/`
 * (ADR-0082 §4, a delta on ADR-0079 §2), and the deliverables the ledger's
 * table marks `in progress`. A file that does not parse is returned as
 * `malformed` rather than dropped, so a typo cannot hide a lane or a record
 * from the check. `laneFiles` is `[{ rel, name, text }]`, as
 * `readLaneFiles` returns them.
 */
export function parseLanes(ledgerText, laneFiles) {
  const lanes = [];
  const malformed = [];
  const inProgress = [];
  const rows = new Set();
  ledgerText.split(/\r?\n/).forEach((raw, index) => {
    const row = raw.trimEnd().match(TABLE_ROW);
    const id = row?.[1].match(/\bD\d+\b/);
    if (!id) return;
    rows.add(id[0]);
    if (row[2].trim() === "**in progress**") {
      inProgress.push({ line: index + 1, deliverable: id[0] });
    }
  });
  for (const file of laneFiles) {
    const parsed = parseLaneFile(file.name, file.text);
    if (parsed.lane) lanes.push({ ...parsed.lane, file: file.rel });
    for (const m of parsed.malformed ?? []) {
      malformed.push({ file: file.rel, ...m });
    }
  }
  return { lanes, malformed, inProgress, rows };
}

/**
 * The condition open lanes meet (ADR-0079 §1 and §3, ADR-0082 §4 and §5): no
 * record belongs to two of them, at most one adds migrations, each carries the
 * tier its plan names, the table's `in progress` rows and the files are one
 * each, and the list and running paragraph the window section carries are
 * what `pnpm lanes` renders from the files.
 *
 * `readPlan(rel)` returns a plan's text by its path under `docs/plan/`, or
 * `null`; injected so the cases can run against text alone.
 */
export function checkLanes({ ledger, laneFiles, readPlan }) {
  const violations = [];
  const push = (file, line, rule, found, message) =>
    violations.push({ file, line, rule, found, message });
  const { lanes, malformed, inProgress, rows } = parseLanes(ledger, laneFiles);

  for (const m of malformed) {
    push(m.file, m.line, "lane-malformed", m.found, `${m.why}; ${LANE_SHAPE}`);
  }

  const open = new Set(inProgress.map((r) => r.deliverable));
  const entered = new Set(lanes.map((l) => l.deliverable));
  // A file that did not parse still names its deliverable, so its row is not
  // also reported missing a lane.
  for (const m of malformed) {
    const id = m.file.match(/\/(D\d+)\.md$/);
    if (id) entered.add(id[1]);
  }
  for (const row of inProgress) {
    if (!entered.has(row.deliverable)) {
      push(
        LEDGER,
        row.line,
        "lane-missing",
        row.deliverable,
        `a deliverable \`in progress\` has a lane file, \`${LANES_DIR}/${row.deliverable}.md\` (ADR-0082 §4)`,
      );
    }
  }
  // A lane file for a deliverable the ledger has no row for is another
  // repository's: in a fork, one the starter merge added, since a merge takes a
  // file added on one side without consulting any driver (docs/forking.md §5).
  const foreign = lanes.filter((l) => !rows.has(l.deliverable));
  for (const lane of foreign) {
    push(
      lane.file,
      lane.fields.Deliverable,
      "lane-foreign",
      lane.deliverable,
      "a lane file for a deliverable this ledger has no row for — in a fork, one the starter merge brought; `git rm` it rather than running `pnpm lanes` (docs/forking.md §5)",
    );
  }
  for (const lane of lanes) {
    if (rows.has(lane.deliverable) && !open.has(lane.deliverable)) {
      push(
        lane.file,
        lane.fields.Deliverable,
        "lane-not-open",
        lane.deliverable,
        "a lane file names a deliverable the ledger's table does not mark `in progress`",
      );
    }
  }

  const owner = new Map();
  for (const lane of [...lanes].sort(
    (a, b) => Number(a.deliverable.slice(1)) - Number(b.deliverable.slice(1)),
  )) {
    for (const record of new Set(lane.records.map((r) => r.id))) {
      const first = owner.get(record);
      if (first && first !== lane.deliverable) {
        push(
          lane.file,
          lane.fields.Records,
          "lane-shared-record",
          record,
          `ADR-${record} is already in ${first}'s lane; a record belongs to one open lane (ADR-0079 §1)`,
        );
      } else {
        owner.set(record, lane.deliverable);
      }
    }
  }

  const schemaLanes = lanes
    .filter((l) => l.schema)
    .sort(
      (a, b) => Number(a.deliverable.slice(1)) - Number(b.deliverable.slice(1)),
    );
  for (const lane of schemaLanes.slice(1)) {
    push(
      lane.file,
      lane.fields.Schema,
      "lane-second-schema",
      lane.deliverable,
      `${schemaLanes[0].deliverable} already owns the schema; at most one open lane adds migrations (ADR-0079 §3)`,
    );
  }

  for (const lane of lanes) {
    const plan = readPlan(lane.plan);
    if (plan === null) {
      push(
        lane.file,
        lane.fields.Deliverable,
        "lane-plan-missing",
        lane.plan,
        "a lane file links its deliverable's plan, which exists",
      );
      continue;
    }
    const named = planTier(plan);
    if (named !== lane.tier) {
      push(
        lane.file,
        lane.fields.Tier,
        "lane-tier",
        lane.tier,
        named === null
          ? `the plan names no tier; its header carries \`- Tier: ${TIERS.join(" | ")}\` (ADR-0082 §5)`
          : `the plan names tier \`${named}\`; a lane carries the tier its plan names (ADR-0082 §5)`,
      );
    } else if ((lane.tier === "schema") !== lane.schema) {
      push(
        lane.file,
        lane.fields.Tier,
        "lane-tier",
        lane.tier,
        "the `schema` tier is the lane that adds migrations, `Schema: yes`, and no other (ADR-0082 §5)",
      );
    }
  }

  // The generated list and running paragraph (ADR-0082 §4). Not compared
  // while a file does not parse or is foreign: that file's violation is the
  // one to fix, and `pnpm lanes` would write a foreign lane into the block.
  if (malformed.length === 0 && foreign.length === 0) {
    const found = findBlock(ledger);
    const expected = renderLanes(lanes);
    const at = (offset) => ledger.slice(0, offset).split("\n").length;
    if (found === null) {
      if (lanes.length > 0 || inProgress.length > 0) {
        push(
          LEDGER,
          1,
          "lanes-stale",
          "",
          "the window section carries the block `pnpm lanes` writes, between its two markers (ADR-0082 §4)",
        );
      }
    } else if (found.error) {
      push(LEDGER, at(found.start ?? 0), "lanes-stale", "", found.error);
    } else if (found.block !== expected) {
      push(
        LEDGER,
        at(found.start),
        "lanes-stale",
        found.block.split("\n")[2]?.slice(0, 60) ?? "",
        "the open lanes and the running paragraph are stale; run `pnpm lanes` (ADR-0082 §4)",
      );
    }
  }

  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}

/** How many open lanes carry each tier (ADR-0082 §5). */
export function countTiers(lanes) {
  return Object.fromEntries(
    TIERS.map((tier) => [tier, lanes.filter((l) => l.tier === tier).length]),
  );
}

/**
 * `Tag prefix: \`starter\`` — the one line of the ledger's header `/ship`
 * reads to name a deliverable's tag, `<prefix>-D<n>` (ADR-0081 §5). A prefix
 * is a lowercase name a git ref accepts; the line stands alone, so a reader
 * and a script see the same fact. It never opens with `v` and a digit: a tag
 * such as `v2-D1` matches `v[0-9]*`, the pattern a build derives its release
 * label from (ADR-0081 §4), and the two namespaces would meet.
 */
export const TAG_PREFIX_LINE = /^Tag prefix: `((?!v\d)[a-z][a-z0-9-]*)`$/;

/**
 * Reads the tag prefix out of the ledger's header — every line above the
 * table and the first section. A line in the header that opens `Tag prefix`
 * but does not parse is returned as `malformed`, so a typo reads as a wrong
 * line rather than as a missing one.
 */
export function parseTagPrefix(text) {
  const prefixes = [];
  const malformed = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    if (line.startsWith("|") || line.startsWith("## ")) break;
    if (!/^tag prefix\b/i.test(line)) continue;
    const m = line.match(TAG_PREFIX_LINE);
    if (m) prefixes.push({ line: index + 1, prefix: m[1] });
    else malformed.push({ line: index + 1, text: line.slice(0, 60) });
  }
  return { prefixes, malformed };
}

/** The ledger names the one prefix `/ship` tags with (ADR-0081 §5). */
export function checkTagPrefix(file, text) {
  const violations = [];
  const { prefixes, malformed } = parseTagPrefix(text);
  for (const m of malformed) {
    violations.push({
      file,
      line: m.line,
      rule: "tag-prefix-malformed",
      found: m.text,
      message:
        "the tag prefix line reads `Tag prefix: `<name>`` — a lowercase name, alone on its line (ADR-0081 §5)",
    });
  }
  if (prefixes.length === 0 && malformed.length === 0) {
    violations.push({
      file,
      line: 1,
      rule: "tag-prefix-missing",
      found: "",
      message:
        "the ledger's header names the tag prefix `/ship` writes, as `Tag prefix: `<name>`` (ADR-0081 §5)",
    });
  }
  for (const extra of prefixes.slice(1)) {
    violations.push({
      file,
      line: extra.line,
      rule: "tag-prefix-duplicate",
      found: extra.prefix,
      message: `the ledger already names \`${prefixes[0].prefix}\`; it names one tag prefix (ADR-0081 §5)`,
    });
  }
  return violations;
}

/**
 * The union-merged journal (ADR-0082 §4 as amended): the changelog and the
 * notes merge by `union`, which keeps both sides of a collision without a
 * conflict. Two lanes editing one passage leave it twice, so a heading, the
 * title or a preamble paragraph that repeats is refused. Fenced code is not
 * read. `level` is the deepest heading checked: 2 for the changelog, 3 for a
 * notes file.
 */
export function checkUnionJournal(file, text, { level }) {
  const violations = [];
  const seen = new Map();
  const heading = new RegExp(`^(#{1,${level}}) \\S`);
  let fenced = false;
  let preamble = true;
  let paragraphStart = true;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    let key = null;
    if (heading.test(line)) {
      key = line;
      if (line.startsWith("## ")) preamble = false;
    } else if (preamble && paragraphStart && line !== "" && level === 2) {
      // A preamble paragraph, by its opening 40 characters: a copy two lanes
      // edited apart past them still repeats it.
      key = `preamble: ${line.slice(0, 40)}`;
    }
    paragraphStart = line === "";
    if (key === null) continue;
    if (seen.has(key)) {
      violations.push({
        file,
        line: index + 1,
        rule: "union-duplicate",
        found: line.slice(0, 60),
        message: `repeats line ${seen.get(key)}; this file merges by union, so its existing text is edited only by the lane that ships (ADR-0082 §4)`,
      });
    } else {
      seen.set(key, index + 1);
    }
  }
  return violations;
}

export const CHANGELOG = "docs/CHANGELOG.md";

export async function scanUnionJournal(root = repoRoot) {
  const violations = [];
  const changelog = path.join(root, ...CHANGELOG.split("/"));
  if (existsSync(changelog)) {
    const text = await readFile(changelog, "utf8");
    violations.push(...checkUnionJournal(CHANGELOG, text, { level: 2 }));
  }
  const plan = path.join(root, "docs", "plan");
  const names = existsSync(plan) ? await readdir(plan) : [];
  for (const name of names.filter((n) => n.endsWith(".notes.md")).sort()) {
    const text = await readFile(path.join(plan, name), "utf8");
    violations.push(
      ...checkUnionJournal(`docs/plan/${name}`, text, { level: 3 }),
    );
  }
  return violations;
}

/**
 * The day ADR-0082 §2 withdrew the close-out step: a deliverable's last step
 * builds, and what a close-out carried — the routed residuals, the skills and
 * rule files, the digests, the definition of done — is the last build step's
 * done-when or `/ship`'s. A plan scoped or shipped on or before this day is
 * exempt by its date; D34 was scoped with one before the record withdrew it
 * and keeps it as the last.
 */
export const CLOSE_OUT_WITHDRAWN = "2026-09-30";

/** `- [ ] **6. Close-out — the last one.**` — a step line and its title. */
const STEP_LINE = /^- \[[ xX]\] \*\*(\d+)\.\s*(.*?)\*\*/;
/**
 * A title that is a close-out: it opens with the word, as `Close-out.` and
 * `Close-out — the last one.` do. A title that only mentions one — a fork's
 * "Shift close-out report" — builds; a step that is the checklist under
 * another name is caught by its done-when.
 */
const CLOSE_OUT_TITLE = /^close[- ]?out\b/i;
/** `**Done when:** the definition of done …` — a step that is the checklist. */
const DONE_WHEN_DOD = /\*\*Done when:\*\*\s*the definition of done\b/i;
/** `scoped in full 2026-09-14` — the plan's own scoping date. */
const SCOPED_DATE = /\bscoped(?: in full)?\*{0,2}\s+(\d{4}-\d{2}-\d{2})\b/;
/** `- Status: **shipped 2026-09-21**` — a shipped plan's date, leading its line. */
const SHIPPED_DATE = /^- Status: \**shipped\s+(\d{4}-\d{2}-\d{2})\b/;

/**
 * The date a plan gives itself, or `null`, read from its header's `- Status:`
 * line alone: the `scoped` date `/scope` writes there, else the `shipped`
 * date that leads a shipped plan's line. Any other date — another
 * deliverable's ship cited in passing, a row inserted — says nothing about
 * when this plan was written, so it can neither exempt a plan nor date one.
 */
export function planDate(text) {
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith("## ")) break;
    if (!raw.startsWith("- Status:")) continue;
    return raw.match(SCOPED_DATE)?.[1] ?? raw.match(SHIPPED_DATE)?.[1] ?? null;
  }
  return null;
}

/**
 * A plan carries no close-out step (ADR-0082 §2): no step whose title is a
 * close-out, and none whose done-when is the definition of done, which
 * `/ship` runs. A plan dated on or before `CLOSE_OUT_WITHDRAWN` is exempt.
 */
export function checkCloseOut(file, text) {
  const date = planDate(text);
  if (date !== null && date <= CLOSE_OUT_WITHDRAWN) {
    return { exempt: true, violations: [] };
  }
  const violations = [];
  let step = null;
  const flag = (why) => {
    if (step.flagged) return;
    step.flagged = true;
    violations.push({
      file,
      line: step.line,
      rule: "close-out-step",
      found: `${step.number}. ${step.title}`.slice(0, 60),
      message: `${why}; a plan has no close-out step — what one carried goes in the last build step's done-when and in \`/ship\` (ADR-0082 §2)`,
    });
  };
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (raw.startsWith("## ")) {
      step = null;
      continue;
    }
    const m = raw.match(STEP_LINE);
    if (m) {
      step = { line: index + 1, number: m[1], title: m[2], flagged: false };
      if (CLOSE_OUT_TITLE.test(m[2])) flag("a step titled as a close-out");
    }
    if (step && DONE_WHEN_DOD.test(raw)) {
      flag("a step whose done-when is the definition of done");
    }
  }
  return { exempt: false, violations };
}

/** A plan file under `docs/plan/`: `NNNN-slug.md`, never its notes. */
const PLAN_FILE = /^\d{4}-[^/]+(?<!\.notes)\.md$/;

export async function scanCloseOut(root = repoRoot) {
  const dir = path.join(root, "docs", "plan");
  const names = existsSync(dir) ? await readdir(dir) : [];
  const violations = [];
  let exempt = 0;
  for (const name of names.filter((n) => PLAN_FILE.test(n)).sort()) {
    const text = await readFile(path.join(dir, name), "utf8");
    const result = checkCloseOut(`docs/plan/${name}`, text);
    if (result.exempt) exempt += 1;
    violations.push(...result.violations);
  }
  return { violations, exempt };
}

export async function scanLanes(root = repoRoot) {
  const full = path.join(root, ...LEDGER.split("/"));
  // A corpus with no ledger yet (`/bootstrap --empty` before it writes one)
  // has no lanes to check.
  if (!existsSync(full)) return { violations: [], lanes: [] };
  const ledger = await readFile(full, "utf8");
  const laneFiles = await readLaneFiles(root);
  const plans = new Map();
  for (const name of await readdir(path.join(root, "docs", "plan"))) {
    if (name.endsWith(".md")) {
      plans.set(
        name,
        await readFile(path.join(root, "docs", "plan", name), "utf8"),
      );
    }
  }
  return {
    violations: checkLanes({
      ledger,
      laneFiles,
      readPlan: (rel) => plans.get(rel) ?? null,
    }),
    lanes: parseLanes(ledger, laneFiles).lanes,
  };
}

// ---------------------------------------------------------------------------
// Relative links in the carried documents (ADR-0084, fork readiness).
//
// The non-record documents a fork carries — `README.md`, `docs/*.md`,
// `docs/specs/**`, `docs/rules/**` and `.claude/**` — must not link to a file
// that is not there. A fork's bootstrap removes the starter's plans, so a link
// from one of them into a starter plan would break on day one. Records
// (`docs/adr/*.md`) are history: their links into plans are read at
// `starter/main` and are not checked here. Links are resolved relative to the
// file that holds them — a skill's links relative to its `SKILL.md`.

/** True for a repo-relative path whose relative links this check reads. */
export function isCarriedLinkDocument(rel) {
  if (isExcluded(rel) || !rel.endsWith(".md")) return false;
  if (rel === "README.md") return true;
  if (/^docs\/[^/]+\.md$/.test(rel)) return true;
  return (
    rel.startsWith("docs/specs/") ||
    rel.startsWith("docs/rules/") ||
    rel.startsWith(".claude/")
  );
}

// `](target)` or `](target "title")`; an image's `![..](..)` matches too.
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const FENCE = /^\s*(```|~~~)/;
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

/**
 * Broken relative links in one carried document. `exists(relPath)` answers
 * for a repo-relative, POSIX-separated path. Fenced code is not read, nor is
 * inline code; a target is split from its `#anchor` and `?query`.
 */
export function checkLinks(file, text, exists) {
  const violations = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const prose = line.replace(/`[^`]*`/g, "");
    for (const match of prose.matchAll(MARKDOWN_LINK)) {
      const target = match[1];
      if (NOT_RELATIVE.test(target)) continue;
      const bare = decodeURI(target.split(/[#?]/)[0]);
      if (bare === "") continue;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), bare),
      );
      if (resolved.startsWith("../") || !exists(resolved.replace(/\/$/, ""))) {
        violations.push({
          file,
          line: index + 1,
          rule: "broken-link",
          found: target,
          message: "a relative link to a file that is not there",
        });
      }
    }
  });
  return violations;
}

async function carriedLinkDocuments(root) {
  const files = [
    ...(await markdownUnder(path.join(root, ".claude"), ".claude")),
    ...(await markdownUnder(path.join(root, "docs"), "docs")),
  ];
  if (existsSync(path.join(root, "README.md"))) {
    files.push({ full: path.join(root, "README.md"), rel: "README.md" });
  }
  return files
    .filter(({ rel }) => isCarriedLinkDocument(rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function scanLinks(root = repoRoot) {
  const exists = (rel) => existsSync(path.join(root, ...rel.split("/")));
  const documents = await carriedLinkDocuments(root);
  const violations = [];
  for (const { full, rel } of documents) {
    violations.push(...checkLinks(rel, await readFile(full, "utf8"), exists));
  }
  return { violations, documents: documents.length };
}

export async function scanTagPrefix(root = repoRoot) {
  const full = path.join(root, ...LEDGER.split("/"));
  // No ledger yet, no prefix to name: `/bootstrap` writes both together.
  if (!existsSync(full)) return { violations: [], prefix: null };
  const text = await readFile(full, "utf8");
  return {
    violations: checkTagPrefix(LEDGER, text),
    prefix: parseTagPrefix(text).prefixes[0]?.prefix ?? null,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const inherited = await scan();
  const specs = await scanSpecs();
  const lanes = await scanLanes();
  const tagPrefix = await scanTagPrefix();
  const unionJournal = await scanUnionJournal();
  const closeOut = await scanCloseOut();
  const links = await scanLinks();
  const violations = [
    ...inherited,
    ...specs,
    ...lanes.violations,
    ...tagPrefix.violations,
    ...unionJournal,
    ...closeOut.violations,
    ...links.violations,
  ];
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
  const tiers = Object.entries(countTiers(lanes.lanes))
    .filter(([, n]) => n > 0)
    .map(([tier, n]) => `${tier} ${n}`);
  console.log(
    `open lanes: disjoint, generated block current (${lanes.lanes.length} open${tiers.length > 0 ? `; ${tiers.join(", ")}` : ""})`,
  );
  if (tagPrefix.prefix) console.log(`tag prefix: ${tagPrefix.prefix}`);
  console.log("union journal: no passage twice");
  console.log(`carried links: none broken (${links.documents} documents)`);
  console.log(
    `close-out steps: none (${closeOut.exempt} plan(s) exempt by date)`,
  );
}
