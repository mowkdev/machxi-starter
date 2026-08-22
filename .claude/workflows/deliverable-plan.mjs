/**
 * deliverable-plan — an ASSISTANT for stage 1, not part of the pipeline.
 *
 * The loop is: (1) the operator writes the ADR(s) and build order by hand,
 * with Claude in the session; (2) `deliverable-verify` checks them and
 * stamps the plan; (3) `deliverable-build` runs on the stamp. This script
 * helps with (1) only. `analyze` turns a planned deliverable into the exact
 * questions an ADR must answer, with the code facts behind them — the right
 * opener for the session that writes the ADRs. `draft` and `open` remain for
 * an operator who wants them, but nothing downstream calls them:
 * `deliverable-build` never drafts and opens through the verify stamp.
 *
 * Invoke by scriptPath:
 *   { mode: "analyze", root, deliverable? }
 *   { mode: "draft",   root, analysis: <analyze result>, answers: { [q.id]: text } }
 *   { mode: "open",    root, deliverable }
 *
 * args:
 *   root         absolute path of the checkout (worktree when unattended).
 *   deliverable  "D8"; default: the first ledger row whose status is planned.
 *   commit       default true; by explicit path only.
 *
 * Invariants: analyze writes nothing; draft leaves the plan `planned`; open
 * refuses anything undecided and never accepts an ADR (the first step's
 * builder does, ADR-0025 rule 3).
 *
 * Budget: analyze 3 agents (one on the cheap tier); draft 2 per ADR + 3;
 * open 2. The expensive judgement — writing and refuting an ADR — is the only
 * place the strong tier is spent.
 */
export const meta = {
  name: "deliverable-plan",
  description:
    "Analyse a planned deliverable into the operator's questions; with answers, draft its ADR(s) and build order (refuted before landing) without opening; open mechanically when decided",
  whenToUse:
    "At the desk, before an unattended run reaches the next deliverable: /plan-deliverable D8",
  phases: [
    { title: "Analyze", detail: "scope + ADR index ∥ code facts" },
    { title: "Gaps", detail: "questions with a recommended answer each" },
    { title: "Draft", detail: "ADR(s) proposed, build order written" },
    {
      title: "Verify",
      detail: "each ADR refuted against the answers and the frozen ADRs",
    },
    { title: "Open", detail: "ledger flipped, mechanically" },
  ],
};

const mode = (args && args.mode) || "analyze";
const root = (args && args.root) || "";
const wanted = args && args.deliverable;
const doCommit = !(args && args.commit === false);
const cwdNote = root
  ? `Work in ${root} — run every command from that directory and read/write files only under it.`
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
    "hasBuildOrder",
    "decisions",
    "assumptions",
    "existingAdrs",
    "nextAdrNumber",
    "scopeSummary",
  ],
  properties: {
    deliverable: { type: "string" },
    title: { type: "string" },
    planFile: { type: "string" },
    hasBuildOrder: { type: "boolean" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "text", "decidedBy"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          decidedBy: { type: "string" },
        },
      },
    },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "text", "confirmed"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          confirmed: { type: "boolean" },
        },
      },
    },
    existingAdrs: {
      type: "array",
      items: {
        type: "object",
        required: ["number", "title", "status", "decides"],
        properties: {
          number: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
          decides: { type: "string" },
        },
      },
    },
    nextAdrNumber: { type: "string" },
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

const GAPS = {
  type: "object",
  required: ["questions", "adrsNeeded", "notes"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "header", "question", "options", "why"],
        properties: {
          id: { type: "string" },
          header: { type: "string" },
          question: { type: "string" },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: {
              type: "object",
              required: ["label", "description", "recommended"],
              properties: {
                label: { type: "string" },
                description: { type: "string" },
                recommended: { type: "boolean" },
              },
            },
          },
          why: { type: "string" },
        },
      },
    },
    adrsNeeded: {
      type: "array",
      items: {
        type: "object",
        required: ["number", "slug", "title", "decides", "supersedes"],
        properties: {
          number: { type: "string" },
          slug: { type: "string" },
          title: { type: "string" },
          decides: { type: "array", items: { type: "string" } },
          supersedes: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
};

const WRITTEN = {
  type: "object",
  required: ["files", "summary"],
  properties: {
    files: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
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
const OPENED = {
  type: "object",
  required: ["opened", "files", "summary"],
  properties: {
    opened: { type: "boolean" },
    files: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

// ------------------------------------------------------------------ helpers

const commitPaths = (files, message, label, phaseName) =>
  spawn(
    `Commit exactly these paths — never \`git add -A\` or \`git add .\`:
${files.map((f) => `  ${f}`).join("\n")}
Run \`pnpm exec prettier --write\` on the .md files among them, \`git add\` each path, then \`git commit\` with exactly this message via a heredoc:

${message}

DONE with the short hash; NOTHING_TO_DO if nothing staged; FAILED with the output if a hook refuses. No amend, reset, rebase or push.`,
    {
      label,
      phase: phaseName,
      schema: GIT,
      model: "haiku",
      effort: "low",
      agentType: "general-purpose",
    },
  );

const fmt = (xs, f) => (xs.length ? xs.map(f).join("\n") : "- none");

// ------------------------------------------------------------------ analyze

const analyze = async () => {
  phase("Analyze");
  const [scope, code] = await parallel([
    () =>
      spawn(
        `Read docs/plan/README.md and resolve ${target}; read its plan (scope) file in full and docs/adr/README.md in full. Facts only; change nothing.
- decisions: every item under a "Decisions" heading and every contested choice the scope text names ("the ADR chooses/decides", "X or Y"); decidedBy = the number of an EXISTING ADR whose index row or title decides it for this deliverable, else "".
- assumptions: every item under "Assumptions" or marked taken/revisable; confirmed=true only if the text says the operator confirmed or decided it.
- existingAdrs: ADRs written for this deliverable (index row or header names it), with what each decides in one line.
- hasBuildOrder: "## Build order" with "### N." steps each carrying "**ADRs:**" and "**Done when:**".
- nextAdrNumber: highest index number + 1, four digits.
- scopeSummary: 5–10 sentences an agent can plan from without the file.`,
        { label: "scope", phase: "Analyze", schema: SCOPE, effort: "medium" },
      ),
    () =>
      spawn(
        `Read the scope document of ${target} (via docs/plan/README.md), then read the CODE it will touch — very thorough. Return findings the ADR and the build order must account for, each a concrete fact with file:line evidence and its implication: claims in the scope the code contradicts; seams, factories and adapters to reuse; frozen-ADR rules the work will brush (a generated file under a byte-identical rule, a one-dependency package, an envelope shape); strings, enums or schemas that already exist and must not be declared twice; what a second consumer would need. Facts, not decisions. Change nothing.`,
        {
          label: "code-scout",
          phase: "Analyze",
          schema: CODE,
          agentType: "Explore",
        },
      ),
  ]);
  if (!scope)
    return { mode: "analyze", ready: false, error: "scope agent unavailable" };
  const findings = code ? code.findings : [];
  log(
    `${scope.deliverable}: ${scope.decisions.length} decisions, ${scope.assumptions.length} assumptions, ${scope.existingAdrs.length} ADRs ahead, ${findings.length} code facts`,
  );

  phase("Gaps");
  const gaps = await spawn(
    `Turn deliverable ${scope.deliverable} — ${scope.title} (${scope.planFile}) into the operator's questions.

SCOPE: ${scope.scopeSummary}

DECISIONS:
${fmt(scope.decisions, (d) => `- [${d.id}] ${d.text} ${d.decidedBy ? `(decided by ADR-${d.decidedBy})` : "(OPEN)"}`)}

ASSUMPTIONS:
${fmt(scope.assumptions, (a) => `- [${a.id}] ${a.text} ${a.confirmed ? "(confirmed)" : "(UNCONFIRMED)"}`)}

ADRs WRITTEN AHEAD:
${fmt(scope.existingAdrs, (a) => `- ADR-${a.number} (${a.status}) ${a.title} — ${a.decides}`)}

CODE FACTS:
${fmt(findings, (f) => `- ${f.area}: ${f.fact} [${f.evidence}] → ${f.implication}`)}

1. questions — ONE per OPEN decision, per UNCONFIRMED assumption, and per code fact that forces a choice no existing ADR makes (a rule conflict, a new app or package, a supersession of a frozen ADR). 2–4 options each, the recommended FIRST with recommended=true, each description one or two sentences of trade-off; header ≤ 12 chars. Never ask what an ADR already decides or what a builder can decide (naming, layout, test names). Empty if nothing is open.
2. adrsNeeded — the ADR(s) that must exist for this deliverable to open, minus those written ahead: usually one, plus one superseding record per frozen ADR the scope diverges from (in supersedes). Number from ${scope.nextAdrNumber}. Empty if covered.
3. notes — what the drafter should know that fits nowhere above.`,
    { label: "gaps", phase: "Gaps", schema: GAPS, effort: "high" },
  );
  if (!gaps)
    return {
      mode: "analyze",
      ready: false,
      error: "gaps agent unavailable",
      scope,
      findings,
    };
  const ready =
    gaps.questions.length === 0 &&
    gaps.adrsNeeded.length === 0 &&
    scope.hasBuildOrder;
  log(
    `${gaps.questions.length} question(s); ${gaps.adrsNeeded.length} ADR(s) to draft; build order ${scope.hasBuildOrder ? "present" : "missing"}; ready=${ready}; ${agents} agents`,
  );
  return {
    mode: "analyze",
    deliverable: scope.deliverable,
    planFile: scope.planFile,
    ready,
    questions: gaps.questions,
    adrsNeeded: gaps.adrsNeeded,
    notes: gaps.notes,
    scope,
    findings,
    agents,
  };
};

// -------------------------------------------------------------------- draft

const draft = async (analysis, answers) => {
  const unanswered = analysis.questions.filter(
    (q) => !(answers && answers[q.id]),
  );
  if (unanswered.length)
    return {
      mode: "draft",
      drafted: false,
      error: `unanswered: ${unanswered.map((q) => q.id).join(", ")}`,
      questions: unanswered,
    };
  const { scope, findings } = analysis;
  const answersText = fmt(
    analysis.questions,
    (q) => `- [${q.id}] ${q.question}\n  → ${answers[q.id]}`,
  );
  const findingsText = fmt(
    findings,
    (f) => `- ${f.area}: ${f.fact} [${f.evidence}] → ${f.implication}`,
  );
  const touched = new Set();

  phase("Draft");
  const adrs = (
    await parallel(
      analysis.adrsNeeded.map(
        (a) => () =>
          spawn(
            `Write ADR-${a.number} at docs/adr/${a.number}-${a.slug}.md, status \`proposed\`, date 2026-08-22, title "${a.title}". ${a.supersedes ? `It SUPERSEDES frozen ADR-${a.supersedes}: carry the WHOLE parent decision restated (ADR-0024 rule 1) and quote in §Context the sentence that changes.` : "Additive; supersedes nothing."}
Written AHEAD of ${scope.deliverable} (${scope.title}, ${scope.planFile}) opening — writing is not opening; the header blockquote says so and that it is \`proposed\` until accepted at the head of the deliverable's first implementing step (ADR-0025 rule 3). House format and voice of ADRs 0043–0046 (read two); read ADR-0025 and every ADR the scope names.

SCOPE: ${scope.scopeSummary}

THE OPERATOR'S DECISIONS — decided; record reasoning and the honest trade-off in §Alternatives considered:
${answersText}

CODE FACTS to account for (cite):
${findingsText}

Carries: ${a.decides.join(", ")}. Notes: ${analysis.notes || "none"}.
EDIT SCOPE — this ADR file and docs/adr/README.md only (table row, Implemented "${scope.deliverable} — not yet opened; written ahead 2026-08-22"; remove any Planned bullet it closes; a window bullet "**ADR-${a.number} written 2026-08-22 ahead of ${scope.deliverable}** (writing is not opening), \`proposed\`"). Return the files and a 5-sentence summary.`,
            {
              label: `adr:${a.number}`,
              phase: "Draft",
              schema: WRITTEN,
              agentType: "adr-author",
            },
          ),
      ),
    )
  ).filter(Boolean);
  adrs.forEach((r) => r.files.forEach((f) => touched.add(f)));

  phase("Verify");
  const verified = await pipeline(adrs, async (r) => {
    const file = r.files.find((f) => /docs\/adr\/\d{4}-/.test(f)) || r.files[0];
    const issues = await spawn(
      `Refute the ADR draft ${file}. Read it, docs/adr/README.md, ADR-0025, and every frozen ADR it cites or brushes. Issues, ranked: BLOCKER = edits or silently diverges from a frozen ADR instead of superseding; decides against an operator decision below; omits a decision it carries. MAJOR = ignores or contradicts a code fact below; strawmans an alternative; breaks the header/status/index format; misses a consequence the builder will hit. MINOR = voice, a cross-reference. Empty if it stands.

DECISIONS:
${answersText}

CODE FACTS:
${findingsText}`,
      {
        label: `refute:${file.split("/").pop()}`,
        phase: "Verify",
        schema: ISSUES,
        agentType: "adr-reviewer",
      },
    );
    const blocking = issues
      ? issues.issues.filter((i) => i.severity !== "MINOR")
      : [];
    if (!blocking.length)
      return {
        file,
        summary: r.summary,
        issues: issues ? issues.issues : [],
        fixed: false,
      };
    log(`${file}: ${blocking.length} issue(s) to fix`);
    const fixed = await spawn(
      `Fix these review issues in ${file} (and its index row if named); keep everything else as written:
${blocking.map((i) => `- [${i.severity}] ${i.where}: ${i.problem} → ${i.fix}`).join("\n")}`,
      {
        label: `fix:${file.split("/").pop()}`,
        phase: "Verify",
        schema: WRITTEN,
        agentType: "adr-author",
      },
    );
    if (fixed) fixed.files.forEach((f) => touched.add(f));
    return { file, summary: r.summary, issues: issues.issues, fixed: true };
  });

  phase("Draft");
  const allAdrs = [
    ...scope.existingAdrs.map((a) => "ADR-" + a.number),
    ...analysis.adrsNeeded.map((a) => "ADR-" + a.number),
  ];
  const steps = await spawn(
    `Write the BUILD ORDER for ${scope.deliverable} — ${scope.title} into ${scope.planFile}, status left \`planned\` (status line adds: its ADR(s) were written ahead on 2026-08-22 and are \`proposed\`; opens when the previous deliverable ships). Template: docs/plan/0006-user-settings.md and 0007-localization.md — a Gate paragraph naming which ADR each step is gated on and which step accepts it at its head; "## Build order" with "### N. Title" steps, each an "**ADRs:**" line (from ${allAdrs.join(", ") || "the ADRs the scope names"} plus the frozen ones it builds on), 1–2 paragraphs of what and why-in-this-order, and a checkable "**Done when:**"; a final Close-out step; "## Definition of done" with 5–7 executable items, replacing any Acceptance sketch. Keep the scope file's existing sections above. Size steps for ONE agent in one sitting: split anything touching more than ~2 apps/packages or more than one ADR's worth of surface.

DECISIONS the steps implement:
${answersText}

CODE FACTS the steps respect:
${findingsText}

\`pnpm exec prettier --write\` the file; touch nothing else. Return the files touched and the step list in the summary.`,
    {
      label: "build-order",
      phase: "Draft",
      schema: WRITTEN,
      agentType: "general-purpose",
    },
  );
  if (steps) steps.files.forEach((f) => touched.add(f));

  const consistency = await spawn(
    `Read-only consistency check of ${scope.planFile} and docs/adr/README.md: a step naming an ADR file that does not exist in docs/adr/; a pending step without "**Done when:**"; a Gate paragraph naming a missing step; an ADR written for this deliverable without an index row, or a row whose status disagrees with the file; a Planned bullet the new ADR(s) should have closed; a plan status line saying anything other than planned. Empty if consistent.`,
    {
      label: "consistency",
      phase: "Verify",
      schema: ISSUES,
      model: "haiku",
      effort: "low",
    },
  );

  let committed = null;
  if (doCommit && touched.size) {
    committed = await commitPaths(
      [...touched],
      `docs(plan): ${scope.deliverable} planned ahead — ${analysis.adrsNeeded.map((a) => "ADR-" + a.number).join(", ") || "build order"} proposed

${scope.title}: the operator's decisions recorded as ADR(s) written ahead of opening, and the build order they govern. Writing is not opening — the ledger row stays planned.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
      "commit:draft",
      "Draft",
    );
  }
  return {
    mode: "draft",
    drafted: true,
    deliverable: scope.deliverable,
    adrs: verified.filter(Boolean),
    steps: steps ? steps.summary : "",
    consistency: consistency ? consistency.issues : [],
    committed,
    agents,
  };
};

// --------------------------------------------------------------------- open

const open = async (deliverable) => {
  phase("Open");
  const result = await spawn(
    `Open ${deliverable || target} MECHANICALLY; refuse if not ready. Read docs/plan/README.md, the plan file, docs/adr/README.md, CLAUDE.md, and the ledger's "## How D6 opened" / "## How D7 opened" as the template.
REFUSE (opened=false, say why, change nothing) if: another row is in progress; no "## Build order" with "**ADRs:**" and "**Done when:**" on every step; an ADR a step names does not exist; any decision or assumption is still marked open, unconfirmed or "the ADR chooses".
Otherwise: plan status line → "**in progress**, opened 2026-08-22" naming the ADR(s) and that each is accepted at the head of its first implementing step (do NOT accept any ADR); ledger row → in progress (opened 2026-08-22); §Rules → the open window names this deliverable's ADR(s) only; a short "## How ${deliverable || "D<n>"} opened" above "## How D6–D10 were scoped"; CLAUDE.md's deliverable and amendable-set sentences; the ADR index's window bullet. \`pnpm exec prettier --write\` each .md touched. Return the files.`,
    {
      label: "open",
      phase: "Open",
      schema: OPENED,
      effort: "medium",
      agentType: "general-purpose",
    },
  );
  if (!result || !result.opened)
    return {
      mode: "open",
      opened: false,
      summary: result ? result.summary : "open agent unavailable",
      agents,
    };
  const committed = doCommit
    ? await commitPaths(
        result.files,
        `docs(plan): open ${deliverable || "the next deliverable"}

The ledger row moves to in progress and the window opens on its ADR(s), which stay proposed until the first step accepts them.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
        "commit:open",
        "Open",
      )
    : null;
  return {
    mode: "open",
    opened: true,
    summary: result.summary,
    committed,
    agents,
  };
};

// --------------------------------------------------------------------- main

if (mode === "analyze") return await analyze();
if (mode === "draft") {
  const analysis = (args && args.analysis) || (await analyze());
  if (!analysis.scope) return analysis;
  return await draft(analysis, (args && args.answers) || {});
}
if (mode === "open") return await open(wanted);
return { error: `unknown mode ${mode}` };
