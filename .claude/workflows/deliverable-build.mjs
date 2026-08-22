/**
 * deliverable-build — build the in-progress deliverable to `shipped`,
 * unattended, in a worktree. v2, from scratch.
 *
 * The building half. It runs where it is launched — a worktree on its own
 * branch, never the main checkout (preflight refuses `main` and refuses the
 * main working tree) — so the operator's desk and the robot never share a
 * tree. Every pending step in order: build through the `plan-step` skill with
 * the step's own text in the brief, `step-review` (gate ∥ reviewers, serious
 * findings refuted once), bounded fix rounds, one commit by explicit path.
 * Then the ADR-0025 rule 4 close, the branch pushed and a PR opened (or a
 * fast-forward push to main, by choice), and — in chain mode — the next
 * deliverable only when `deliverable-verify` reports it ready — the operator
 * wrote its ADRs by hand; stage 2 checked them; nothing is drafted here.
 *
 * Invoke by scriptPath, from the worktree (the /run-deliverable skill does
 * this: EnterWorktree, then Workflow with root = the worktree path):
 *   { root, mode: "ship" | "open-next" | "chain", maxDeliverables, maxFixRounds, push, merge }
 *
 * args:
 *   root             REQUIRED — the worktree's absolute path; every agent works there.
 *   mode             "ship" (default) | "open-next" | "chain".
 *   maxDeliverables  chain cap (default 1).
 *   maxFixRounds     per step (default 2).
 *   push             default true.
 *   merge            "pr" (default: push the branch, `gh pr create` against main)
 *                    | "main" (fast-forward `git push origin HEAD:main`, never forced).
 *
 * Invariants:
 *   - Refuses to run on `main` or in the main working tree; refuses a dirty
 *     tree; refuses a plan it cannot execute mechanically (a pending step
 *     without ADRs or a done-when, or gated on a `proposed` ADR nobody accepts).
 *   - Steps strictly in order; nothing marked done that is not green; a step
 *     still red after maxFixRounds stops the run.
 *   - Commits by explicit path; `git push` of this branch only (or the
 *     fast-forward to main); no reset, rebase, force or branch deletion.
 *   - Browser-only acceptance items are recorded as pending operator
 *     acceptance, never claimed.
 *
 * Cost shape per step: 1 builder (the long one) + step-review (scout and gate
 * on haiku, 1–2 reviewers, one refuter per serious finding) + ≤2 fixers + 1
 * committer on haiku. Measured basis: v1's D6→D7 run — builders were 82% of
 * agent-minutes, review/refute 27 agents, refuters rejected 26 of 27.
 */
export const meta = {
  name: "deliverable-build",
  description:
    "In a worktree: build every pending step of the in-progress deliverable — build, step-review, fix, commit — close it, push the branch and open a PR, and chain only when deliverable-verify says ready",
  whenToUse:
    "Launched by /run-deliverable from a worktree when the operator steps away",
  phases: [
    {
      title: "Preflight",
      detail: "worktree branch, clean, Postgres, steps parsed and ungated",
    },
    { title: "Steps", detail: "per step: build → step-review → fix → commit" },
    { title: "Close", detail: "checklist, ledger row, window shut" },
    { title: "Ship", detail: "push the branch; PR or fast-forward to main" },
    {
      title: "Next",
      detail: "deliverable-verify, then open — or stop with its issues",
    },
  ],
};

const root = (args && args.root) || "";
const mode = (args && args.mode) || "ship";
const maxDeliverables = (args && args.maxDeliverables) || 1;
const maxFixRounds =
  args && args.maxFixRounds !== undefined ? args.maxFixRounds : 2;
const doPush = !(args && args.push === false);
const merge = (args && args.merge) || "pr";
const cwdNote = root
  ? `Work in ${root} — run every command from that directory and read/write files only under it.`
  : "";
const STEP_REVIEW = `${root}/.claude/workflows/step-review.mjs`;
const VERIFY = `${root}/.claude/workflows/deliverable-verify.mjs`;

let agents = 0;
const spawn = (prompt, opts) => {
  agents += 1;
  return agent(`${cwdNote}\n\n${prompt}`.trim(), opts);
};

// ------------------------------------------------------------------ schemas

const PREFLIGHT = {
  type: "object",
  required: ["ok", "reason", "branch", "deliverable"],
  properties: {
    ok: { type: "boolean" },
    reason: { type: "string" },
    branch: { type: "string" },
    deliverable: {
      type: "object",
      required: ["id", "title", "planFile", "steps"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        planFile: { type: "string" },
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
              id: { type: "string" },
              title: { type: "string" },
              done: { type: "boolean" },
              adrs: { type: "array", items: { type: "string" } },
              acceptsAdr: { type: "string" },
              gatedOn: { type: "string" },
              body: { type: "string" },
              doneWhen: { type: "string" },
            },
          },
        },
      },
    },
  },
};

const BUILD = {
  type: "object",
  required: [
    "outcome",
    "summary",
    "commitMessage",
    "files",
    "adrAmendments",
    "unresolved",
  ],
  properties: {
    outcome: { type: "string", enum: ["built", "blocked"] },
    summary: { type: "string" },
    commitMessage: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    adrAmendments: { type: "array", items: { type: "string" } },
    unresolved: { type: "string" },
  },
};

const FIX = {
  type: "object",
  required: ["fixed", "summary", "files"],
  properties: {
    fixed: { type: "boolean" },
    summary: { type: "string" },
    files: { type: "array", items: { type: "string" } },
  },
};
const GIT = {
  type: "object",
  required: ["result", "detail"],
  properties: {
    result: {
      type: "string",
      enum: ["DONE", "DENIED", "FAILED", "NOTHING_TO_DO"],
    },
    detail: { type: "string" },
  },
};
const CLOSE = {
  type: "object",
  required: ["shipped", "summary", "operatorAccepted", "files"],
  properties: {
    shipped: { type: "boolean" },
    summary: { type: "string" },
    operatorAccepted: { type: "array", items: { type: "string" } },
    files: { type: "array", items: { type: "string" } },
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

const stop = (where, why, state) => {
  log(`STOP at ${where}: ${why}`);
  return { stopped: true, where, why, agents, ...state };
};

const commitPaths = (files, message, label, phaseName) =>
  spawn(
    `Commit exactly these paths — never \`git add -A\` or \`git add .\`. Run \`git status --short\` first and ALSO add any listed path under the same directories as these (a builder sometimes forgets a generated file, a snapshot or a lockfile it caused); name what you added beyond the set in \`detail\`.
${files.map((f) => `  ${f}`).join("\n")}
Then \`git commit\` with EXACTLY this message via a heredoc:

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

const fmtFindings = (fs) =>
  fs
    .map(
      (f) =>
        `- [${f.severity}] ${f.adr} — ${f.file}:${f.line}\n  code: ${f.quote}\n  rule: ${f.rule}\n  fix: ${f.fix}`,
    )
    .join("\n");

// ---------------------------------------------------------------------- run

if (!root)
  return stop("args", "root is required — the worktree's absolute path", {});

const shipped = [];
const opened = [];
const metrics = [];
let deliverablesRun = 0;

while (true) {
  phase("Preflight");

  const pre = await spawn(
    `Preflight for an unattended build in a WORKTREE. Facts only; repair only what is named.
1. \`git rev-parse --show-toplevel\` must be ${root}; \`git rev-parse --git-dir\` must differ from \`git rev-parse --git-common-dir\` (a linked worktree, not the main checkout); \`git branch --show-current\` must not be \`main\`. Else ok=false.
2. \`git status --short\` empty; else ok=false.
3. \`docker ps\` shows a running Postgres container; else ok=false.
4. If node_modules/ is missing run \`pnpm i\` (the store makes it fast). If .env or apps/admin/.env is missing, copy each from the main checkout (the parent of \`git rev-parse --git-common-dir\`); if that copy fails, ok=false.
5. Read docs/plan/README.md; find the ONE row **in progress** (none → ok=false). Read its plan file in full and docs/adr/README.md's table.
6. For every "## Build order" step, in order: id, title, done (struck-through heading / "**done**" / a "**Closed.**" paragraph), the ADR numbers on "**ADRs:**", acceptsAdr (the ADR the Gate paragraph says THIS step accepts at its head), gatedOn (an ADR it names that the index still lists \`proposed\` and that neither this step nor an earlier pending step accepts), body (its descriptive paragraphs verbatim, not the Closed/evidence notes), doneWhen (the "**Done when:**" text).
7. ok=false if a PENDING step (a step titled Close-out exempt from the ADR requirement) has no adrs, no doneWhen, or a gatedOn — name it.
8. THE STAMP. The plan's header list must carry a line beginning "- Verified for build" with a short hash (deliverable-verify wrote it); none → ok=false "not verified — run /verify-deliverable". Then check drift since that hash: \`git diff --name-only <hash> HEAD -- docs/adr/\` — every changed ADR must be one of this deliverable's own (named on the pending steps' ADRs lines), and its diff (\`git diff <hash> HEAD -- <file>\`) must consist only of its acceptance (the Status line, the index row) or amendments labelled "Amended … (<this deliverable>.N)" — any other ADR changed, or an unlabelled change, → ok=false naming it. And for every PENDING step, its "**ADRs:**" line and "**Done when:**" text must be identical to \`git show <hash>:<planFile>\` — a changed decision is not the verified one → ok=false. Step notes, struck headings and the ledger may change freely.`,
    {
      label: "preflight",
      phase: "Preflight",
      schema: PREFLIGHT,
      effort: "low",
    },
  );
  if (!pre || !pre.ok)
    return stop("preflight", pre ? pre.reason : "preflight agent unavailable", {
      shipped,
      opened,
      metrics,
    });

  const d = pre.deliverable;
  const pending = d.steps.filter((s) => !s.done);
  log(
    `${d.id} — ${d.title} on ${pre.branch}: ${d.steps.length - pending.length} done, ${pending.length} pending — ${pending.map((s) => s.id).join(", ") || "none"}`,
  );

  phase("Steps");
  const stepReports = [];
  for (const step of pending) {
    log(`${step.id} — ${step.title}: building`);

    const build = await spawn(
      `Execute plan step ${step.id} — "${step.title}" — of ${d.planFile} (${d.id}, ${d.title}), as the \`plan-step\` skill prescribes: invoke that skill with argument ${step.id} and follow it, with two exceptions — (a) do NOT run adr-reviewer / security-reviewer (step-review runs next), (b) do NOT commit: leave every change in the tree and return the conventional commit message you would have used (subject \`<type>(<scope>): …\`, a body in the repo's style, ending with \`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>\`) plus every file you created or modified.

The step as the plan states it — still read the ADRs it names in full:
ADRs: ${step.adrs.map((n) => `ADR-${n}`).join(", ") || "none"}${step.acceptsAdr ? `\nThis step ACCEPTS ADR-${step.acceptsAdr} at its head (ADR-0025 rule 3): status line → accepted 2026-08-22, the index row, the plan's Gate paragraph — before building.` : ""}

${step.body}

Done when: ${step.doneWhen}

Everything else in full: build; tests; \`pnpm check\` in the loop and the full gate \`pnpm lint && pnpm check-types && pnpm test\` before you finish; the plan file's step notes written the way D6/D7 steps wrote theirs (heading struck through with the date, a **Closed.** paragraph, what the step found recorded, evidence separated into machine-verified vs not walked); ADR amendments labelled \`**Amended 2026-08-22 (${step.id}).**\`; the index's Implemented column; /postman-sync when an endpoint changed; .env.example when a variable did. Anything needing a browser is "not walked — pending operator acceptance", never claimed. If the gate cannot be made green, or a decision only the operator can make is needed, return "blocked" with the reason — never work around an ADR, never weaken a test.`,
      {
        label: `build:${step.id}`,
        phase: "Steps",
        schema: BUILD,
        agentType: "general-purpose",
      },
    );
    if (!build || build.outcome !== "built")
      return stop(step.id, build ? build.unresolved : "builder unavailable", {
        shipped,
        opened,
        stepReports,
        metrics,
      });

    const touched = new Set(build.files);
    let review = null;
    let rounds = 0;
    while (true) {
      review = await workflow(
        { scriptPath: STEP_REVIEW },
        { root, range: "HEAD" },
      );
      const gateRed = !review || !review.gate || review.gate.result !== "PASS";
      const blocking = review ? review.confirmed.concat(review.unverified) : [];
      if (!gateRed && blocking.length === 0) break;
      if (rounds >= maxFixRounds) {
        return stop(
          step.id,
          `still ${gateRed ? "red on the gate" : ""}${gateRed && blocking.length ? " and " : ""}${blocking.length ? `${blocking.length} serious finding(s)` : ""} after ${rounds} fix round(s)`,
          { shipped, opened, stepReports, metrics, lastReview: review },
        );
      }
      rounds += 1;
      log(
        `${step.id}: fix round ${rounds} — gate ${review && review.gate ? review.gate.result : "n/a"}, ${blocking.length} serious`,
      );
      const fix = await spawn(
        `Step ${step.id} of ${d.planFile} is built and uncommitted; its review found the following. Fix every item, re-run \`pnpm check\` then the full gate \`pnpm lint && pnpm check-types && pnpm test\`, and update the step notes / ADR amendment if a fix changes what they claim. Do not commit. Never weaken a test; if a finding is wrong, say so and leave it. Return every file touched.

GATE: ${review && review.gate ? `${review.gate.result} — ${review.gate.summary}\n${review.gate.failures}` : "not run"}

SERIOUS FINDINGS:
${fmtFindings(blocking) || "- none"}${review && review.minors.length ? `\n\nMINOR (fix if cheap):\n${fmtFindings(review.minors)}` : ""}`,
        {
          label: `fix:${step.id}#${rounds}`,
          phase: "Steps",
          schema: FIX,
          agentType: "general-purpose",
        },
      );
      if (!fix)
        return stop(step.id, "fixer unavailable", {
          shipped,
          opened,
          stepReports,
          metrics,
          lastReview: review,
        });
      fix.files.forEach((f) => touched.add(f));
    }

    const committed = await commitPaths(
      [...touched],
      build.commitMessage,
      `commit:${step.id}`,
      "Steps",
    );
    if (!committed || committed.result !== "DONE")
      return stop(
        step.id,
        `commit ${committed ? committed.result : "unavailable"}: ${committed ? committed.detail : ""}`,
        { shipped, opened, stepReports, metrics },
      );
    log(`${step.id} committed ${committed.detail}`);
    stepReports.push({
      step: step.id,
      commit: committed.detail,
      summary: build.summary,
      adrAmendments: build.adrAmendments,
      fixRounds: rounds,
      minors: review ? review.minors : [],
    });
    metrics.push({
      step: step.id,
      gateTier: review ? review.gateTier : null,
      fixRounds: rounds,
      review: review ? review.stats : null,
    });
  }

  phase("Close");
  const close = await spawn(
    `Confirm or perform the close of ${d.id} (${d.planFile}) per ADR-0025 rule 4 — all three parts: the definition-of-done checklist run, the ledger row moved to **shipped 2026-08-22**, the window shut (plan status line, ledger §Rules, CLAUDE.md's deliverable and amendable-set sentences, the ADR index's window bullet all saying this deliverable's ADRs are frozen and the next planned deliverable is next).
Read the plan first. If a Close-out step already did all of this and the row reads shipped, verify and return shipped=true with no files. Otherwise do it in the house style: run every machine-verifiable item (the gate; \`pnpm test:unit\` twice, second FULL TURBO; \`pnpm format:check\`; \`pnpm test:postman\` if the API changed and the dev API is up, else record it); write "## How ${d.id} closed, and on what evidence" with evidence separated as D3–D6 did; every browser-only item under operatorAccepted and written as accepted-by-the-operator, never walked. Include one line of run metrics: ${JSON.stringify(metrics)}. Leave changes uncommitted; return the files.`,
    {
      label: `close:${d.id}`,
      phase: "Close",
      schema: CLOSE,
      agentType: "general-purpose",
    },
  );
  if (!close || !close.shipped)
    return stop("close", close ? close.summary : "close agent unavailable", {
      shipped,
      opened,
      stepReports,
      metrics,
    });
  if (close.files.length) {
    const c = await commitPaths(
      close.files,
      `docs(plan): ${d.id} ships

The acceptance checklist run, the ledger row moved and the window shut — ADR-0025 rule 4's three parts together. Browser-only items are recorded as pending operator acceptance rather than claimed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
      `commit:close:${d.id}`,
      "Close",
    );
    if (c && c.result === "FAILED")
      return stop("close", `commit failed: ${c.detail}`, {
        shipped,
        opened,
        stepReports,
        metrics,
      });
  }
  shipped.push({
    deliverable: d.id,
    branch: pre.branch,
    steps: stepReports,
    operatorAccepted: close.operatorAccepted,
  });
  deliverablesRun += 1;
  log(`${d.id} shipped`);

  phase("Ship");
  let ship = { result: "NOTHING_TO_DO", detail: "push disabled by args" };
  if (doPush) {
    ship = await spawn(
      merge === "main"
        ? `Run exactly \`git push origin HEAD:main\` — a fast-forward push of this branch's commits to main without checking main out. If refused by a permission prompt or policy → DENIED with the refusal verbatim; if the remote rejects (non-fast-forward) → FAILED with the output — never pull, rebase or force. DONE with the output on success.`
        : `Push this branch and open the PR. Run \`git push -u origin ${pre.branch}\`; if refused by permission or policy → DENIED verbatim, no retry, no force. Then \`gh pr create --base main --title "${d.id} — ${d.title}" --body-file -\` with a body (heredoc) listing: the steps and their commits — ${stepReports.map((s) => `${s.step} ${s.commit}`).join(", ")} — the items pending operator acceptance: ${close.operatorAccepted.join("; ") || "none"}, and the line "🤖 Generated with [Claude Code](https://claude.com/claude-code)". If a PR for this branch already exists, say so and return DONE with its URL. DONE with the PR URL; FAILED with the output otherwise.`,
      {
        label: `ship:${d.id}`,
        phase: "Ship",
        schema: GIT,
        model: "haiku",
        effort: "low",
        agentType: "general-purpose",
      },
    );
  }
  shipped[shipped.length - 1].ship = ship;
  log(
    `ship: ${ship ? ship.result : "unavailable"} ${ship ? ship.detail.slice(0, 120) : ""}`,
  );
  if (ship && ship.result === "FAILED")
    return stop("ship", ship.detail, { shipped, opened, metrics });

  if (mode === "ship") break;

  phase("Next");
  // Stage 2 decides whether stage 3 may continue. Nothing is ever drafted here:
  // the operator writes decisions; this only checks and opens.
  const verdict = await workflow({ scriptPath: VERIFY }, { root });
  if (!verdict || verdict.error)
    return stop(
      "next",
      `deliverable-verify failed: ${verdict ? verdict.error : "unavailable"}`,
      { shipped, opened, metrics },
    );
  if (!verdict.ready) {
    log(
      `${verdict.deliverable} is not verified: ${verdict.issues.length} issue(s)`,
    );
    return {
      stopped: true,
      where: "next",
      why: "next deliverable not verified — fix its ADRs/plan at the desk, then /verify-deliverable",
      deliverable: verdict.deliverable,
      issues: verdict.issues,
      shipped,
      opened,
      metrics,
      agents,
    };
  }
  const openResult = await spawn(
    `Open ${verdict.deliverable} MECHANICALLY; refuse if not ready. Read docs/plan/README.md, ${verdict.planFile}, docs/adr/README.md, CLAUDE.md, and the ledger's "## How D6 opened" / "## How D7 opened" as the template. The plan carries a "Verified for build" stamp from deliverable-verify — that is the readiness evidence; cite it.
REFUSE (opened=false, say why, change nothing) if another row is in progress, or the stamp is missing.
Otherwise: plan status line → "**in progress**, opened 2026-08-22" naming the ADR(s) and that each is accepted at the head of its first implementing step (do NOT accept any ADR); ledger row → in progress (opened 2026-08-22); §Rules → the open window names this deliverable's ADR(s) only; a short "## How ${verdict.deliverable} opened" above "## How D6–D10 were scoped" that names the verification; CLAUDE.md's deliverable and amendable-set sentences; the ADR index's window bullet. \`pnpm exec prettier --write\` each .md touched. Return the files.`,
    {
      label: `open:${verdict.deliverable}`,
      phase: "Next",
      schema: OPENED,
      effort: "medium",
      agentType: "general-purpose",
    },
  );
  if (!openResult || !openResult.opened)
    return stop(
      "next",
      `open refused: ${openResult ? openResult.summary : "unavailable"}`,
      { shipped, opened, metrics },
    );
  const openCommit = await commitPaths(
    openResult.files,
    `docs(plan): open ${verdict.deliverable}

Verified for build by deliverable-verify at ${verdict.head}; the ledger row moves to in progress and the window opens on its ADR(s), which stay proposed until the first step accepts them.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`,
    `commit:open:${verdict.deliverable}`,
    "Next",
  );
  if (openCommit && openCommit.result === "FAILED")
    return stop("next", `open commit failed: ${openCommit.detail}`, {
      shipped,
      opened,
      metrics,
    });
  opened.push({
    deliverable: verdict.deliverable,
    summary: openResult.summary,
  });
  log(`${verdict.deliverable} opened`);
  if (mode !== "chain" || deliverablesRun >= maxDeliverables) break;
}

return { stopped: false, mode, shipped, opened, metrics, agents };
