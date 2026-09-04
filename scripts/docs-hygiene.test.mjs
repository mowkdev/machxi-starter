import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LEDGER_WINDOW,
  checkSpec,
  checkText,
  inheritedDocuments,
  scan,
  scanSpecs,
  specDocuments,
} from "./docs-hygiene.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("CLAUDE.md stays under 6 KB", async () => {
  // Every session pays for this file. It carries rules, commands, the repo map,
  // search and workflow — no window history and no supersession chronology.
  const { size } = await stat(path.join(repoRoot, "CLAUDE.md"));
  assert.ok(size < 6 * 1024, `CLAUDE.md is ${size} bytes`);
});

const rules = (violations) => violations.map((v) => v.rule);

test("the documents a fork inherits are clean", async () => {
  const violations = await scan();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
});

test("the scan covers .claude/** and the always-loaded summary", async () => {
  const files = (await inheritedDocuments()).map((f) => f.rel);
  assert.ok(files.includes("CLAUDE.md"));
  assert.ok(files.includes(".claude/README.md"));
  assert.ok(files.some((f) => f.startsWith(".claude/rules/")));
  assert.ok(files.some((f) => f.startsWith(".claude/agents/")));
  assert.ok(files.some((f) => f.startsWith(".claude/skills/")));
});

// The behaviour specs (ADR-0068 §1): the real ones are clean, the scan
// reaches them, and each shape rule fires on the text it exists for.
test("the behaviour specs are clean", async () => {
  const violations = await scanSpecs();
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.found}`),
    [],
  );
});

test("the spec scan covers docs/specs and skips its README", async () => {
  const files = (await specDocuments()).map((f) => f.rel);
  assert.ok(files.length > 0);
  assert.ok(files.every((f) => f.startsWith("docs/specs/")));
  assert.ok(!files.includes("docs/specs/README.md"));
});

const always = () => true;
const never = () => false;

const SPEC = `# X

## Requirement: A thing
It answers.
Records: [ADR-0012](../adr/0012-response-envelope.md)
Proved by: \`apps/api/test/envelope.int.test.ts\`

### Scenario: The case
- **WHEN** a client asks
- **THEN** it answers
`;

test("a well-formed spec passes", () => {
  assert.deepEqual(rules(checkSpec("s.md", SPEC, always)), []);
});

test("a requirement without a scenario is caught", () => {
  const text = SPEC.replace(/### Scenario:[\s\S]*$/, "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-no-scenario",
  ]);
});

test("a scenario without a THEN is caught", () => {
  const text = SPEC.replace("- **THEN** it answers\n", "");
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-scenario-shape",
  ]);
});

test("a record or a test that does not exist is caught", () => {
  assert.deepEqual(rules(checkSpec("s.md", SPEC, never)), [
    "spec-record-missing",
    "spec-test-missing",
  ]);
});

test("a requirement with no Records: or Proved by: line is caught", () => {
  const text = SPEC.replace(/^Records:.*\n/m, "").replace(
    /^Proved by:.*\n/m,
    "",
  );
  assert.deepEqual(rules(checkSpec("s.md", text, always)), [
    "spec-record-missing",
    "spec-test-missing",
  ]);
});

test("a file with no requirement is caught", () => {
  assert.deepEqual(rules(checkSpec("s.md", "# Empty\n", always)), [
    "spec-empty",
  ]);
});

// The negative cases: each rule must actually fire on the text it exists for,
// or "clean" above means only that nothing was checked.
test("a step number is caught", () => {
  assert.deepEqual(rules(checkText("f.md", "Accepted at `D14.12`'s head.")), [
    "step-reference",
  ]);
});

test("a date is caught", () => {
  assert.deepEqual(
    rules(checkText("f.md", "Shipped 2026-09-02 with the ledger row.")),
    ["date"],
  );
});

test("a bare record range is caught", () => {
  assert.deepEqual(rules(checkText("f.md", "Condensed from ADRs 0030–0054.")), [
    "bare-range",
  ]);
  assert.deepEqual(rules(checkText("f.md", "ADRs 0001-0058 are frozen.")), [
    "bare-range",
  ]);
});

test("a window statement that does not link to the ledger is caught", () => {
  assert.deepEqual(
    rules(
      checkText("f.md", "The D14 window is open over the starter records."),
    ),
    ["unlinked-window"],
  );
  assert.deepEqual(rules(checkText("f.md", "No amendment window is open.")), [
    "unlinked-window",
  ]);
});

test("a window statement that links to the ledger passes", () => {
  assert.deepEqual(
    rules(
      checkText(
        "f.md",
        `Which window is open is stated in [the ledger](../docs/${LEDGER_WINDOW}).`,
      ),
    ),
    [],
  );
});

test("the window rule does not fire on the ordinary word", () => {
  assert.deepEqual(
    rules(checkText("f.md", "kept only for the grace window, then discarded")),
    [],
  );
  assert.deepEqual(
    rules(checkText("f.md", "Clear `window.localStorage` between tests.")),
    [],
  );
});

test("the placeholders the skills teach are not violations", () => {
  assert.deepEqual(
    rules(
      checkText("f.md", "Label it `**Amended YYYY-MM-DD (D<n>.<step>).**`"),
    ),
    [],
  );
  assert.deepEqual(
    rules(checkText("f.md", "The row moves to `shipped YYYY-MM-DD`.")),
    [],
  );
});
