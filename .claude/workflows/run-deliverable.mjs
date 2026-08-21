/**
 * run-deliverable — a deliverable from its next pending step to `shipped`,
 * unattended.
 *
 * What an operator does at the desk with /plan-step, orchestrated for the
 * hours they are not there: every pending step of the in-progress deliverable
 * is built in order, reviewed by the `review-step` workflow, fixed when the
 * review or the gate says so, and committed; the close-out moves the ledger
 * row; the result is pushed; and, if asked, the next deliverable is opened —
 * but only as far as a `proposed` ADR and a build order, because opening is
 * where the operator's decisions live.
 *
 * Invoke (opt-in, like every workflow):
 *   Workflow({ name: "run-deliverable" })                       // ship the in-progress deliverable, stop
 *   Workflow({ name: "run-deliverable", args: { mode: "open-next" } })
 *   Workflow({ name: "run-deliverable", args: { mode: "chain", maxDeliverables: 2 } })
 *
 * args (all optional):
 *   mode             "ship" (default) — build every pending step, close, push, stop.
 *                    "open-next" — then open the following deliverable (ADR(s)
 *                    `proposed`, steps written, ledger flipped, committed) and stop.
 *                    "chain" — keep going into opened deliverables, but halt the
 *                    moment an opening raises a question only the operator can
 *                    answer (a contested ADR choice, an unconfirmed assumption).
 *   maxDeliverables  cap for "chain" (default 1 = the current one only).
 *   maxFixRounds     review→fix→review rounds per step before the run stops (default 2).
 *   push             false to skip `git push` entirely (default true; a denied
 *                    push is recorded, never retried, never forced).
 *   gate             "full" (default; needs Postgres) | "check" for each step's
 *                    review — the builder always runs the full gate itself.
 *
 * Invariants, stated so they are checkable in the transcript:
 *   - Steps run strictly in order; a step is never skipped and never started
 *     while the previous one is uncommitted.
 *   - A step whose gate is red after maxFixRounds STOPS the run. Nothing is
 *     marked done that is not green.
 *   - Only `git add` / `git commit` / `git push origin main`. No reset, no
 *     rebase, no force, no branch deletion.
 *   - Browser-only acceptance items are recorded as "not walked — pending
 *     operator acceptance", never claimed (the ledger's D3–D5 precedent).
 *   - A deliverable opens unattended only when its scope document's
 *     assumptions are all confirmed and its ADRs need no contested choice.
 *
 * Budget: one deliverable of four steps is roughly 4 × (1 builder + the
 * review-step workflow's ~5–10 + up to 2 fixers + 1 committer) — well past the
 * repo's 15-agent guideline, on purpose: this is the workflow the operator
 * runs precisely when they will not be there to run the steps one at a time.
 */
export const meta = {
  name: "run-deliverable",
  description:
    "Build every pending step of the in-progress deliverable in order — build, review-step, fix, commit — close it, push, and optionally open the next one as far as a proposed ADR",
  whenToUse:
    "When the operator steps away and wants the in-progress deliverable carried to `shipped` unattended; the stopping rules are the safety net",
  phases: [
    {
      title: "Preflight",
      detail: "clean tree on main, Postgres up, plan parsed",
    },
    { title: "Steps", detail: "per step: build → review-step → fix → commit" },
    { title: "Close", detail: "checklist, ledger row, window shut" },
    { title: "Ship", detail: "git push origin main (recorded, never forced)" },
    {
      title: "Next",
      detail: "open the following deliverable as proposed, or stop",
    },
  ],
};

const mode = (args && args.mode) || "ship";
const maxDeliverables = (args && args.maxDeliverables) || 1;
const maxFixRounds =
  args && args.maxFixRounds !== undefined ? args.maxFixRounds : 2;
const doPush = !(args && args.push === false);
const reviewGate = (args && args.gate) || "full";

// ------------------------------------------------------------------ schemas

const PREFLIGHT_SCHEMA = {
  type: "object",
  required: ["ok", "reason", "branch", "deliverable"],
  properties: {
    ok: { type: "boolean" },
    reason: { type: "string" },
    branch: { type: "string" },
    deliverable: {
      type: "object",
      required: ["id", "planFile", "status", "steps"],
      properties: {
        id: { type: "string", description: "e.g. D6" },
        planFile: { type: "string" },
        status: {
          type: "string",
          enum: ["in progress", "shipped", "planned", "none"],
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title", "done", "gatedOnProposedAdr"],
            properties: {
              id: { type: "string", description: "e.g. D6.2" },
              title: { type: "string" },
              done: { type: "boolean" },
              gatedOnProposedAdr: {
                type: "string",
                description:
                  "the ADR number if the step names an ADR still `proposed` that the step itself does not accept at its head; empty otherwise",
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
    filesTouched: { type: "array", items: { type: "string" } },
    adrAmendments: { type: "array", items: { type: "string" } },
    unresolved: { type: "string", description: "why blocked, or empty" },
  },
};

const FIX_SCHEMA = {
  type: "object",
  required: ["fixed", "summary"],
  properties: {
    fixed: { type: "boolean" },
    summary: { type: "string" },
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
  required: ["shipped", "summary", "operatorAccepted"],
  properties: {
    shipped: { type: "boolean" },
    summary: { type: "string" },
    operatorAccepted: {
      type: "array",
      items: { type: "string" },
      description:
        "checklist items that could not be machine-verified and are recorded as pending operator acceptance",
    },
  },
};

const OPEN_SCHEMA = {
  type: "object",
  required: ["opened", "deliverable", "needsOperator", "questions", "summary"],
  properties: {
    opened: { type: "boolean" },
    deliverable: { type: "string" },
    needsOperator: { type: "boolean" },
    questions: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

// ---------------------------------------------------------------- helpers

const stop = (where, why, state) => {
  log(`STOP at ${where}: ${why}`);
  return { stopped: true, where, why, ...state };
};

const commit = (message, label) =>
  agent(
    `Commit the working tree. Run \`git status --short\` first; if it is empty return NOTHING_TO_DO. Otherwise \`git add -A\` then \`git commit\` with EXACTLY this message (use a heredoc; keep the Co-Authored-By trailer):

${message}

Return DONE with the short hash from \`git log --oneline -1\`. Do not amend, reset, rebase or push. If the commit is refused by a hook, return FAILED with the output verbatim.`,
    {
      label,
      phase: "Steps",
      schema: GIT_SCHEMA,
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

1. \`git status --short\` must be empty and \`git branch --show-current\` must be \`main\`. If not, ok=false with the reason.
2. \`docker ps\` must show a running Postgres container (the full gate needs it). If not, ok=false.
3. Read \`docs/plan/README.md\`. Find the ONE row whose Status is **in progress**. If there is none, report status "none" and ok=false ("no deliverable in progress — open one first"). Read its plan file in full.
4. For that plan file, list every step under "## Build order" in order: its id (\`D<n>.<k>\`), its title, whether it is done (its heading is struck through \`~~…~~\` and/or carries "**done**" / a "**Closed.**" paragraph), and — for a pending step — whether it names an ADR that is still \`proposed\` in docs/adr/README.md AND whose acceptance is NOT the step's own job ("accepted at the head of D<n>.<k>" for this very step means the step accepts it itself, which is fine; a step that merely depends on an ADR another step accepts, while that ADR is still proposed, is gated). Put the gating ADR number in gatedOnProposedAdr, else an empty string.

ok=true only if 1–3 hold and the deliverable is in progress.`,
    {
      label: "preflight",
      phase: "Preflight",
      schema: PREFLIGHT_SCHEMA,
      effort: "low",
    },
  );

  if (!pre || !pre.ok) {
    return stop("preflight", pre ? pre.reason : "preflight agent unavailable", {
      shipped,
      opened,
    });
  }

  const d = pre.deliverable;
  const pending = d.steps.filter((s) => !s.done);
  log(
    `${d.id}: ${d.steps.length - pending.length} done, ${pending.length} pending — ${pending.map((s) => s.id).join(", ") || "none"}`,
  );

  // --------------------------------------------------------------- Steps
  phase("Steps");

  const stepReports = [];
  for (const step of pending) {
    if (step.gatedOnProposedAdr) {
      return stop(
        step.id,
        `gated: ${step.gatedOnProposedAdr} is still proposed and this step does not accept it (ADR-0025 rule 3)`,
        { shipped, opened, stepReports },
      );
    }

    log(`${step.id} — ${step.title}: building`);

    const build = await agent(
      `Execute plan step ${step.id} ("${step.title}") of ${d.planFile} end to end, exactly as the \`plan-step\` skill prescribes — invoke that skill with argument ${step.id} and follow it — with TWO exceptions: (a) do NOT run adr-reviewer / security-reviewer yourself (the workflow runs the review-step workflow on your output next), and (b) do NOT commit — leave every change in the working tree and return the conventional commit message you would have used (subject \`<type>(<scope>): …\`, a body in the repo's style, ending with the line \`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>\`).

Everything else applies in full: read the ADRs the step names; if the step's ADR is \`proposed\` and the plan says it is accepted at the head of THIS step, accept it (status line + the index row + the plan's Gate paragraph, dated today 2026-08-22) before building; build; write tests; run \`pnpm check\` in the loop and the full gate \`pnpm lint && pnpm check-types && pnpm test\` before you finish (Postgres is up); update the docs the step touches — the plan file's step notes written the way D4/D5 steps wrote theirs (the heading struck through with the date, a **Closed.** paragraph, what the step found recorded rather than folded into "done", evidence separated into machine-verified vs not walked), ADR amendments labelled \`**Amended 2026-08-22 (${step.id}).**\`, the ADR index's Implemented column, Postman via /postman-sync when an endpoint changed, .env.example when a variable did. Anything that needs a browser (a walk against the dev stack) is recorded as "not walked — pending operator acceptance", never claimed.

If the gate cannot be made green, or the step needs a decision only the operator can make, return outcome "blocked" with the reason in \`unresolved\` — do not work around an ADR and do not skip tests.`,
      {
        label: `build:${step.id}`,
        phase: "Steps",
        schema: BUILD_SCHEMA,
        agentType: "general-purpose",
      },
    );

    if (!build || build.outcome !== "built") {
      return stop(step.id, build ? build.unresolved : "builder unavailable", {
        shipped,
        opened,
        stepReports,
      });
    }

    // Review → fix → review, bounded.
    let review = null;
    let rounds = 0;
    while (true) {
      // scriptPath rather than the name "review-step": the top-level Workflow
      // tool call and this nested one share one registry, and it has been
      // observed stale for repo-authored scripts in at least one session
      // (falling back to only the built-in "deep-research"). A path bypasses
      // that registry entirely and always resolves the canonical file.
      review = await workflow(
        {
          scriptPath:
            "C:\\Users\\SergejsMoskanovs\\code\\lab\\machxi-starter\\.claude\\workflows\\review-step.mjs",
        },
        { range: "HEAD", gate: reviewGate },
      );
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
          {
            shipped,
            opened,
            stepReports,
            lastReview: review,
          },
        );
      }
      rounds += 1;
      log(
        `${step.id}: fix round ${rounds} — gate ${review && review.gate ? review.gate.result : "n/a"}, ${blocking.length} blocking finding(s)`,
      );

      const fix = await agent(
        `Step ${step.id} of ${d.planFile} is built in the working tree (uncommitted) and its review found the following. Fix every item, re-run \`pnpm check\` and then the full gate \`pnpm lint && pnpm check-types && pnpm test\`, and update the step's plan notes / ADR amendment if a fix changes what they claim. Do not commit. Do not skip or weaken a test to make it pass; if a finding is wrong, say so in the summary and leave it.

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
    }

    const committed = await commit(build.commitMessage, `commit:${step.id}`);
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
      minorFindings: review
        ? review.confirmed.filter((f) => f.severity === "MINOR")
        : [],
      fixRounds: rounds,
    });
  }

  // --------------------------------------------------------------- Close
  phase("Close");

  const close = await agent(
    `Confirm or perform the close of ${d.id} (${d.planFile}) per ADR-0025 rule 4 — all three parts or it is not closed: the definition-of-done checklist run, the ledger row in docs/plan/README.md moved to **shipped 2026-08-22**, and the amendment window shut (the plan's status line, docs/plan/README.md §Rules, CLAUDE.md's deliverable and "amendable set" sentences, and the ADR index's window bullet all saying the deliverable's ADRs are now frozen and the NEXT planned deliverable is next).

Read the plan file first. If its last step was a close-out step that already did all of this and the ledger row already reads shipped, verify and return shipped=true with nothing changed. Otherwise do it now, in the house style: run every machine-verifiable checklist item (the gate; \`pnpm test:unit\` twice with the second FULL TURBO; \`pnpm format:check\`; \`pnpm test:postman\` if the API changed and the dev API is up — if it is not, record it); write the ledger's "## How ${d.id} closed, and on what evidence" section with the evidence separated exactly as D3–D5 did (machine-verified / walked / accepted by the operator); every browser-only item is listed under operatorAccepted and written as "accepted by the operator rather than machine-verified" — never claimed as walked; mark each ADR of this deliverable as closed in the index narrative. Leave the changes uncommitted and return the summary.`,
    {
      label: `close:${d.id}`,
      phase: "Close",
      schema: CLOSE_SCHEMA,
      agentType: "general-purpose",
    },
  );
  if (!close || !close.shipped) {
    return stop("close", close ? close.summary : "close agent unavailable", {
      shipped,
      opened,
      stepReports,
    });
  }
  const closeCommit = await commit(
    `docs(plan): ${d.id} ships

The acceptance checklist run, the ledger row moved and the window shut — ADR-0025 rule 4's three parts together. Browser-only items are recorded as pending operator acceptance rather than claimed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
    `commit:close:${d.id}`,
  );
  if (closeCommit && closeCommit.result === "FAILED") {
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
    closeCommit: closeCommit ? closeCommit.detail : "",
  });
  deliverablesRun += 1;
  log(`${d.id} shipped`);

  // ---------------------------------------------------------------- Ship
  phase("Ship");

  let push = { result: "NOTHING_TO_DO", detail: "push disabled by args" };
  if (doPush) {
    push = await agent(
      `Push main: run exactly \`git push origin main\`. If the command is refused by a permission prompt or policy, return DENIED with the refusal verbatim — do not retry, do not force, do not try another remote or branch. If the remote rejects it (non-fast-forward or similar), return FAILED with the output verbatim — do not pull, rebase or force. On success return DONE with the output.`,
      {
        label: `push:${d.id}`,
        phase: "Ship",
        schema: GIT_SCHEMA,
        effort: "low",
        agentType: "general-purpose",
      },
    );
  }
  shipped[shipped.length - 1].push = push;
  log(`push: ${push ? push.result : "unavailable"}`);
  if (push && push.result === "FAILED") {
    return stop("ship", `push failed: ${push.detail}`, { shipped, opened });
  }

  // ---------------------------------------------------------------- Next
  if (mode === "ship") break;

  phase("Next");

  const open = await agent(
    `Open the next deliverable, as far as an unattended run may. Read docs/plan/README.md: the next row after ${d.id} with Status "planned" is the candidate; read its plan (scope) file in full, plus ADR-0025 and the ledger's "How D4 opened" / "How D5 opened" / "How D6 opened" sections and docs/plan/0006-user-settings.md as the template for what an opened plan looks like.

FIRST decide needsOperator. The operator's decisions arrive as ADRs written ahead of opening (the D4 precedent — "writing is not opening"): check docs/adr/README.md for ADR(s) already written for this deliverable, \`proposed\` or \`accepted\`. A decision those ADRs make is decided. needsOperator is true if ANY of the following is NOT covered by an existing ADR for this deliverable: an assumption the scope file lists as unconfirmed; a "Decisions this deliverable needs" item that is a contested choice between approaches (a library, a storage shape, a protocol); a new app or package (a roster decision); a supersession of a frozen ADR. If needsOperator is true: do NOT open it. Return opened=false with the precise questions the operator must answer, one per line, each with your recommended answer — and change nothing.

If needsOperator is false: open it the way D6 was opened — using the ADR(s) already written, or writing any still-missing additive one \`proposed\` via the adr-author conventions (docs/adr/README.md table row + Planned-list cleanup + narrative paragraph), rewrite the plan file with a build order of numbered steps each naming its ADRs and a done-when, a Gate paragraph, and a Definition of done; flip the ledger row to in progress with an opening date of 2026-08-22 and a "## How D<n> opened" section; update CLAUDE.md's deliverable sentences and amendable set; run \`pnpm exec prettier --write\` on the touched docs; commit with \`docs(plan): open D<n> — <title> — with ADR-<nnnn> proposed\` and the Co-Authored-By trailer. Return opened=true.`,
    {
      label: "open-next",
      phase: "Next",
      schema: OPEN_SCHEMA,
      agentType: "general-purpose",
    },
  );
  if (!open)
    return stop("open-next", "opener unavailable", { shipped, opened });
  if (!open.opened) {
    log(
      `next deliverable needs the operator: ${open.questions.length} question(s)`,
    );
    return {
      stopped: true,
      where: "open-next",
      why: "operator decision required",
      questions: open.questions,
      summary: open.summary,
      shipped,
      opened,
    };
  }
  opened.push({ deliverable: open.deliverable, summary: open.summary });
  log(`${open.deliverable} opened (proposed)`);

  if (mode !== "chain" || deliverablesRun >= maxDeliverables) break;
}

return { stopped: false, mode, shipped, opened };
