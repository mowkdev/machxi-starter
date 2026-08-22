/**
 * deliverable-verify — stage 2 of three: check what the operator decided,
 * before anything builds on it.
 *
 * Stage 1 is manual: the operator writes the ADR(s) and the build order with
 * Claude in the session. Stage 3 is `deliverable-build`, unattended. This
 * script sits between them and is read-only except for one line: it refutes
 * each ADR against the frozen ADRs, its siblings and the code as it actually
 * is; checks the plan against the ADRs (every decision implemented by a step,
 * every pending step naming ADRs that exist and a done-when that can be
 * checked); and, when nothing blocking remains, writes a verification stamp
 * into the plan file — the hash at which the decisions were verified — which
 * `deliverable-build`'s preflight requires and checks for drift.
 *
 * Invoke by scriptPath:
 *   { root, deliverable?: "D8", stamp?: true, commit?: true }
 *
 * args:
 *   root         absolute path of the checkout.
 *   deliverable  default: the first ledger row that is `planned`; pass the
 *                in-progress one to re-verify before resuming a build.
 *   stamp        default true — write the stamp when ready. false = report only.
 *   commit       default true — commit the stamp by explicit path.
 *
 * Returns { deliverable, planFile, ready, issues[], adrs[], steps[], stamp }.
 * Nothing is written unless ready && stamp. It never accepts an ADR, never
 * opens a deliverable, never edits an ADR.
 *
 * Budget: 2 readers (one Explore) + one refuter per ADR + 1 coverage check
 * + 1 stamper on haiku. Cheap, and the same check runs at a chain boundary.
 */
export const meta = {
  name: "deliverable-verify",
  description:
    "Refute a deliverable's ADRs against the frozen ADRs and the code, check the plan implements them with checkable steps, and stamp the plan when nothing blocking remains",
  whenToUse:
    "After the operator has written a deliverable's ADR(s) and build order, before deliverable-build; also what chain mode runs at a boundary",
  phases: [
    { title: "Read", detail: "plan + ADRs ∥ code facts" },
    { title: "Refute", detail: "one refuter per ADR" },
    { title: "Coverage", detail: "plan ↔ ADRs, done-whens, gating" },
    { title: "Stamp", detail: "the verification line, when ready" },
  ],
};

const root = (args && args.root) || "";
const wanted = args && args.deliverable;
const doStamp = !(args && args.stamp === false);
const doCommit = !(args && args.commit === false);
const cwdNote = root
  ? `Work in ${root} — run every command from that directory and read files only under it.`
  : "";
let agents = 0;
const spawn = (prompt, opts) => {
  agents += 1;
  return agent(`${cwdNote}\n\n${prompt}`.trim(), opts);
};
const target = wanted
  ? `deliverable ${wanted}`
  : "the FIRST ledger row whose Status is `planned`";

// ------------------------------------------------------------------ schemas

const SCOPE = {
  type: "object",
  required: [
    "deliverable",
    "title",
    "planFile",
    "status",
    "hasBuildOrder",
    "head",
    "adrs",
    "steps",
    "openMarkers",
    "definitionOfDone",
    "existingStamp",
    "scopeSummary",
  ],
  properties: {
    deliverable: { type: "string" },
    title: { type: "string" },
    planFile: { type: "string" },
    status: { type: "string" },
    hasBuildOrder: { type: "boolean" },
    head: { type: "string", description: "git rev-parse --short HEAD" },
    adrs: {
      type: "array",
      items: {
        type: "object",
        required: ["number", "file", "status", "supersedes"],
        properties: {
          number: { type: "string" },
          file: { type: "string" },
          status: { type: "string" },
          supersedes: { type: "string" },
        },
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "done", "adrs", "acceptsAdr", "doneWhen"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          done: { type: "boolean" },
          adrs: { type: "array", items: { type: "string" } },
          acceptsAdr: { type: "string" },
          doneWhen: { type: "string" },
        },
      },
    },
    openMarkers: {
      type: "array",
      items: { type: "string" },
      description:
        "sentences in the plan still saying a decision is open, an assumption unconfirmed, or 'the ADR chooses'",
    },
    definitionOfDone: { type: "array", items: { type: "string" } },
    existingStamp: {
      type: "string",
      description: "the current 'Verified for build' line, or empty",
    },
    scopeSummary: { type: "string" },
  },
};

const CODE = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["area", "fact", "evidence", "implication"],
        properties: {
          area: { type: "string" },
          fact: { type: "string" },
          evidence: { type: "string" },
          implication: { type: "string" },
        },
      },
    },
  },
};

const ISSUES = {
  type: "object",
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "where", "problem", "fix"],
        properties: {
          severity: { type: "string", enum: ["BLOCKER", "MAJOR", "MINOR"] },
          where: { type: "string" },
          problem: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
};

const GIT = {
  type: "object",
  required: ["result", "detail"],
  properties: {
    result: { type: "string", enum: ["DONE", "FAILED", "NOTHING_TO_DO"] },
    detail: { type: "string" },
  },
};

// --------------------------------------------------------------------- Read

phase("Read");

const [scope, code] = await parallel([
  () =>
    spawn(
      `Read docs/plan/README.md and resolve ${target}; read its plan file in full, docs/adr/README.md in full, and the header (status lines + first blockquote) of every ADR the plan or the index attributes to this deliverable. Run \`git rev-parse --short HEAD\`. Facts only; change nothing.
- adrs: each ADR written for this deliverable — number, file path, its Status line, and the ADR it supersedes ("" if none).
- steps: every "## Build order" step — id, title, done (struck-through heading / "**done**" / "**Closed.**"), the ADR numbers on its "**ADRs:**" line, acceptsAdr (the ADR the Gate paragraph says THIS step accepts at its head, else ""), doneWhen (the "**Done when:**" text, "" if missing).
- openMarkers: every sentence in the plan that still leaves something to decide — "the ADR chooses/decides", "assumption", "revisable", "(OPEN)", "pending operator" on a decision (not on a browser walk), "TBD".
- definitionOfDone: the items under "## Definition of done" (or the acceptance sketch if that is all there is — say so in scopeSummary).
- existingStamp: the line beginning "- Verified for build" in the plan header, or "".
- scopeSummary: 5–10 sentences.`,
      { label: "scope", phase: "Read", schema: SCOPE, effort: "medium" },
    ),
  () =>
    spawn(
      `Read the plan file of ${target} (via docs/plan/README.md) and the ADR(s) written for it, then read the CODE they describe — very thorough. Return facts with file:line evidence and the implication for the ADR or a step: claims in an ADR or the plan that the code contradicts (a file, function, schema, string or seam said to exist or not exist); rules the work will brush — a generated file under a byte-identical rule, a one-dependency package, an envelope or error shape, a lint rule; names that already exist and must not be declared twice; what a step's done-when would actually need to observe. Facts, not opinions. Change nothing.`,
      {
        label: "code-scout",
        phase: "Read",
        schema: CODE,
        agentType: "Explore",
      },
    ),
]);

if (!scope) return { ready: false, error: "scope agent unavailable", agents };
const findings = code ? code.findings : [];
const findingsText = findings.length
  ? findings
      .map((f) => `- ${f.area}: ${f.fact} [${f.evidence}] → ${f.implication}`)
      .join("\n")
  : "- none";
log(
  `${scope.deliverable} (${scope.status}) at ${scope.head}: ${scope.adrs.length} ADR(s), ${scope.steps.length} step(s), ${scope.openMarkers.length} open marker(s), ${findings.length} code fact(s)`,
);

// ------------------------------------------------------------------- Refute

phase("Refute");

const adrIssues = (
  await parallel(
    scope.adrs.map(
      (a) => () =>
        spawn(
          `Refute ${a.file} (ADR-${a.number}, ${a.status}${a.supersedes ? `, supersedes ADR-${a.supersedes}` : ""}) as a record the build is about to rely on. Read it fully, then docs/adr/README.md, ADR-0024 and ADR-0025, every ADR it cites, and the other ADR(s) of this deliverable: ${
            scope.adrs
              .filter((o) => o.number !== a.number)
              .map((o) => o.file)
              .join(", ") || "none"
          }.

Report issues, ranked. BLOCKER: it changes what a frozen ADR decided without superseding it (ADR-0024 rule 1) — or claims to supersede and does not carry the whole parent decision; it contradicts a sibling ADR of this deliverable; a code fact below shows a claim in it is false in a way a step would build on. MAJOR: a decision it leaves to "the builder", "later" or "TBD" that a step will need; an alternative dismissed on a false premise; the header block, status or index row out of the house format; a consequence the builder will hit that it does not state. MINOR: voice, a cross-reference, precision.

CODE FACTS:
${findingsText}

Empty array if it stands. Quote the sentence for every issue.`,
          {
            label: `refute:${a.number}`,
            phase: "Refute",
            schema: ISSUES,
            agentType: "adr-reviewer",
          },
        ),
    ),
  )
)
  .filter(Boolean)
  .flatMap((r) => r.issues);

// ----------------------------------------------------------------- Coverage

phase("Coverage");

const coverage = await spawn(
  `Coverage check of ${scope.planFile} against its ADR(s) ${scope.adrs.map((a) => "ADR-" + a.number).join(", ") || "(none written!)"} — read both in full, read-only. Report issues, ranked:
BLOCKER: no ADR written for the deliverable while the scope names decisions; a pending step naming an ADR that does not exist in docs/adr/; a pending step with no "**ADRs:**" line (a step titled Close-out is exempt) or no "**Done when:**"; a pending step gated on a \`proposed\` ADR that neither it nor an earlier pending step accepts at its head; an open marker left in the plan — these: ${scope.openMarkers.map((m) => `"${m}"`).join("; ") || "none"}.
MAJOR: a decision an ADR makes that no step implements (list the decision); a done-when that cannot be checked by a machine or by a named browser walk ("works well", "is clean"); a definition-of-done item that is not executable or operator-acceptable as written; a step whose scope plainly needs more than one agent sitting (touches more than ~2 apps/packages or more than one ADR's worth of surface) — recommend the split.
MINOR: ordering rationale missing; a step that names an ADR it does not use.

STEPS:
${scope.steps.map((s) => `- ${s.id} ${s.done ? "(done)" : "(pending)"} ADRs [${s.adrs.join(", ")}] accepts ${s.acceptsAdr || "—"}; done when: ${s.doneWhen || "(missing)"}`).join("\n")}

DEFINITION OF DONE:
${scope.definitionOfDone.map((d) => `- ${d}`).join("\n") || "- (missing)"}

CODE FACTS a step must respect:
${findingsText}

Empty array if the plan covers its ADRs.`,
  { label: "coverage", phase: "Coverage", schema: ISSUES, effort: "medium" },
);

const issues = adrIssues.concat(coverage ? coverage.issues : []);
const blocking = issues.filter((i) => i.severity !== "MINOR");
const ready =
  blocking.length === 0 &&
  scope.hasBuildOrder &&
  scope.adrs.length > 0 &&
  (scope.status === "planned" || scope.status === "in progress");
log(`${issues.length} issue(s), ${blocking.length} blocking — ready=${ready}`);

// -------------------------------------------------------------------- Stamp

phase("Stamp");

let stamp = null;
if (ready && doStamp) {
  const line = `- Verified for build: **2026-08-22 at ${scope.head}** — deliverable-verify: ${scope.adrs.length} ADR(s), ${issues.length} minor issue(s), 0 blocking`;
  const written = await spawn(
    `In ${scope.planFile}, put this line into the header bullet list (the "- Status / - Steps / - Ledger" list at the top), replacing any existing line that begins "- Verified for build", else as the last bullet of that list. Change nothing else. Then \`pnpm exec prettier --write ${scope.planFile}\`.${doCommit ? ` Then \`git add ${scope.planFile}\` and commit with exactly this message via a heredoc:\n\ndocs(plan): ${scope.deliverable} verified for build\n\ndeliverable-verify at ${scope.head}: ${scope.adrs.length} ADR(s) refuted against the frozen ADRs and the code, the plan checked against them, ${issues.length} minor issue(s), nothing blocking.\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>\n\nDONE with the short hash.` : " Do not commit; return DONE."} FAILED with the output if anything refuses.

THE LINE:
${line}`,
    {
      label: "stamp",
      phase: "Stamp",
      schema: GIT,
      model: "haiku",
      effort: "low",
      agentType: "general-purpose",
    },
  );
  stamp = {
    line,
    head: scope.head,
    result: written ? written.result : "unavailable",
    detail: written ? written.detail : "",
  };
}

return {
  deliverable: scope.deliverable,
  planFile: scope.planFile,
  status: scope.status,
  head: scope.head,
  ready,
  issues,
  adrs: scope.adrs,
  steps: scope.steps.map(({ id, title, done, adrs }) => ({
    id,
    title,
    done,
    adrs,
  })),
  stamp,
  agents,
};
