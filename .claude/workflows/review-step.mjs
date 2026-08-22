/**
 * review-step — the close-out review of one plan step, as a workflow.
 *
 * What /plan-step step 5 does by hand, orchestrated: the architecture and
 * security reviewers run **concurrently** with the gate, every finding is
 * then handed to an independent refuter before it reaches the report, and
 * what comes back is one ranked list plus the gate's verdict — not three
 * transcripts to reconcile.
 *
 * Invoke (opt-in, like every workflow; by scriptPath — the name registry has
 * been seen stale for repo-authored scripts):
 *   Workflow({ scriptPath: ".claude/workflows/review-step.mjs" })
 *   Workflow({ scriptPath: "…", args: { range: "main...HEAD" } })
 *   Workflow({ scriptPath: "…", args: { range: "HEAD", gate: "full", security: true } })
 *
 * args (all optional):
 *   range     git diff range the reviewers read. Default "HEAD" — everything
 *             uncommitted, staged or not, which is what a step in flight is.
 *   gate      "auto" (default) — the scout picks the ADR-0026 tier: "full"
 *             (lint + check-types + test, needs Postgres) when apps/api,
 *             packages/db, packages/contracts, turbo.json or a lockfile is
 *             touched, else "check" (the cached fast loop). Or force
 *             "full" | "check" | "none".
 *   security  true | false | undefined. Undefined lets the scout decide from
 *             the touched paths (core, auth, middleware, config, admin
 *             endpoints, session code — ADR-0018/0019/0020 territory).
 *   depth     "auto" (default) — a small, non-API, non-security diff gets one
 *             refuter lens per finding; anything else gets two lenses on
 *             BLOCKER/MAJOR. Or force "light" | "full".
 *
 * Returns { range, files, securityReviewed, gate, gateTier, small, confirmed,
 * refuted, unverified, reviewerVerdicts } — fields are only ever added, so a
 * caller written against an older shape keeps working.
 *
 * Agent budget: 1 scout (low) + 1 gate (haiku) + 1–2 reviewers + one refuter
 * per finding (two for BLOCKER/MAJOR at full depth), capped at 12
 * verifications and logged when the cap bites.
 */
export const meta = {
  name: "review-step",
  description:
    "Close-out review of a plan step: adr-reviewer + security-reviewer + gate in parallel, each finding adversarially verified, one ranked report",
  whenToUse:
    "At /plan-step step 5, or before a commit that touches apps/api/src/core, auth, shared packages or shared/ machinery in apps/admin",
  phases: [
    {
      title: "Scout",
      detail: "touched files, size, gate tier, security relevance",
    },
    {
      title: "Review",
      detail: "adr-reviewer, security-reviewer, gate — concurrently",
    },
    {
      title: "Verify",
      detail: "one refuter per finding, two for BLOCKER/MAJOR at full depth",
    },
    { title: "Report", detail: "ranked findings + gate verdict" },
  ],
};

const range = (args && args.range) || "HEAD";
const gateArg = (args && args.gate) || "auto";
const securityArg = args ? args.security : undefined;
const depthArg = (args && args.depth) || "auto";

const SCOUT_SCHEMA = {
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
    linesChanged: {
      type: "integer",
      description:
        "insertions + deletions from `git diff --stat`, plus the line counts of untracked files",
    },
    touchesApi: {
      type: "boolean",
      description:
        "true if any touched path is under apps/api/, packages/db/, packages/contracts/, or is turbo.json / pnpm-lock.yaml / a package.json",
    },
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
          adr: {
            type: "string",
            description:
              "e.g. ADR-0009, or 'none' for a security finding with no ADR",
          },
          file: { type: "string" },
          line: { type: "integer" },
          problem: {
            type: "string",
            description: "what is wrong, quoting the offending line",
          },
          fix: { type: "string", description: "the smallest fix" },
        },
      },
    },
    verdict: {
      type: "string",
      description:
        "one paragraph: conforms / conforms with minor fixes / does not conform",
    },
  },
};

const GATE_SCHEMA = {
  type: "object",
  required: ["result", "command", "summary", "failures"],
  properties: {
    result: { type: "string", enum: ["PASS", "FAIL", "BLOCKED"] },
    command: { type: "string" },
    summary: { type: "string" },
    failures: {
      type: "string",
      description: "the FAILURES block verbatim; empty on PASS",
    },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["refuted", "reason"],
  properties: {
    refuted: { type: "boolean" },
    reason: {
      type: "string",
      description:
        "one or two sentences citing the line or ADR text that decides it",
    },
  },
};

// ---------------------------------------------------------------- Scout

phase("Scout");

const scout = await agent(
  `Run \`git diff --stat ${range}\`, \`git diff --name-only ${range}\` and \`git status --short\` in the repo root. Return every touched file path (modified, staged, or untracked under apps/, packages/, docs/, .claude/, and root config files), the total lines changed, and two booleans:

- touchesApi: any touched path under apps/api/, packages/db/, packages/contracts/, or turbo.json, pnpm-lock.yaml, any package.json — the paths whose change can break the integration tier or the build graph (ADR-0026).
- securityRelevant, per the repo's rule (CLAUDE.md §Subagents, ADR-0018/0019/0020): any touched path under apps/api/src/core/, auth/session/CSRF/middleware/config code, an admin-segment endpoint (apps/api/src/routes/admin.router.ts or a module's *.routes.ts mounted there), or apps/admin/src/shared/api (the browser session machinery, ADR-0033).

One-line reason.`,
  {
    label: "scout",
    phase: "Scout",
    schema: SCOUT_SCHEMA,
    effort: "low",
    model: "haiku",
  },
);

const files = scout ? scout.files : [];
const securityRelevant =
  securityArg === undefined
    ? Boolean(scout && scout.securityRelevant)
    : Boolean(securityArg);
const touchesApi = scout ? scout.touchesApi : true;
const gateTier = gateArg === "auto" ? (touchesApi ? "full" : "check") : gateArg;
const small =
  Boolean(scout) &&
  !touchesApi &&
  !securityRelevant &&
  files.length <= 4 &&
  scout.linesChanged <= 200;
const depth = depthArg === "auto" ? (small ? "light" : "full") : depthArg;
log(
  `${files.length} file(s), ${scout ? scout.linesChanged : "?"} lines; gate=${gateTier}; security ${securityRelevant ? "ON" : "off"}; depth=${depth} (${scout ? scout.reason : "scout unavailable — assuming the expensive tier"})`,
);

// --------------------------------------------------------------- Review

const untracked =
  "plus any untracked files under apps/ and packages/ that `git status --short` lists — read those in full";

const reviewers = [
  () =>
    agent(
      `Review the diff \`git diff ${range}\` (${untracked}) against the ADRs, following your procedure. Report every violation as a structured finding with the ADR number, file, line, the offending line quoted in \`problem\`, and the smallest fix. Severity: BLOCKER = violates a non-negotiable in CLAUDE.md or a frozen ADR with no superseding ADR; MAJOR = violates an ADR rule in a way that will be built on; MINOR = style or a missing test the step should add. If the code is right and an ADR is wrong or silent, say so in the verdict and recommend /new-adr rather than listing it as a finding.

Precision over recall: every finding you list is handed to an independent refuter, and on the last run 26 of 27 were refuted — the cost of a false finding is a full fix round. So before listing one, you must have (1) quoted the exact ADR sentence it violates, after checking that ADR's own amendments and, if it is superseded, its successor, and (2) confirmed the quoted code is in THIS diff at that line. A suspicion that fails either check goes into the verdict paragraph as a note, not into findings.`,
      {
        label: "adr-reviewer",
        phase: "Review",
        schema: FINDINGS_SCHEMA,
        agentType: "adr-reviewer",
      },
    ),
];

if (securityRelevant) {
  reviewers.push(() =>
    agent(
      `Security-review the diff \`git diff ${range}\` (${untracked}) per ADR-0018 (auth), 0019 (guards), 0020 (baseline), 0013 (error leakage), 0004/0005 (secrets, redaction), 0033 (browser session). Report each finding structured: severity (BLOCKER = exploitable or credential/secret exposure; MAJOR = weakens a guarantee an ADR makes; MINOR = hardening), the governing ADR or 'none', file, line, the problem with the line quoted, and the fix.`,
      {
        label: "security-reviewer",
        phase: "Review",
        schema: FINDINGS_SCHEMA,
        agentType: "security-reviewer",
      },
    ),
  );
}

if (gateTier !== "none") {
  reviewers.push(() =>
    agent(
      gateTier === "full"
        ? "Run the full gate: `pnpm lint && pnpm check-types && pnpm test`. Check `docker ps` for Postgres first; BLOCKED if it is down."
        : "Run `pnpm check`.",
      {
        label: `gate:${gateTier}`,
        phase: "Review",
        schema: GATE_SCHEMA,
        agentType: "gate-runner",
      },
    ),
  );
}

const reviewResults = await parallel(reviewers);
const adrReview = reviewResults[0];
const secReview = securityRelevant ? reviewResults[1] : null;
const gate =
  gateTier !== "none" ? reviewResults[reviewResults.length - 1] : null;

const tagged = []
  .concat(
    adrReview ? adrReview.findings.map((f) => ({ ...f, source: "adr" })) : [],
  )
  .concat(
    secReview
      ? secReview.findings.map((f) => ({ ...f, source: "security" }))
      : [],
  );

// Dedup across the two reviewers — plain code, no agent: same file+line+adr is one finding.
const seen = new Set();
const unique = tagged.filter((f) => {
  const key = `${f.file}:${f.line}:${f.adr}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

log(
  `${tagged.length} findings raw, ${unique.length} after dedup; gate: ${gate ? gate.result : "skipped"}`,
);

// --------------------------------------------------------------- Verify

const VERIFY_CAP = 12;
const rank = { BLOCKER: 0, MAJOR: 1, MINOR: 2 };
const ordered = unique
  .slice()
  .sort((a, b) => rank[a.severity] - rank[b.severity]);
// A MINOR never blocks, so at light depth it is reported as-is rather than
// paid for: on the measured D6→D7 run the refuters rejected 26 of 27 findings,
// and a refuter costs about what the reviewer did.
const candidates =
  depth === "light" ? ordered.filter((f) => f.severity !== "MINOR") : ordered;
const toVerify = candidates.slice(0, VERIFY_CAP);
const unverified = ordered.filter((f) => !toVerify.includes(f));
if (unverified.length)
  log(
    `${unverified.length} finding(s) reported unverified (${depth === "light" ? "MINOR at light depth" : "over the cap"})`,
  );

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
      // A MINOR finding's refutation is a lookup, not a judgement.
      ...(f.severity === "MINOR" ? { effort: "low" } : {}),
    },
  );

const verified = await pipeline(toVerify, async (f) => {
  const twoLenses = depth === "full" && f.severity !== "MINOR";
  const lenses = twoLenses
    ? [
        "does the ADR really say this",
        "is the quoted code really what the diff does",
      ]
    : [
        "does the ADR really say this, and is the quoted code really in the diff",
      ];
  const votes = (
    await parallel(lenses.map((lens) => () => refute(f, lens)))
  ).filter(Boolean);
  const upheld = votes.filter((v) => !v.refuted);
  // A BLOCKER/MAJOR stands if either lens upholds it — a real blocker dropped by
  // one skeptic is worse than a false one surfacing for a human.
  const stands = votes.length > 0 && upheld.length >= 1;
  return { ...f, stands, verdicts: votes.map((v) => v.reason) };
});

// --------------------------------------------------------------- Report

phase("Report");

const confirmed = verified.filter(Boolean).filter((f) => f.stands);
const refuted = verified.filter(Boolean).filter((f) => !f.stands);

log(
  `${confirmed.length} confirmed, ${refuted.length} refuted, ${unverified.length} unverified`,
);

return {
  range,
  files,
  securityReviewed: securityRelevant,
  gate,
  gateTier,
  small,
  depth,
  confirmed: confirmed.map(({ verdicts, stands, ...f }) => ({
    ...f,
    upheldBecause: verdicts,
  })),
  refuted: refuted.map(({ verdicts, stands, ...f }) => ({
    ...f,
    refutedBecause: verdicts,
  })),
  unverified,
  reviewerVerdicts: {
    adr: adrReview ? adrReview.verdict : "adr-reviewer unavailable",
    security: secReview
      ? secReview.verdict
      : securityRelevant
        ? "security-reviewer unavailable"
        : "not in scope",
  },
};
