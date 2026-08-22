/**
 * run-deliverable — a deliverable from its next pending step to `shipped`,
 * unattended. The building half; `plan-deliverable` is the deciding half.
 *
 * Every pending step of the in-progress deliverable is built in order,
 * reviewed by the `review-step` workflow, fixed when the review or the gate
 * says so, and committed; the close-out moves the ledger row; the result is
 * pushed; and, in chain mode, the next deliverable is opened — but ONLY when
 * `plan-deliverable` reports it ready: every decision already in an ADR and
 * a build order already written. This script makes no planning judgement of
 * its own; its preflight is mechanical on purpose.
 *
 * Invoke (by scriptPath — the name registry has been seen stale):
 *   Workflow({ scriptPath: ".claude/workflows/run-deliverable.mjs" })
 *   Workflow({ scriptPath: "…", args: { mode: "chain", maxDeliverables: 2 } })
 *
 * args (all optional):
 *   mode             "ship" (default) — build every pending step, close, push, stop.
 *                    "open-next" — then open the following deliverable if
 *                    plan-deliverable says it is ready, and stop.
 *                    "chain" — keep building through opened deliverables; halts
 *                    at the first one plan-deliverable cannot call ready.
 *   maxDeliverables  cap for "chain" (default 1 = the current one only).
 *   maxFixRounds     review→fix→review rounds per step before the run stops (default 2).
 *   push             false to skip `git push` (default true; a denied push is
 *                    recorded, never retried, never forced).
 *
 * Invariants, checkable in the transcript:
 *   - Steps run strictly in order; a step is never skipped and never started
 *     while the previous one is uncommitted.
 *   - Preflight refuses a pending step that names an ADR still `proposed`
 *     unless the step itself accepts it at its head (ADR-0025 rule 3), or
 *     that has no ADR list / no done-when.
 *   - A step still red after maxFixRounds STOPS the run. Nothing is marked
 *     done that is not green.
 *   - Commits are by explicit path, never `git add -A`; only
 *     `git push origin main`; no reset, rebase, force, or branch deletion.
 *   - Browser-only acceptance items are recorded as "pending operator
 *     acceptance", never claimed (the ledger's D3–D6 precedent).
 *
 * Cost shape per step: 1 builder (the long one) + review-step (scout and
 * gate on cheap tiers, 1–2 reviewers, one refuter per finding) + ≤2 fixers +
 * 1 committer on haiku. The gate tier is the scout's call (ADR-0026): the
 * full, serial integration gate only when apps/api, packages/db or
 * packages/contracts moved.
 */
export const meta = {
  name: "run-deliverable",
  description:
    "Build every pending step of the in-progress deliverable in order — build, review-step, fix, commit — close it, push, and in chain mode open the next only when plan-deliverable reports it ready",
  whenToUse:
    "When the operator steps away and wants the in-progress deliverable carried to `shipped` unattended; run /plan-deliverable first for anything that should chain",
  phases: [
    {
      title: "Preflight",
      detail: "clean main, Postgres up, steps parsed and ungated",
    },
    { title: "Steps", detail: "per step: build → review-step → fix → commit" },
    { title: "Close", detail: "checklist, ledger row, window shut" },
    { title: "Ship", detail: "git push origin main (recorded, never forced)" },
    {
      title: "Next",
      detail:
        "plan-deliverable readiness, then open — or stop with its questions",
    },
  ],
};

const mode = (args && args.mode) || "ship";
const maxDeliverables = (args && args.maxDeliverables) || 1;
const maxFixRounds =
  args && args.maxFixRounds !== undefined ? args.maxFixRounds : 2;
const doPush = !(args && args.push === false);

const REPO = "C:\\Users\\SergejsMoskanovs\\code\\lab\\machxi-starter";
const REVIEW_STEP = `${REPO}\\.claude\\workflows\\review-step.mjs`;
const PLAN_DELIVERABLE = `${REPO}\\.claude\\workflows\\plan-deliverable.mjs`;

// ------------------------------------------------------------------ schemas

const PREFLIGHT_SCHEMA = {
  type: "object",
  required: ["ok", "reason", "deliverable"],
  properties: {
    ok: { type: "boolean" },
    reason: { type: "string" },
    deliverable: {
      type: "object",
      required: ["id", "title", "planFile", "status", "steps"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        planFile: { type: "string" },
        status: {
          type: "string",
          enum: ["in progress", "shipped", "planned", "none"],
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: [
              "id",
              "title",
              "done",
              "adrs",
              "acceptsAdr",
              "gatedOn",
              "body",
              "doneWhen",
            ],
            properties: {
              id: { type: "string", description: "e.g. D7.4" },
              title: { type: "string" },
              done: { type: "boolean" },
              adrs: {
                type: "array",
                items: { type: "string" },
                description: "ADR numbers on the step's **ADRs:** line",
              },
              acceptsAdr: {
                type: "string",
                description:
                  "the ADR this step accepts at its head per the plan's Gate paragraph, or empty",
              },
              gatedOn: {
                type: "string",
                description:
                  "an ADR the step depends on that is still `proposed` and is NOT accepted by this step or an earlier pending step; else empty",
              },
              body: {
                type: "string",
                description:
                  "the step's descriptive paragraphs verbatim (not the Closed/evidence notes)",
              },
              doneWhen: {
                type: "string",
                description: "the **Done when:** text verbatim, or empty",
              },
            },
          },
        },
      },
    },
  },
};

const BUILD_SCHEMA = {
  type: "object",
  required: [
    "outcome",
    "summary",
    "commitMessage",
    "filesTouched",
    "adrAmendments",
    "unresolved",
  ],
  properties: {
    outcome: { type: "string", enum: ["built", "blocked"] },
    summary: {
      type: "string",
      description: "what was built and how it was verified, 3–8 sentences",
    },
    commitMessage: {
      type: "string",
      description:
        "conventional commit, subject + body, ending with the Co-Authored-By line",
    },
    filesTouched: {
      type: "array",
      items: { type: "string" },
      description:
        "every file created or modified, repo-relative — the commit is by these paths",
    },
    adrAmendments: { type: "array", items: { type: "string" } },
    unresolved: { type: "string", description: "why blocked, or empty" },
  },
};

const FIX_SCHEMA = {
  type: "object",
  required: ["fixed", "summary", "filesTouched"],
  properties: {
    fixed: { type: "boolean" },
    summary: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
  },
};

const GATE_SCHEMA = {
  type: "object",
  required: ["result", "command", "summary", "failures"],
  properties: {
    result: { type: "string", enum: ["PASS", "FAIL", "BLOCKED"] },
    command: { type: "string" },
    summary: { type: "string" },
    failures: { type: "string" },
  },
};

const GIT_SCHEMA = {
  type: "object",
  required: ["result", "detail"],
  properties: {
    result: {
      type: "string",
      enum: ["DONE", "DENIED", "FAILED", "NOTHING_TO_DO"],
    },
    detail: {
      type: "string",
      description: "the commit hash, the push output, or the refusal verbatim",
    },
  },
};

const CLOSE_SCHEMA = {
  type: "object",
  required: ["shipped", "summary", "operatorAccepted", "filesTouched"],
  properties: {
    shipped: { type: "boolean" },
    summary: { type: "string" },
    operatorAccepted: { type: "array", items: { type: "string" } },
    filesTouched: { type: "array", items: { type: "string" } },
  },
};

// ---------------------------------------------------------------- helpers

const stop = (where, why, state) => {
  log(`STOP at ${where}: ${why}`);
  return { stopped: true, where, why, ...state };
};

const commitPaths = (files, message, label, phaseName) =>
  agent(
    `Commit exactly these paths and nothing else — never \`git add -A\` or \`git add .\`; another session may have unrelated changes in this tree. Run \`git status --short\` first and ALSO include any path it lists that is under the same directories as the ones below (a builder sometimes forgets a generated file, a snapshot or a lockfile it caused); list what you added beyond the given set in \`detail\`.

${files.map((f) => `  ${f}`).join("\n")}

Then \`git commit\` with EXACTLY this message via a heredoc (keep the Co-Authored-By trailer):

${message}

Return DONE with the short hash from \`git log --oneline -1\`; NOTHING_TO_DO if nothing was staged; FAILED with the output verbatim if a hook refuses. No amend, no reset, no rebase, no push.`,
    {
      label,
      phase: phaseName,
      schema: GIT_SCHEMA,
      model: "haiku",
      effort: "low",
      agentType: "general-purpose",
    },
  );

const fmtFindings = (findings) =>
  findings
    .map(
      (f) =>
        `- [${f.severity}] ${f.adr} — ${f.file}:${f.line}\n  problem: ${f.problem}\n  fix: ${f.fix}`,
    )
    .join("\n");

// ---------------------------------------------------------------- the run

const shipped = [];
const opened = [];
let deliverablesRun = 0;

while (true) {
  // ----------------------------------------------------------- Preflight
  phase("Preflight");

  const pre = await agent(
    `Preflight for an unattended deliverable run. Report facts; change nothing.

1. \`git status --short\` must be empty and \`git branch --show-current\` must be \`main\`; else ok=false with the reason.
2. \`docker ps\` must show a running Postgres container; else ok=false.
3. Read docs/plan/README.md; find the ONE row whose Status is **in progress** (none → status "none", ok=false). Read its plan file in full and docs/adr/README.md's table.
4. For every step under "## Build order", in order: id, title, done (heading struck through \`~~…~~\` / "**done**" / a "**Closed.**" paragraph); the ADR numbers on its "**ADRs:**" line; acceptsAdr — the ADR the plan's Gate paragraph says is "accepted at the head of" THIS step; gatedOn — an ADR the step names that the index still lists as \`proposed\` AND that is not acceptsAdr of this step or of an earlier pending step (empty otherwise); body — the step's descriptive paragraphs verbatim, excluding any "Closed." / evidence notes; doneWhen — the "**Done when:**" text verbatim.
5. ok=false if any PENDING step has an empty adrs list (a close-out step titled "Close-out" is exempt), an empty doneWhen, or a gatedOn — name the step and what is missing. The run must not start on a plan it cannot execute mechanically.`,
    {
      label: "preflight",
      phase: "Preflight",
      schema: PREFLIGHT_SCHEMA,
      effort: "low",
    },
  );

  if (!pre || !pre.ok)
    return stop("preflight", pre ? pre.reason : "preflight agent unavailable", {
      shipped,
      opened,
    });

  const d = pre.deliverable;
  const pending = d.steps.filter((s) => !s.done);
  log(
    `${d.id} — ${d.title}: ${d.steps.length - pending.length} done, ${pending.length} pending — ${pending.map((s) => s.id).join(", ") || "none"}`,
  );

  // --------------------------------------------------------------- Steps
  phase("Steps");

  const stepReports = [];
  for (const step of pending) {
    log(`${step.id} — ${step.title}: building`);

    const build = await agent(
      `Execute plan step ${step.id} — "${step.title}" — of ${d.planFile} (deliverable ${d.id}, ${d.title}), exactly as the \`plan-step\` skill prescribes: invoke that skill with argument ${step.id} and follow it, with TWO exceptions — (a) do NOT run adr-reviewer / security-reviewer yourself (the review-step workflow runs on your output next), and (b) do NOT commit: leave every change in the working tree and return the conventional commit message you would have used (subject \`<type>(<scope>): …\`, a body in the repo's style, ending with the line \`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>\`), plus every file you created or modified.

The step as the plan states it — still read the ADRs it names in full, they carry the reasoning:

ADRs: ${step.adrs.map((n) => `ADR-${n}`).join(", ") || "none"}${step.acceptsAdr ? `\nThis step ACCEPTS ADR-${step.acceptsAdr} at its head (ADR-0025 rule 3): status line → accepted 2026-08-22, the index row, the plan's Gate paragraph — before building.` : ""}

${step.body}

Done when: ${step.doneWhen}

Everything else applies in full: build; write tests; \`pnpm check\` in the loop and the full gate \`pnpm lint && pnpm check-types && pnpm test\` before you finish (Postgres is up); update the docs the step touches — the plan file's step notes written the way D6/D7 steps wrote theirs (heading struck through with the date, a **Closed.** paragraph, what the step found recorded rather than folded into "done", evidence separated into machine-verified vs not walked), ADR amendments labelled \`**Amended 2026-08-22 (${step.id}).**\`, the ADR index's Implemented column, Postman via /postman-sync when an endpoint changed, .env.example when a variable did. Anything that needs a browser is recorded as "not walked — pending operator acceptance", never claimed.

If the gate cannot be made green, or the step needs a decision only the operator can make, return outcome "blocked" with the reason — do not work around an ADR and do not skip or weaken a test.`,
      {
        label: `build:${step.id}`,
        phase: "Steps",
        schema: BUILD_SCHEMA,
        agentType: "general-purpose",
      },
    );

    if (!build || build.outcome !== "built")
      return stop(step.id, build ? build.unresolved : "builder unavailable", {
        shipped,
        opened,
        stepReports,
      });

    const touched = new Set(build.filesTouched);

    // Review → fix → review, bounded. The scout inside review-step picks the gate tier.
    let review = null;
    let rounds = 0;
    while (true) {
      review = await workflow({ scriptPath: REVIEW_STEP }, { range: "HEAD" });
      const blocking = review
        ? review.confirmed.filter((f) => f.severity !== "MINOR")
        : [];
      const gateRed = !review || !review.gate || review.gate.result !== "PASS";
      const minors = review
        ? review.confirmed.filter((f) => f.severity === "MINOR")
        : [];

      if (!gateRed && blocking.length === 0) {
        if (minors.length)
          log(
            `${step.id}: ${minors.length} MINOR finding(s) recorded, not blocking`,
          );
        break;
      }
      if (rounds >= maxFixRounds) {
        return stop(
          step.id,
          `still ${gateRed ? "red on the gate" : ""}${gateRed && blocking.length ? " and " : ""}${blocking.length ? `${blocking.length} confirmed BLOCKER/MAJOR` : ""} after ${rounds} fix round(s)`,
          { shipped, opened, stepReports, lastReview: review },
        );
      }
      rounds += 1;
      log(
        `${step.id}: fix round ${rounds} — gate ${review && review.gate ? review.gate.result : "n/a"}, ${blocking.length} blocking finding(s)`,
      );

      const fix = await agent(
        `Step ${step.id} of ${d.planFile} is built in the working tree (uncommitted) and its review found the following. Fix every item, re-run \`pnpm check\` and then the full gate \`pnpm lint && pnpm check-types && pnpm test\`, and update the step's plan notes / ADR amendment if a fix changes what they claim. Do not commit. Do not skip or weaken a test to make it pass; if a finding is wrong, say so in the summary and leave it. Return every file you touched.

GATE: ${review && review.gate ? `${review.gate.result} — ${review.gate.summary}\n${review.gate.failures}` : "not run"}

CONFIRMED FINDINGS:
${fmtFindings(blocking)}${minors.length ? `\n\nMINOR (fix if cheap):\n${fmtFindings(minors)}` : ""}`,
        {
          label: `fix:${step.id}#${rounds}`,
          phase: "Steps",
          schema: FIX_SCHEMA,
          agentType: "general-purpose",
        },
      );
      if (!fix)
        return stop(step.id, "fixer unavailable", {
          shipped,
          opened,
          stepReports,
          lastReview: review,
        });
      fix.filesTouched.forEach((f) => touched.add(f));
    }

    const committed = await commitPaths(
      [...touched],
      build.commitMessage,
      `commit:${step.id}`,
      "Steps",
    );
    if (!committed || committed.result !== "DONE") {
      return stop(
        step.id,
        `commit ${committed ? committed.result : "unavailable"}: ${committed ? committed.detail : ""}`,
        { shipped, opened, stepReports },
      );
    }
    log(`${step.id} committed ${committed.detail}`);
    stepReports.push({
      step: step.id,
      commit: committed.detail,
      summary: build.summary,
      adrAmendments: build.adrAmendments,
      gateTier: review ? review.gateTier : undefined,
      minorFindings: review
        ? review.confirmed.filter((f) => f.severity === "MINOR")
        : [],
      fixRounds: rounds,
    });
  }

  // --------------------------------------------------------------- Close
  phase("Close");

  const close = await agent(
    `Confirm or perform the close of ${d.id} (${d.planFile}) per ADR-0025 rule 4 — all three parts or it is not closed: the definition-of-done checklist run, the ledger row in docs/plan/README.md moved to **shipped 2026-08-22**, and the amendment window shut (the plan's status line, docs/plan/README.md §Rules, CLAUDE.md's deliverable and "amendable set" sentences, and the ADR index's window bullet all saying this deliverable's ADRs are now frozen and the next planned deliverable is next).

Read the plan file first. If its last step was a close-out step that already did all of this and the ledger row already reads shipped, verify and return shipped=true with nothing changed. Otherwise do it now, in the house style: run every machine-verifiable checklist item (the gate; \`pnpm test:unit\` twice with the second FULL TURBO; \`pnpm format:check\`; \`pnpm test:postman\` if the API changed and the dev API is up — record it if not); write the ledger's "## How ${d.id} closed, and on what evidence" section with the evidence separated exactly as D3–D6 did; every browser-only item under operatorAccepted, written as "accepted by the operator rather than machine-verified" — never claimed as walked. Leave the changes uncommitted; return the files touched.`,
    {
      label: `close:${d.id}`,
      phase: "Close",
      schema: CLOSE_SCHEMA,
      agentType: "general-purpose",
    },
  );
  if (!close || !close.shipped)
    return stop("close", close ? close.summary : "close agent unavailable", {
      shipped,
      opened,
      stepReports,
    });
  if (close.filesTouched.length) {
    const closeCommit = await commitPaths(
      close.filesTouched,
      `docs(plan): ${d.id} ships

The acceptance checklist run, the ledger row moved and the window shut — ADR-0025 rule 4's three parts together. Browser-only items are recorded as pending operator acceptance rather than claimed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
      `commit:close:${d.id}`,
      "Close",
    );
    if (closeCommit && closeCommit.result === "FAILED")
      return stop("close", `commit failed: ${closeCommit.detail}`, {
        shipped,
        opened,
        stepReports,
      });
  }
  shipped.push({
    deliverable: d.id,
    steps: stepReports,
    operatorAccepted: close.operatorAccepted,
  });
  deliverablesRun += 1;
  log(`${d.id} shipped`);

  // ---------------------------------------------------------------- Ship
  phase("Ship");

  let push = { result: "NOTHING_TO_DO", detail: "push disabled by args" };
  if (doPush) {
    push = await agent(
      `Push main: run exactly \`git push origin main\`. If refused by a permission prompt or policy, return DENIED with the refusal verbatim — do not retry, do not force, do not try another remote or branch. If the remote rejects it (non-fast-forward or similar), return FAILED with the output verbatim — do not pull, rebase or force. On success return DONE with the output.`,
      {
        label: `push:${d.id}`,
        phase: "Ship",
        schema: GIT_SCHEMA,
        model: "haiku",
        effort: "low",
        agentType: "general-purpose",
      },
    );
  }
  shipped[shipped.length - 1].push = push;
  log(`push: ${push ? push.result : "unavailable"}`);
  if (push && push.result === "FAILED")
    return stop("ship", `push failed: ${push.detail}`, { shipped, opened });

  // ---------------------------------------------------------------- Next
  if (mode === "ship") break;

  phase("Next");

  // plan-deliverable decides readiness; this script only acts on its answer.
  const plan = await workflow(
    { scriptPath: PLAN_DELIVERABLE },
    { mode: "analyze" },
  );
  if (!plan || plan.error)
    return stop(
      "next",
      `plan-deliverable analyze failed: ${plan ? plan.error : "unavailable"}`,
      { shipped, opened },
    );

  if (plan.questions && plan.questions.length) {
    log(
      `${plan.deliverable} needs the operator: ${plan.questions.length} question(s)`,
    );
    return {
      stopped: true,
      where: "next",
      why: "operator decisions required — run /plan-deliverable",
      deliverable: plan.deliverable,
      questions: plan.questions,
      findings: plan.findings,
      shipped,
      opened,
    };
  }

  // Decided but not yet drafted (ADRs written ahead, build order missing, or the reverse): draft, then open.
  if (!plan.ready) {
    const drafted = await workflow(
      { scriptPath: PLAN_DELIVERABLE },
      { mode: "draft", analysis: plan, answers: {} },
    );
    if (!drafted || !drafted.drafted)
      return stop(
        "next",
        `plan-deliverable draft failed: ${drafted ? drafted.error : "unavailable"}`,
        { shipped, opened },
      );
    if (
      drafted.consistency &&
      drafted.consistency.some((i) => i.severity !== "MINOR")
    ) {
      return stop(
        "next",
        `drafted ${plan.deliverable} has consistency issues: ${drafted.consistency.map((i) => i.problem).join("; ")}`,
        { shipped, opened, drafted },
      );
    }
  }

  const openResult = await workflow(
    { scriptPath: PLAN_DELIVERABLE },
    { mode: "open", deliverable: plan.deliverable },
  );
  if (!openResult || !openResult.opened)
    return stop(
      "next",
      `open refused: ${openResult ? openResult.summary : "unavailable"}`,
      { shipped, opened },
    );
  opened.push({ deliverable: plan.deliverable, summary: openResult.summary });
  log(`${plan.deliverable} opened`);

  if (mode !== "chain" || deliverablesRun >= maxDeliverables) break;
}

return { stopped: false, mode, shipped, opened };
