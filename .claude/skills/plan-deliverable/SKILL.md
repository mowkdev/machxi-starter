---
name: plan-deliverable
description: Plan a deliverable ahead of opening it — analyse its scope document and the code into the operator's questions, ask them, then draft its ADR(s) and build order (refuted before landing) so an unattended build can open and run it. Use as "/plan-deliverable D8"; a bare call means the first `planned` row in the ledger.
---

# Plan deliverable `$ARGUMENTS` ahead of opening

An assistant for stage 1 of the three-stage loop — **decide (by hand, here) → `/verify-deliverable` → `/run-deliverable`**. The ADRs are the operator's to write; this skill opens that conversation with the questions and the code facts, and can draft on request. Nothing downstream depends on it: `deliverable-build` runs on the verify stamp, never on a draft. The work happens in the `deliverable-plan` workflow (`.claude/workflows/deliverable-plan.mjs`, invoked by `scriptPath`); this skill is the conversation around it. Invoking it from here is the operator's opt-in.

1. **Analyse.** `Workflow({ scriptPath: "<repo>/.claude/workflows/deliverable-plan.mjs", args: { mode: "analyze", root: "<repo>", deliverable: "$ARGUMENTS" } })` (omit `deliverable` for a bare call). It returns `questions` (2–4 options each, the recommended one first), `adrsNeeded`, `findings` and `ready`. Keep the whole object for step 3.
2. **Ask — and keep asking.** `AskUserQuestion`, at most four per call, the recommended option first and labelled `(Recommended)`, the `why` folded into the question. Relay the code findings behind a question in one line each — they are the analysis the operator is paying for. An answer often opens a new question: ask it, and add the exchange to `answers` under a new id. Ask until nothing is open; a declined decision is recorded as "deferred — decide at D<n>.1".
3. **Draft.** `Workflow({ scriptPath: "…", args: { mode: "draft", root, analysis: <the analyze result>, answers: { <q.id>: "<label or the operator's words>" } } })`. Each needed ADR is written `proposed` by `adr-author`, refuted by `adr-reviewer` against the answers and the frozen ADRs (one fix round), the build order is written with the plan left `planned`, a consistency check runs, and the touched files are committed by path.
4. **Report**: the ADR(s) (file, summary, refuter issues and whether fixed), the build order, consistency issues, the commit. Then ask whether to **open** now — only if the previous deliverable has shipped (ADR-0025 rule 5): `Workflow({ scriptPath: "…", args: { mode: "open", root, deliverable: "D<n>" } })`. Opening never accepts an ADR; the first step's builder does, at its head.

Never: build, accept an ADR, flip the ledger unasked, or `git add -A`.
