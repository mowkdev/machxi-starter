#!/usr/bin/env node
// Checks the documents a fork inherits (ADR-0065 §5).
//
// `.claude/**` and `CLAUDE.md` travel into every fork. A fork renumbers nothing
// and re-dates everything, so a step number, a ship date or a bare record range
// in those files is inherited as somebody else's biography. Window and
// supersession state has one home — the ledger — and everywhere else links to
// it.
//
// Usage:
//   node scripts/docs-hygiene.mjs        report violations, exit 1 if any

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

async function markdownUnder(dir, base) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
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

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const violations = await scan();
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
}
