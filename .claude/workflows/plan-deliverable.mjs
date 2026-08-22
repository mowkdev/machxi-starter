/**
 * plan-deliverable — the planning half, split out of run-deliverable.
 *
 * Opening a deliverable is where the operator's decisions live, and a
 * background workflow cannot ask a question. So this script never asks: it
 * ANALYSES a planned deliverable into the exact questions an ADR would have to
 * answer (with a recommended answer each), and — once those answers exist —
 * DRAFTS the ADR(s) and the build order, verified adversarially, without
 * flipping the ledger. Asking is the `/plan-deliverable` skill's job, in the
 * session, with AskUserQuestion between the two modes. Flipping the ledger is
 * the `open` mode, mechanical, run by the skill or by run-deliverable.
 *
 * Invoke:
 *   Workflow({ scriptPath: ".claude/workflows/plan-deliverable.mjs", args: { mode: "analyze" } })
 *   Workflow({ scriptPath: "…", args: { mode: "draft", analysis: <analyze result>, answers: { q1: "…" } } })
 *   Workflow({ scriptPath: "…", args: { mode: "open", deliverable: "D8" } })
 *
 * args:
 *   mode          "analyze" (default) | "draft" | "open"
 *   deliverable   "D8"; default: the first ledger row whose status is `planned`
 *   analysis      draft only — the object analyze returned (saves re-running it)
 *   answers       draft only — { [question.id]: the chosen option label or free text }
 *   commit        draft/open — default true; commits ONLY the files the agents
 *                 report touching, never `git add -A` (another session may be
 *                 building in the same tree)
 *
 * Invariants:
 *   - analyze changes nothing on disk.
 *   - draft writes ADR(s) `proposed` and a build order; the plan's status stays
 *     `planned` — writing is not opening (ADR-0025, the D4 precedent).
 *   - open refuses unless every decision is in an ADR and every pending step
 *     names its ADRs and a done-when; it never accepts an ADR (the first
 *     step's builder does that at its head, ADR-0025 rule 3).
 *
 * Budget: analyze = 3 agents; draft = 2 per ADR + 3; open = 1. Cheap tiers on
 * the mechanical ones.
 */
export const meta = {
  name: "plan-deliverable",
  description:
    "Analyse a planned deliverable into the operator's questions; with answers, draft its ADR(s) and build order (verified) without opening; open mechanically when ready",
  whenToUse:
    "Before run-deliverable reaches a deliverable boundary: /plan-deliverable D8 at the desk, answer the questions, and the ADRs exist before the unattended run needs them",
  phases: [
    {
      title: "Analyze",
      detail: "scope, existing ADRs, code facts — in parallel",
    },
    { title: "Gaps", detail: "questions with recommended answers; ready?" },
    { title: "Draft", detail: "ADR(s) proposed, build order written" },
    {
      title: "Verify",
      detail: "each ADR refuted against the answers and the frozen ADRs",
    },
    { title: "Open", detail: "ledger flipped — mechanical" },
  ],
};

const mode = (args && args.mode) || "analyze";
const wanted = args && args.deliverable;
const doCommit = !(args && args.commit === false);

// ------------------------------------------------------------------ schemas

const SCOPE_SCHEMA = {
  type: "object",
  required: [
    "deliverable",
    "title",
    "planFile",
    "status",
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
    status: { type: "string" },
    hasBuildOrder: {
      type: "boolean",
      description:
        "the plan file has a '## Build order' with numbered steps each naming ADRs and a Done when",
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "text", "decidedBy"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          decidedBy: {
            type: "string",
            description: "ADR number that already decides it, or empty",
          },
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
    nextAdrNumber: { type: "string", description: "four digits, e.g. 0047" },
    scopeSummary: {
      type: "string",
      description:
        "the scope in 5–10 sentences, for agents that will not read the file",
    },
  },
};

const CODE_SCHEMA = {
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
          evidence: { type: "string", description: "file:line or ADR §" },
          implication: {
            type: "string",
            description: "what the ADR or a step must account for",
          },
        },
      },
    },
  },
};

const GAPS_SCHEMA = {
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
          header: { type: "string", description: "≤ 12 chars" },
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
          why: {
            type: "string",
            description:
              "which decision/assumption/finding makes this the operator's call",
          },
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
          slug: {
            type: "string",
            description: "kebab-case file stem after the number",
          },
          title: { type: "string" },
          decides: {
            type: "array",
            items: { type: "string" },
            description: "question ids and decision ids this ADR carries",
          },
          supersedes: {
            type: "string",
            description:
              "ADR number it must supersede (frozen + diverging), or empty",
          },
        },
      },
    },
    notes: { type: "string" },
  },
};

const ADR_SCHEMA = {
  type: "object",
  required: ["file", "indexUpdated", "summary"],
  properties: {
    file: { type: "string" },
    indexUpdated: { type: "boolean" },
    summary: { type: "string" },
  },
};

const ISSUES_SCHEMA = {
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

const STEPS_SCHEMA = {
  type: "object",
  required: ["planFile", "steps", "filesTouched", "summary"],
  properties: {
    planFile: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "adrs"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          adrs: { type: "array", items: { type: "string" } },
        },
      },
    },
    filesTouched: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

const GIT_SCHEMA = {
  type: "object",
  required: ["result", "detail"],
  properties: {
    result: { type: "string", enum: ["DONE", "FAILED", "NOTHING_TO_DO"] },
    detail: { type: "string" },
  },
};

const OPEN_SCHEMA = {
  type: "object",
  required: ["opened", "filesTouched", "summary"],
  properties: {
    opened: { type: "boolean" },
    filesTouched: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

// ---------------------------------------------------------------- helpers

const commitFiles = (files, message, label) =>
  agent(
    `Commit exactly these files and nothing else — another session may have unrelated changes in this tree, so never \`git add -A\` or \`git add .\`:

${files.map((f) => `  ${f}`).join("\n")}

Run \`pnpm exec prettier --write\` on the .md files among them first, then \`git add\` each path, then \`git commit\` with exactly this message via a heredoc:

${message}

Return DONE with the short hash, NOTHING_TO_DO if none of the paths has changes, FAILED with the output if a hook refuses. No amend, no reset, no push.`,
    {
      label,
      phase: mode === "open" ? "Open" : "Draft",
      schema: GIT_SCHEMA,
      model: "haiku",
      effort: "low",
      agentType: "general-purpose",
    },
  );

const target = wanted
  ? `deliverable ${wanted}`
  : "the FIRST ledger row whose Status is `planned`";

// ---------------------------------------------------------------- analyze

const analyze = async () => {
  phase("Analyze");

  const [scope, code] = await parallel([
    () =>
      agent(
        `Read docs/plan/README.md and resolve ${target}; read its plan (scope) file in full, docs/adr/README.md in full (the table, the Planned list, the window bullets), and docs/adr/0025-deliverables.md §rules. Report facts only; change nothing.

- decisions: every item under a "Decisions this deliverable needs" / "Decisions" heading and every contested choice the scope text names ("the ADR chooses…", "the ADR decides…", "X or Y"). For each, decidedBy = the number of an EXISTING ADR (any status) whose title or index row says it decides that thing for this deliverable, else empty.
- assumptions: every item under an "Assumptions" heading, or any sentence marked as taken/revisable/pending confirmation; confirmed=true only if the file says the operator confirmed/decided it (a "(decided YYYY-MM-DD)" heading, "the operator's call", "named by the operator").
- existingAdrs: ADRs written for this deliverable (the index row or the ADR header names it), with what each decides in one line.
- hasBuildOrder: true only if "## Build order" exists with numbered "### N." steps that each carry an "**ADRs:**" line and a "**Done when:**" line.
- nextAdrNumber: the highest number in the index table + 1, four digits.
- scopeSummary: 5–10 sentences an agent can plan from without the file.`,
        {
          label: "scope",
          phase: "Analyze",
          schema: SCOPE_SCHEMA,
          effort: "medium",
        },
      ),
    () =>
      agent(
        `Read the scope document of ${target} (resolve it through docs/plan/README.md) and then read the CODE it will touch — very thorough: the apps/packages named, the seams and ADR claims it relies on, the places where the scope's description of today's code might be wrong. Return findings the ADR and the build order must account for: a concrete fact with file:line evidence and its implication. Look especially for: claims in the scope doc that the code contradicts; existing seams/factories/adapters the work should reuse; frozen-ADR rules the work will brush against (a generated file under a byte-identical rule, a package with a one-dependency rule, an envelope shape); strings, enums or schemas that already exist and must not be declared twice; and what a second consumer (another app or package) would need. Do not propose decisions — report facts. Change nothing.`,
        {
          label: "code-scout",
          phase: "Analyze",
          schema: CODE_SCHEMA,
          agentType: "Explore",
        },
      ),
  ]);

  if (!scope)
    return { mode: "analyze", ready: false, error: "scope agent unavailable" };
  const findings = code ? code.findings : [];
  log(
    `${scope.deliverable}: ${scope.decisions.length} decisions, ${scope.assumptions.length} assumptions, ${scope.existingAdrs.length} ADRs written ahead, ${findings.length} code findings`,
  );

  phase("Gaps");

  const gaps = await agent(
    `You are turning a deliverable's open decisions into the operator's questions. Deliverable ${scope.deliverable} — ${scope.title} (${scope.planFile}).

SCOPE: ${scope.scopeSummary}

DECISIONS (decidedBy = an existing ADR already decides it):
${scope.decisions.map((d) => `- [${d.id}] ${d.text} ${d.decidedBy ? `(decided by ADR-${d.decidedBy})` : "(OPEN)"}`).join("\n") || "- none listed"}

ASSUMPTIONS:
${scope.assumptions.map((a) => `- [${a.id}] ${a.text} ${a.confirmed ? "(confirmed)" : "(UNCONFIRMED)"}`).join("\n") || "- none listed"}

ADRs ALREADY WRITTEN FOR IT:
${scope.existingAdrs.map((a) => `- ADR-${a.number} (${a.status}) ${a.title} — decides: ${a.decides}`).join("\n") || "- none"}

CODE FINDINGS (facts the ADR must account for):
${findings.map((f) => `- ${f.area}: ${f.fact} [${f.evidence}] → ${f.implication}`).join("\n") || "- none"}

Produce:
1. questions — ONE per OPEN decision, per UNCONFIRMED assumption, and per code finding that forces a choice no existing ADR makes (a rule conflict, a new app/package, a supersession of a frozen ADR). 2–4 concrete options each, the recommended one FIRST with recommended=true, each description stating the trade-off in one or two sentences; header ≤ 12 chars. Do NOT ask what an existing ADR already decides, and do not ask about things a builder can decide (naming, file layout, test names). If nothing is open, return an empty array.
2. adrsNeeded — the ADR(s) that must exist for this deliverable to open, minus the ones already written: usually one; a superseding one per frozen ADR the scope diverges from (name it in supersedes). Number them from ${scope.nextAdrNumber} upward. If the existing ADRs already cover every decision, return an empty array.
3. notes — anything the drafter should know that fits nowhere above.`,
    { label: "gaps", phase: "Gaps", schema: GAPS_SCHEMA, effort: "high" },
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
    `${gaps.questions.length} question(s) for the operator; ${gaps.adrsNeeded.length} ADR(s) to draft; build order ${scope.hasBuildOrder ? "present" : "missing"}; ready=${ready}`,
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
  };
};

// ------------------------------------------------------------------ draft

const draft = async (analysis, answers) => {
  const unanswered = analysis.questions.filter(
    (q) => !(answers && answers[q.id]),
  );
  if (unanswered.length) {
    return {
      mode: "draft",
      drafted: false,
      error: `unanswered: ${unanswered.map((q) => q.id).join(", ")}`,
      questions: unanswered,
    };
  }
  const { scope, findings } = analysis;
  const answersText =
    analysis.questions
      .map((q) => `- [${q.id}] ${q.question}\n  → ${answers[q.id]}`)
      .join("\n") || "- (no questions were open)";
  const findingsText =
    findings
      .map((f) => `- ${f.area}: ${f.fact} [${f.evidence}] → ${f.implication}`)
      .join("\n") || "- none";
  const touched = [];

  phase("Draft");

  const adrs = (
    await parallel(
      analysis.adrsNeeded.map(
        (a) => () =>
          agent(
            `Write ADR-${a.number} at docs/adr/${a.number}-${a.slug}.md, status \`proposed\`, date 2026-08-22, title "${a.title}". ${a.supersedes ? `It SUPERSEDES ADR-${a.supersedes} (frozen): carry the WHOLE of the parent's decision restated, not the delta (ADR-0024 rule 1), and quote in §Context the sentence that changes.` : "It is additive; it supersedes nothing."}

It is written AHEAD of deliverable ${scope.deliverable} (${scope.title}) opening — writing is not opening (the D4 precedent); the header blockquote says so, names the plan file ${scope.planFile}, and says it is \`proposed\` until accepted at the head of the deliverable's first implementing step (ADR-0025 rule 3). Match the house format and voice of ADRs 0043–0046 (read two of them first), and read ADR-0025 and every ADR the scope file names.

SCOPE: ${scope.scopeSummary}

THE OPERATOR'S DECISIONS — record each as decided, with the reasoning and the honest trade-off in §Alternatives considered; do not reopen them:
${answersText}

CODE FACTS the record must account for (cite them):
${findingsText}

This ADR carries: ${a.decides.join(", ")}. Notes from the analysis: ${analysis.notes || "none"}.

EDIT SCOPE — strictly: this ADR file, and docs/adr/README.md (add the table row with Implemented "${scope.deliverable} — not yet opened; written ahead 2026-08-22"; remove any Planned-list bullet this ADR closes; add a window bullet "**ADR-${a.number} written 2026-08-22 ahead of ${scope.deliverable}** (writing is not opening), \`proposed\`"). Touch no other file. Return the file path and a 5-sentence summary.`,
            {
              label: `adr:${a.number}`,
              phase: "Draft",
              schema: ADR_SCHEMA,
              agentType: "adr-author",
            },
          ),
      ),
    )
  ).filter(Boolean);
  adrs.forEach((r) => touched.push(r.file));
  if (analysis.adrsNeeded.length) touched.push("docs/adr/README.md");

  phase("Verify");

  const verified = await pipeline(adrs, async (r) => {
    const issues = await agent(
      `Refute this ADR draft: ${r.file}. Read it, then docs/adr/README.md, ADR-0025, and every frozen ADR it cites or brushes against. Report issues, ranked:
- BLOCKER: it edits or silently diverges from a frozen ADR instead of superseding it; it decides something the operator decided differently (decisions below); it omits a decision it was supposed to carry.
- MAJOR: a code fact below is contradicted or ignored; an alternative is strawmanned; the header/status/index row breaks the house format; a consequence that will bite the builder is missing.
- MINOR: voice, precision, a cross-reference.
Empty array if it stands.

THE OPERATOR'S DECISIONS:
${answersText}

CODE FACTS:
${findingsText}`,
      {
        label: `refute:${r.file.split("/").pop()}`,
        phase: "Verify",
        schema: ISSUES_SCHEMA,
        agentType: "adr-reviewer",
      },
    );
    const blocking = issues
      ? issues.issues.filter((i) => i.severity !== "MINOR")
      : [];
    if (!blocking.length)
      return { ...r, issues: issues ? issues.issues : [], fixed: false };
    log(`${r.file}: ${blocking.length} issue(s) to fix`);
    await agent(
      `Fix these review issues in ${r.file} (and its index row if named). Keep everything else as written. Issues:
${blocking.map((i) => `- [${i.severity}] ${i.where}: ${i.problem} → ${i.fix}`).join("\n")}`,
      {
        label: `fix:${r.file.split("/").pop()}`,
        phase: "Verify",
        schema: ADR_SCHEMA,
        agentType: "adr-author",
      },
    );
    return { ...r, issues: issues.issues, fixed: true };
  });

  phase("Draft");

  const steps = await agent(
    `Write the BUILD ORDER for ${scope.deliverable} — ${scope.title} into ${scope.planFile}, keeping its status \`planned\` (add to the status line: "its ADR(s) were written ahead on 2026-08-22 and are \`proposed\`; opens when the previous deliverable ships"). Read docs/plan/0006-user-settings.md and docs/plan/0007-localization.md first as the template: a Gate paragraph naming which ADR each step is gated on and which step accepts it at its head; "## Build order" with "### N. Title" steps, each with an "**ADRs:**" line (the ADR(s) it is governed by — ${[...scope.existingAdrs.map((a) => "ADR-" + a.number), ...analysis.adrsNeeded.map((a) => "ADR-" + a.number)].join(", ") || "the ADRs the scope names"} plus the frozen ones it builds on), 1–2 paragraphs of what and why-in-this-order, and a "**Done when:**" line that is checkable; a final close-out step; and a "## Definition of done" with 5–7 executable items. Keep every existing section of the scope file (scope, why-this-order, decisions, locales…) above the build order; replace any "Acceptance sketch" with the definition of done. Size steps so ONE agent can build a step in one sitting: split anything that touches more than ~2 apps/packages or more than one ADR's worth of surface.

THE OPERATOR'S DECISIONS the steps must implement:
${answersText}

CODE FACTS the steps must respect:
${findingsText}

Run \`pnpm exec prettier --write\` on the file. Touch no other file. Return the step list and the files touched.`,
    {
      label: "build-order",
      phase: "Draft",
      schema: STEPS_SCHEMA,
      agentType: "general-purpose",
    },
  );
  if (steps) touched.push(...steps.filesTouched);

  const consistency = await agent(
    `Consistency check, read-only: ${scope.planFile} and docs/adr/README.md. Report issues: a step whose "**ADRs:**" names an ADR file that does not exist in docs/adr/; a pending step without a "**Done when:**"; a Gate paragraph naming a step that does not exist; an ADR written for this deliverable with no index row, or a row whose status disagrees with the file's status line; a Planned-list bullet the new ADR(s) should have closed; the plan's status line saying anything other than planned. Empty array if consistent.`,
    {
      label: "consistency",
      phase: "Verify",
      schema: ISSUES_SCHEMA,
      effort: "low",
    },
  );

  let committed = null;
  if (doCommit && touched.length) {
    committed = await commitFiles(
      [...new Set(touched)],
      `docs(plan): ${scope.deliverable} planned ahead — ${analysis.adrsNeeded.map((a) => "ADR-" + a.number).join(", ") || "build order"} proposed

${scope.title}: the operator's decisions recorded as ADR(s) written ahead of opening, and the build order they govern. Writing is not opening — the ledger row stays planned.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
      "commit:draft",
    );
  }

  return {
    mode: "draft",
    drafted: true,
    deliverable: scope.deliverable,
    adrs: verified
      .filter(Boolean)
      .map(({ file, summary, issues, fixed }) => ({
        file,
        summary,
        issues,
        fixed,
      })),
    steps: steps ? steps.steps : [],
    consistency: consistency ? consistency.issues : [],
    committed,
  };
};

// ------------------------------------------------------------------- open

const open = async (deliverable) => {
  phase("Open");
  const result = await agent(
    `Open deliverable ${deliverable || target} — MECHANICALLY, and refuse if it is not ready. Read docs/plan/README.md, the plan file, docs/adr/README.md, CLAUDE.md, and the ledger's "## How D6 opened" / "## How D7 opened" sections as the template.

REFUSE (opened=false, say why, change nothing) if: another row is already in progress; the plan has no "## Build order" with steps each carrying "**ADRs:**" and "**Done when:**"; any ADR a step names does not exist; any decision/assumption in the plan is marked open, unconfirmed or "the ADR chooses".

Otherwise: plan status line → "**in progress**, opened 2026-08-22" naming the ADR(s) and that each is accepted at the head of its first implementing step (do NOT accept any ADR yourself — ADR-0025 rule 3 gives that to the step); ledger row → in progress (opened 2026-08-22); §Rules line → the open window names this deliverable's ADR(s) only; a short "## How ${deliverable || "D<n>"} opened" section above "## How D6–D10 were scoped"; CLAUDE.md's deliverable sentence and "amendable set" sentence; the ADR index's window bullet. \`pnpm exec prettier --write\` on every .md touched. Return the files touched.`,
    {
      label: "open",
      phase: "Open",
      schema: OPEN_SCHEMA,
      effort: "medium",
      agentType: "general-purpose",
    },
  );
  if (!result || !result.opened)
    return {
      mode: "open",
      opened: false,
      summary: result ? result.summary : "open agent unavailable",
    };
  let committed = null;
  if (doCommit) {
    committed = await commitFiles(
      result.filesTouched,
      `docs(plan): open ${deliverable || "the next deliverable"}

The ledger row moves to in progress and the window opens on its ADR(s), which stay proposed until the first step accepts them.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
      "commit:open",
    );
  }
  return { mode: "open", opened: true, summary: result.summary, committed };
};

// -------------------------------------------------------------------- main

if (mode === "analyze") {
  return await analyze();
}
if (mode === "draft") {
  const analysis = (args && args.analysis) || (await analyze());
  if (!analysis.scope) return analysis;
  return await draft(analysis, (args && args.answers) || {});
}
if (mode === "open") {
  return await open(wanted);
}
return { error: `unknown mode ${mode}` };
