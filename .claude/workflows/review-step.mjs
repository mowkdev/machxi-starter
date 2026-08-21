/**
 * review-step — the close-out review of one plan step, as a workflow.
 *
 * What /plan-step step 5 does by hand, orchestrated: the architecture and
 * security reviewers run **concurrently** with the fast gate, every finding
 * is then handed to an independent refuter before it reaches the report, and
 * what comes back is one ranked list plus the gate's verdict — not three
 * transcripts to reconcile.
 *
 * Invoke (opt-in, like every workflow):
 *   Workflow({ name: "review-step" })
 *   Workflow({ name: "review-step", args: { range: "main...HEAD" } })
 *   Workflow({ name: "review-step", args: { range: "HEAD", gate: "full", security: true } })
 *
 * args (all optional):
 *   range     git diff range the reviewers read. Default "HEAD" — everything
 *             uncommitted, staged or not, which is what a step in flight is.
 *   gate      "check" (default: pnpm check, cached fast loop) | "full"
 *             (lint + check-types + test, needs Postgres) | "none".
 *   security  true | false | undefined. Undefined lets the scout decide from
 *             the touched paths (core, auth, middleware, config, admin
 *             endpoints, session code — ADR-0018/0019/0020 territory).
 *
 * Agent budget: 1 scout + 1 gate + up to 2 reviewers + one refuter per
 * finding (two for BLOCKER/MAJOR), capped at 12 verifications — under the
 * repo's 15-agent guideline for a typical step, and logged when the cap bites.
 */
export const meta = {
  name: "review-step",
  description:
    "Close-out review of a plan step: adr-reviewer + security-reviewer + gate in parallel, each finding adversarially verified, one ranked report",
  whenToUse:
    "At /plan-step step 5, or before a commit that touches apps/api/src/core, auth, shared packages or shared/ machinery in apps/admin",
  phases: [
    { title: "Scout", detail: "touched files, security relevance" },
    { title: "Review", detail: "adr-reviewer, security-reviewer, gate — concurrently" },
    { title: "Verify", detail: "one refuter per finding, two for BLOCKER/MAJOR" },
    { title: "Report", detail: "ranked findings + gate verdict" },
  ],
};

const range = (args && args.range) || "HEAD";
const gateMode = (args && args.gate) || "check";
const securityArg = args ? args.security : undefined;

const SCOUT_SCHEMA = {
  type: "object",
  required: ["files", "securityRelevant", "reason"],
  properties: {
    files: { type: "array", items: { type: "string" } },
    securityRelevant: { type: "boolean" },
    reason: { type: "string" },
  },
};

const FINDINGS_SCHEMA = {
  type: "object",
  required: ["findings", "verdict"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "adr", "file", "line", "problem", "fix"],
        properties: {
          severity: { type: "string", enum: ["BLOCKER", "MAJOR", "MINOR"] },
          adr: { type: "string", description: "e.g. ADR-0009, or 'none' for a security finding with no ADR" },
          file: { type: "string" },
          line: { type: "integer" },
          problem: { type: "string", description: "what is wrong, quoting the offending line" },
          fix: { type: "string", description: "the smallest fix" },
        },
      },
    },
    verdict: { type: "string", description: "one paragraph: conforms / conforms with minor fixes / does not conform" },
  },
};

const GATE_SCHEMA = {
  type: "object",
  required: ["result", "command", "summary", "failures"],
  properties: {
    result: { type: "string", enum: ["PASS", "FAIL", "BLOCKED"] },
    command: { type: "string" },
    summary: { type: "string" },
    failures: { type: "string", description: "the FAILURES block verbatim; empty on PASS" },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["refuted", "reason"],
  properties: {
    refuted: { type: "boolean" },
    reason: { type: "string", description: "one or two sentences citing the line or ADR text that decides it" },
  },
};

// ---------------------------------------------------------------- Scout

phase("Scout");

const scout = await agent(
  `Run \`git diff --name-only ${range}\` and \`git status --short\` in the repo root. Return every touched file path (modified, staged, or untracked under apps/, packages/, docs/).

Decide whether this change is security-relevant per the repo's rule (CLAUDE.md §Subagents, ADR-0018/0019/0020): true if any touched path is under apps/api/src/core/, touches auth/session/CSRF/middleware/config code, adds or changes an admin-segment endpoint (apps/api/src/routes/admin.router.ts or a module's *.routes.ts mounted there), or touches apps/admin/src/shared/api (the browser session machinery, ADR-0033). Otherwise false. Give the one-line reason.`,
  { label: "scout", phase: "Scout", schema: SCOUT_SCHEMA, effort: "low" },
);

const files = scout ? scout.files : [];
const securityRelevant = securityArg === undefined ? Boolean(scout && scout.securityRelevant) : Boolean(securityArg);
log(`${files.length} touched files; security review ${securityRelevant ? "ON" : "off"} (${scout ? scout.reason : "scout unavailable"})`);

// --------------------------------------------------------------- Review

const reviewers = [
  () =>
    agent(
      `Review the diff \`git diff ${range}\` (plus any untracked files under apps/ and packages/ that \`git status --short\` lists — read those in full) against the ADRs, following your procedure. Report every violation as a structured finding with the ADR number, file, line, the offending line quoted in \`problem\`, and the smallest fix. Severity: BLOCKER = violates a non-negotiable in CLAUDE.md or a frozen ADR with no superseding ADR; MAJOR = violates an ADR rule in a way that will be built on; MINOR = style or a missing test the step should add. If the code is right and an ADR is wrong or silent, say so in the verdict and recommend /new-adr rather than listing it as a finding.`,
      { label: "adr-reviewer", phase: "Review", schema: FINDINGS_SCHEMA, agentType: "adr-reviewer" },
    ),
];

if (securityRelevant) {
  reviewers.push(() =>
    agent(
      `Security-review the diff \`git diff ${range}\` (plus untracked files under apps/ and packages/ listed by \`git status --short\`, read in full) per ADR-0018 (auth), 0019 (guards), 0020 (baseline), 0013 (error leakage), 0004/0005 (secrets, redaction), 0033 (browser session). Report each finding structured: severity (BLOCKER = exploitable or credential/secret exposure; MAJOR = weakens a guarantee an ADR makes; MINOR = hardening), the governing ADR or 'none', file, line, the problem with the line quoted, and the fix.`,
      { label: "security-reviewer", phase: "Review", schema: FINDINGS_SCHEMA, agentType: "security-reviewer" },
    ),
  );
}

if (gateMode !== "none") {
  reviewers.push(() =>
    agent(
      gateMode === "full"
        ? "Run the full gate: `pnpm lint && pnpm check-types && pnpm test`. Check `docker ps` for Postgres first; BLOCKED if it is down."
        : "Run `pnpm check`.",
      { label: `gate:${gateMode}`, phase: "Review", schema: GATE_SCHEMA, agentType: "gate-runner" },
    ),
  );
}

const reviewResults = await parallel(reviewers);
const adrReview = reviewResults[0];
const secReview = securityRelevant ? reviewResults[1] : null;
const gate = gateMode !== "none" ? reviewResults[reviewResults.length - 1] : null;

const tagged = []
  .concat(adrReview ? adrReview.findings.map((f) => ({ ...f, source: "adr" })) : [])
  .concat(secReview ? secReview.findings.map((f) => ({ ...f, source: "security" })) : []);

// Dedup across the two reviewers — plain code, no agent: same file+line+adr is one finding.
const seen = new Set();
const unique = tagged.filter((f) => {
  const key = `${f.file}:${f.line}:${f.adr}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

log(`${tagged.length} findings raw, ${unique.length} after dedup; gate: ${gate ? gate.result : "skipped"}`);

// --------------------------------------------------------------- Verify

const VERIFY_CAP = 12;
const rank = { BLOCKER: 0, MAJOR: 1, MINOR: 2 };
const ordered = unique.slice().sort((a, b) => rank[a.severity] - rank[b.severity]);
const toVerify = ordered.slice(0, VERIFY_CAP);
const unverified = ordered.slice(VERIFY_CAP);
if (unverified.length) {
  log(`verification cap: ${unverified.length} MINOR finding(s) reported unverified`);
}

phase("Verify");

const refute = (f, lens) =>
  agent(
    `A reviewer claims this finding against the diff \`git diff ${range}\`:

  [${f.severity}] ${f.adr} — ${f.file}:${f.line}
  problem: ${f.problem}
  proposed fix: ${f.fix}

Your job is to REFUTE it. Read the file at that line and the ADR it cites (docs/adr/). Lens: ${lens}. It is refuted if: the quoted code is not actually in the diff or not at that location; the ADR text does not say what the finding assumes (quote the ADR); the ADR is superseded and its successor allows it; an ADR-sanctioned exception applies (check the ADR's own amendments and CLAUDE.md); or the "fix" would itself violate another ADR. It stands only if you can point at the line and the ADR sentence that together make it true. Default to refuted=true when you cannot confirm both.`,
    {
      label: `verify:${f.file.split("/").pop()}:${f.line}`,
      phase: "Verify",
      schema: VERDICT_SCHEMA,
      agentType: f.source === "security" ? "security-reviewer" : "adr-reviewer",
    },
  );

const verified = await pipeline(toVerify, async (f) => {
  const lenses = f.severity === "MINOR" ? ["does the ADR really say this"] : ["does the ADR really say this", "is the quoted code really what the diff does"];
  const votes = (await parallel(lenses.map((lens) => () => refute(f, lens)))).filter(Boolean);
  const upheld = votes.filter((v) => !v.refuted);
  // A single lens decides a MINOR; a BLOCKER/MAJOR stands if either lens upholds it —
  // a real blocker dropped by one skeptic is worse than a false one surfacing for a human.
  const stands = votes.length > 0 && upheld.length >= 1;
  return { ...f, stands, verdicts: votes.map((v) => v.reason) };
});

// --------------------------------------------------------------- Report

phase("Report");

const confirmed = verified.filter(Boolean).filter((f) => f.stands);
const refuted = verified.filter(Boolean).filter((f) => !f.stands);

log(`${confirmed.length} confirmed, ${refuted.length} refuted, ${unverified.length} unverified`);

return {
  range,
  files,
  securityReviewed: securityRelevant,
  gate,
  confirmed: confirmed.map(({ verdicts, stands, ...f }) => ({ ...f, upheldBecause: verdicts })),
  refuted: refuted.map(({ verdicts, stands, ...f }) => ({ ...f, refutedBecause: verdicts })),
  unverified,
  reviewerVerdicts: {
    adr: adrReview ? adrReview.verdict : "adr-reviewer unavailable",
    security: secReview ? secReview.verdict : securityRelevant ? "security-reviewer unavailable" : "not in scope",
  },
};
