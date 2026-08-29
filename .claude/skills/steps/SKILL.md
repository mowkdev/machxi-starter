---
name: steps
description: Run /step repeatedly, unattended, until every step of the in-progress deliverable is ticked — never advances to /ship and never touches another deliverable. Each step runs in its own subagent so the loop's own context stays flat regardless of how many steps run. Use as "/steps" to grind through the remaining build order in one session.
---

# Run the remaining steps of the in-progress deliverable

A thin repeat of `/step` — nothing more. It adds no verification of its own: `/step` already gates (`pnpm check`, then the full gate) and reviews itself, so this skill's only job is to run it again, read what came back, and decide whether to continue.

State lives in the plan file's checkboxes and in git, not in this conversation — so if this session ends for any reason (closed, interrupted, out of usage), re-running `/steps` later picks up at the next unchecked step exactly as if nothing had happened. There is nothing to resume "in memory".

**Each step is delegated to a fresh subagent, never run inline.** A single step can touch contracts, the API, multiple packages and a full gate run — doing that directly in this conversation would accumulate file reads, diffs and command output across every step in one context, which is exactly what a session ending on "out of usage" mid-deliverable would leave half-summarized. Delegating keeps this loop's own context to one short report per step, no matter how many steps it runs, and gives every step a full, fresh context budget of its own.

## Loop

1. **Confirm scope**: read `docs/plan/README.md` for the one `in progress` deliverable. If none is `in progress`, stop and say so — this skill does not open one. Read that deliverable's plan file once to see which steps are already checked.
2. **Delegate one step** to a subagent (the `Agent` tool, `general-purpose`, run in the foreground — the next action depends on its result). Give it a self-contained prompt along these lines, naming the actual deliverable and repo path:

   > Build the next unchecked step of deliverable `<Dn>` in `<repo path>` by invoking the `step` skill with no argument (`Skill({skill: "step"})`) and following its instructions exactly — orient, implement, gate, one bounded review, commit. Do not pass a specific step id. When done, report concisely: which step you built, the gate's result verbatim (pass/fail, not full logs), review findings and their fates, and anything left pending operator acceptance. If you cannot proceed — a blocker only the operator can resolve, a done-when that cannot be satisfied as written, two failures of the same kind — stop and say exactly why rather than guessing or routing around it.

   Never run more than one step per subagent, and never fold this dispatch into a background batch — the loop needs this step's outcome before deciding on the next one.
3. **Read the subagent's report** and decide:
   - **No unchecked step remains** → stop. Say the deliverable is ready for `/ship`; do not run `/ship` yourself — closing it is the operator's call.
   - **The step closed cleanly** (ticked, committed, gate reported green) → go back to step 2 for the next one.
   - **Anything else** → apply the reasoning below before dispatching another subagent.

## Reasoning on an unexpected outcome

One pass, no re-litigating, no second-guessing a call the subagent already made:

- **Transient or environmental** — Docker not up, a dependency install hiccup, a flaky integration test, a one-off timeout, a `pnpm docker:up` you can just run. Fix the one-line prerequisite if that's all it is, then dispatch **one** retry of the same step. A second failure of the same shape is no longer transient.
- **A genuine blocker** — a decision the plan or an ADR left to the operator, a done-when that cannot be satisfied as written, a step whose own review surfaced something that needs a product answer, or a second failure of the same kind. Stop immediately. Do not guess at the decision and do not quietly reinterpret the plan or an ADR to route around it — that is exactly the kind of call the subagent itself would refuse to make alone.
- **Ambiguous** — stop rather than guess, and say precisely what is unclear.

## Stopping

Report, every time: which step is next (or that none remain), what happened on the last attempt, and — for a blocker — the exact question the operator needs to answer. Leave the tree clean and the gate at whatever state the step left it in; never patch around a red gate from outside the subagent that owns it.

Never: run `pnpm check`, `pnpm test`, or any other verification yourself in this session — the delegated step owns its own gate; run a step inline instead of through a subagent; batch fixes into a commit outside the step that needed them; run `/ship`; advance to a different deliverable; retry one failure more than once.
