---
name: plan-deliverable
description: Plan a deliverable ahead of opening it — analyse its scope document and the code into the operator's questions, ask them, then draft its ADR(s) and build order (adversarially verified) so run-deliverable can open and build it unattended. Use as "/plan-deliverable D8"; a bare call means the first `planned` row in the ledger.
---

# Plan deliverable `$ARGUMENTS` ahead of opening

The planning half of the unattended loop. `run-deliverable` builds; this decides — and it is the one place in the loop that is allowed to ask the operator, because it runs here in the session rather than in the background. The heavy lifting is the `plan-deliverable` **workflow** (`.claude/workflows/plan-deliverable.mjs`, invoked by `scriptPath`, never by name); this skill is the conversation around it.

Invoking the workflow from this skill is the user's opt-in — they asked for the plan.

1. **Analyse.** `Workflow({ scriptPath: "<repo>/.claude/workflows/plan-deliverable.mjs", args: { mode: "analyze", deliverable: "$ARGUMENTS" } })` (omit `deliverable` for a bare call). It reads the scope document, the ADR index and the code in parallel and returns `questions` (each with 2–4 options, the recommended one first), `adrsNeeded`, `findings` and `ready`. Keep the whole returned object — step 3 passes it back.
2. **Ask.** Put the questions to the operator with `AskUserQuestion`, at most four per call, the recommended option first and labelled `(Recommended)`, the `why` folded into the question text. Relay the code findings that drove a question in one line each — they are the analysis the operator is paying for. If the operator's answer opens a new question (it often does), ask it; a second `analyze` run is not needed for that — add the exchange to `answers` as free text under a new id and mention it in step 3's prompt context. Stop asking when every question has an answer; if the operator declines to decide something, record "deferred — decide at D<n>.1" as the answer and say so in the report.
3. **Draft.** `Workflow({ scriptPath: "…/plan-deliverable.mjs", args: { mode: "draft", analysis: <the analyze result>, answers: { <question.id>: "<chosen label or the operator's words>" } } })`. It writes each needed ADR `proposed` via `adr-author`, refutes each with `adr-reviewer` against the answers and the frozen ADRs (one fix round), writes the build order into the plan file with the status left `planned`, runs a consistency check, and commits only the files it touched.
4. **Report**, in this order: the ADR(s) written (file, one-paragraph summary, any issue the refuter raised and whether it was fixed), the build order (step ids and titles), the consistency issues if any, and the commit hash. Then ask whether to **open** it now — only if the previous deliverable has shipped (ADR-0025 rule 5) — and if yes: `Workflow({ scriptPath: "…", args: { mode: "open", deliverable: "D<n>" } })`. Opening never accepts an ADR; the first step's builder does that at its head (rule 3).

What this skill does **not** do: build anything, accept an ADR, flip the ledger without being asked, or `git add -A` (another session may be building in the same tree — the workflow commits by explicit path).

Re-running `analyze` on a deliverable whose ADRs already exist is the readiness check `run-deliverable` performs at a boundary: `ready: true` with no questions is what lets `chain` mode open it unattended.
