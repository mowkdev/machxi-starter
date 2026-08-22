/**
 * step-review — the close-out review of one plan step. v2, from scratch.
 *
 * Ground truth first, judgement second, and judgement only where it is
 * cheap to be wrong about. The gate (ADR-0026's tiers) and the reviewers run
 * concurrently; if the gate is red the findings are returned raw and no
 * refuter is spent on code that will change anyway. Refutation is reserved
 * for BLOCKER/MAJOR findings — a MINOR never blocks, so it is reported, not
 * litigated — with one lens per finding and one identical agent configuration
 * across the fan-out so the batch shares a prompt-cache prefix.
 *
 * Measured basis (the D6→D7 run on v1): 22 findings raised, 26 of 27 refuter
 * votes rejected them, 0–1 confirmed. So the reviewer is asked for precision
 * over recall, and the run returns its own precision so the next one can be
 * compared.
 *
 * Invoke by scriptPath (the name registry is stale for repo scripts):
 *   Workflow({ scriptPath: "<root>/.claude/workflows/step-review.mjs", args: { root } })
 *
 * args:
 *   root      absolute path of the checkout to review (the worktree when run
 *             unattended). Default: the session's cwd — every agent runs there.
 *   range     git diff range. Default "HEAD" (the uncommitted step).
 *   gate      "auto" (default: the scout's ADR-0026 tier) | "full" | "check" | "none"
 *   security  force the security reviewer on/off; default: the scout decides.
 *
 * Returns — fields are only added, never renamed:
 *   { gate, gateTier, files, linesChanged, securityReviewed,
 *     confirmed[], refuted[], minors[], unverified[],
 *     stats: { raised, refutedCount, confirmedCount, agents } }
 */
export const meta = {
  name: "step-review",
  description:
    "Review one step: gate and reviewers concurrently, BLOCKER/MAJOR findings refuted once, MINORs reported; returns findings plus its own precision",
  whenToUse:
    "At the close of a plan step, from deliverable-build or by hand before a commit that touches core, auth or shared machinery",
  phases: [
    { title: "Scout", detail: "touched paths → gate tier, security relevance" },
    { title: "Review", detail: "gate ∥ adr-reviewer ∥ security-reviewer" },
    { title: "Refute", detail: "one lens per BLOCKER/MAJOR" },
  ],
};

const root = (args && args.root) || "";
const cwdNote = root
  ? `Work in ${root} — run every command from that directory and read/write files only under it.`
  : "";
const range = (args && args.range) || "HEAD";
const gateArg = (args && args.gate) || "auto";
const securityArg = args ? args.security : undefined;

let agents = 0;
const spawn = (prompt, opts) => {
  agents += 1;
  return agent(`${cwdNote}\n\n${prompt}`.trim(), opts);
};

// ------------------------------------------------------------------ schemas

const SCOUT = {
  type: "object",
  required: [
    "files",
    "linesChanged",
    "touchesApi",
    "securityRelevant",
    "reason",
  ],
  properties: {
    files: { type: "array", items: { type: "string" } },
    linesChanged: { type: "integer" },
    touchesApi: { type: "boolean" },
    securityRelevant: { type: "boolean" },
    reason: { type: "string" },
  },
};

const FINDINGS = {
  type: "object",
  required: ["findings", "verdict"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "adr", "file", "line", "quote", "rule", "fix"],
        properties: {
          severity: { type: "string", enum: ["BLOCKER", "MAJOR", "MINOR"] },
          adr: { type: "string", description: "ADR-0009 … or 'none'" },
          file: { type: "string" },
          line: { type: "integer" },
          quote: {
            type: "string",
            description: "the offending line, verbatim from the diff",
          },
          rule: {
            type: "string",
            description: "the ADR sentence violated, verbatim",
          },
          fix: { type: "string", description: "the smallest fix" },
        },
      },
    },
    verdict: { type: "string" },
  },
};

const GATE = {
  type: "object",
  required: ["result", "command", "summary", "failures"],
  properties: {
    result: { type: "string", enum: ["PASS", "FAIL", "BLOCKED"] },
    command: { type: "string" },
    summary: { type: "string" },
    failures: { type: "string" },
  },
};

const VERDICT = {
  type: "object",
  required: ["refuted", "reason"],
  properties: { refuted: { type: "boolean" }, reason: { type: "string" } },
};

// -------------------------------------------------------------------- Scout

phase("Scout");

const scout = await spawn(
  `Run \`git diff --stat ${range}\`, \`git diff --name-only ${range}\` and \`git status --short\`. Return every touched path (modified, staged, untracked under apps/, packages/, docs/, .claude/, root config), the lines changed, and:
- touchesApi: any path under apps/api/, packages/db/, packages/contracts/, or turbo.json, pnpm-lock.yaml, any package.json (ADR-0026: these can break the integration tier or the build graph).
- securityRelevant: any path under apps/api/src/core/, auth/session/CSRF/middleware/config code, an admin-segment endpoint (apps/api/src/routes/admin.router.ts or a module's *.routes.ts mounted there), or apps/admin/src/shared/api (ADR-0033).
One-line reason.`,
  {
    label: "scout",
    phase: "Scout",
    schema: SCOUT,
    model: "haiku",
    effort: "low",
  },
);

const files = scout ? scout.files : [];
const touchesApi = scout ? scout.touchesApi : true;
const securityRelevant =
  securityArg === undefined
    ? Boolean(scout && scout.securityRelevant)
    : Boolean(securityArg);
const gateTier = gateArg === "auto" ? (touchesApi ? "full" : "check") : gateArg;
log(
  `${files.length} file(s), ${scout ? scout.linesChanged : "?"} lines — gate=${gateTier}, security ${securityRelevant ? "on" : "off"}: ${scout ? scout.reason : "scout unavailable"}`,
);

// ------------------------------------------------------------------- Review

phase("Review");

const diffNote = `the diff \`git diff ${range}\`, plus every untracked file under apps/ and packages/ that \`git status --short\` lists, read in full`;

const jobs = [];
if (gateTier !== "none") {
  jobs.push(() =>
    spawn(
      gateTier === "full"
        ? "Run the full gate: `pnpm lint && pnpm check-types && pnpm test`. `docker ps` first; BLOCKED if Postgres is down."
        : "Run `pnpm check`.",
      {
        label: `gate:${gateTier}`,
        phase: "Review",
        schema: GATE,
        agentType: "gate-runner",
      },
    ),
  );
}
jobs.push(() =>
  spawn(
    `Review ${diffNote} against the ADRs, following your procedure.

Precision over recall — every finding you list costs a fix round if true and a refuter if false. A finding is admissible only with BOTH: \`quote\` = the offending line verbatim from THIS diff, and \`rule\` = the ADR sentence it violates, verbatim, after checking that ADR's own amendments and its successor if it is superseded. A suspicion that fails either check goes in the verdict paragraph as a note, not in findings. Severity: BLOCKER = a CLAUDE.md non-negotiable or a frozen ADR with no superseding record; MAJOR = an ADR rule that later work will build on; MINOR = style or a missing test. If the code is right and an ADR is wrong or silent, say so in the verdict and recommend /new-adr.`,
    {
      label: "adr-reviewer",
      phase: "Review",
      schema: FINDINGS,
      agentType: "adr-reviewer",
    },
  ),
);
if (securityRelevant) {
  jobs.push(() =>
    spawn(
      `Security-review ${diffNote} per ADR-0018 (auth), 0019 (guards), 0020 (baseline), 0013 (error leakage), 0004/0005 (secrets, redaction), 0033 (browser session). Same admissibility rule: \`quote\` the line from this diff and \`rule\` the ADR sentence, or keep it to the verdict. BLOCKER = exploitable or a secret/credential exposure; MAJOR = weakens a guarantee an ADR makes; MINOR = hardening.`,
      {
        label: "security-reviewer",
        phase: "Review",
        schema: FINDINGS,
        agentType: "security-reviewer",
      },
    ),
  );
}

const results = await parallel(jobs);
let i = 0;
const gate = gateTier !== "none" ? results[i++] : null;
const adrReview = results[i++];
const secReview = securityRelevant ? results[i++] : null;

const seen = new Set();
const raised = []
  .concat(
    adrReview ? adrReview.findings.map((f) => ({ ...f, source: "adr" })) : [],
  )
  .concat(
    secReview
      ? secReview.findings.map((f) => ({ ...f, source: "security" }))
      : [],
  )
  .filter((f) => {
    const k = `${f.file}:${f.line}:${f.adr}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

const minors = raised.filter((f) => f.severity === "MINOR");
const serious = raised.filter((f) => f.severity !== "MINOR");
const gateRed = gateTier !== "none" && (!gate || gate.result !== "PASS");
log(
  `gate ${gate ? gate.result : "skipped"}; ${raised.length} finding(s): ${serious.length} serious, ${minors.length} minor`,
);

// ------------------------------------------------------------------- Refute

phase("Refute");

// No refuter on red code: the fix round will change it anyway, and a fixer
// reads raw findings fine. Refute only what would block a green step.
const toRefute = gateRed ? [] : serious.slice(0, 10);
if (gateRed && serious.length)
  log(`gate red — ${serious.length} serious finding(s) returned unrefuted`);
if (serious.length > toRefute.length && !gateRed)
  log(
    `refutation cap: ${serious.length - toRefute.length} serious finding(s) reported unverified`,
  );

// One configuration for the whole fan-out, so the batch shares a cache prefix.
const verdicts = await parallel(
  toRefute.map(
    (f) => () =>
      spawn(
        `Refute this finding against ${diffNote}:

  [${f.severity}] ${f.adr} — ${f.file}:${f.line}
  quoted code: ${f.quote}
  rule cited:  ${f.rule}
  proposed fix: ${f.fix}

Open the file at that line and the ADR. It is refuted if the quoted code is not in the diff at that place; the cited sentence is not in the ADR, or its amendments or successor allow the code; a CLAUDE.md or ADR exception applies; or the fix would violate another ADR. It stands only if line and sentence together make it true. Default to refuted=true when you cannot confirm both.`,
        {
          label: `refute:${f.file.split("/").pop()}:${f.line}`,
          phase: "Refute",
          schema: VERDICT,
          agentType: "adr-reviewer",
          effort: "medium",
        },
      ),
  ),
);

const confirmed = [];
const refuted = [];
toRefute.forEach((f, n) => {
  const v = verdicts[n];
  const stands = !v || !v.refuted; // an unavailable refuter does not dismiss a serious finding
  (stands ? confirmed : refuted).push({
    ...f,
    verdict: v ? v.reason : "refuter unavailable — kept",
  });
});
const unverified = gateRed ? serious : serious.slice(toRefute.length);

const stats = {
  raised: raised.length,
  refutedCount: refuted.length,
  confirmedCount: confirmed.length,
  agents,
};
log(
  `confirmed ${confirmed.length}, refuted ${refuted.length}, minors ${minors.length}, unverified ${unverified.length}; ${agents} agents`,
);

return {
  gate,
  gateTier,
  files,
  linesChanged: scout ? scout.linesChanged : null,
  securityReviewed: securityRelevant,
  confirmed,
  refuted,
  minors,
  unverified,
  verdicts: {
    adr: adrReview ? adrReview.verdict : "adr-reviewer unavailable",
    security: secReview
      ? secReview.verdict
      : securityRelevant
        ? "security-reviewer unavailable"
        : "not in scope",
  },
  stats,
};
