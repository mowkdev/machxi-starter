---
name: steps
description: Run /step repeatedly, unattended, until every step of one in-progress deliverable is ticked — each step one commit pushed to the lane's pull request, never waiting on CI, never advancing to /ship and never touching another deliverable. Each step runs in its own subagent so the loop's own context stays flat regardless of how many steps run; where a builder has no reviewer, this loop runs the one review. Use as "/steps" when one deliverable is in progress, or "/steps D<n>" to name the lane when more than one is.
---

# Run the remaining steps of an in-progress deliverable $ARGUMENTS

A thin repeat of `/step` — nothing more. It adds no verification of its own: `/step` reads the last push's run, ends on the step check and pushes one commit to the lane branch ([ADR-0082](../../../docs/adr/0082-lanes-on-one-machine-and-one-main.md) §1, lanes on one machine and one `main`), so this skill's job is to run it again, see that each step gets its one review, read what came back, and decide whether to continue.

State lives in the plan file's checkboxes, in git and on the lane's pull request, not in this conversation — so if this session ends for any reason (closed, interrupted, out of usage), re-running `/steps` later picks up at the next unchecked step exactly as if nothing had happened. There is nothing to resume "in memory". The one limit is the branch: **a lane on a cloud session's branch continues only from a session given that branch, or from a local clone** — a new cloud session is given a new branch it alone may write, so its first `/step` stops on the branch check, and this loop stops with it and says so.

**Each step is delegated to a fresh subagent, never run inline.** A single step can touch contracts, the API, multiple packages and a step check — doing that directly in this conversation would accumulate file reads, diffs and command output across every step in one context, which is exactly what a session ending on "out of usage" mid-deliverable would leave half-summarized. Delegating keeps this loop's own context to one short report per step, no matter how many steps it runs, and gives every step a full, fresh context budget of its own.

**The loop never waits on CI.** Each step's subagent begins by reading the last push's `gate.yml` run and fixes forward when it is red, so a run still going when a step is pushed is read by the next step, and the last one by `/ship`. Nothing here polls a run.

## Loop

1. **Confirm scope — the lane**: read `docs/plan/README.md` for the `in progress` deliverables; more than one may be, each a lane with disjoint records ([ADR-0079](../../../docs/adr/0079-parallel-lanes.md), parallel lanes; the open lanes are in [the ledger's window section](../../../docs/plan/README.md#the-window)). With an argument `D<n>`, that is the lane, and it must be one the window section lists. Without one, the lane is the one `in progress` row; **when more than one row is `in progress`, refuse the bare call** and ask which lane. If none is `in progress`, stop and say so — this skill does not open one. Read the lane's plan file once to see which steps are already checked, and its lane file for the branch. The loop stays in its lane from here to the end.
2. **Delegate one step** to a subagent (the `Agent` tool, `general-purpose`, run in the foreground — the next action depends on its result). Give it a self-contained prompt along these lines, naming the actual deliverable, repo path and lane branch:

   > Build the next unchecked step of deliverable `<Dn>` in `<repo path>`, on the lane branch `<branch>`, by invoking the `step` skill with the lane as its argument (`Skill({skill: "step", args: "<Dn>"})`) and following its instructions exactly — read the last push's `gate.yml` run and fix forward if it is red, orient, implement, `pnpm step:check` green, commit and push to the lane branch. Do not pass a specific step id. Never merge to or push to `main`, never pass `--force`, and do not wait for CI. If you have no Agent tool, do not review your own diff: say in the note and the commit body that the review is owed. When done, report concisely: which step you built, the commit hash pushed, the step check's output lines, the run you read first and its conclusion, whether the review ran or is owed, and anything left pending operator acceptance. If you cannot proceed — a blocker only the operator can resolve, a done-when that cannot be satisfied as written, two failures of the same kind — stop and say exactly why rather than guessing or routing around it.

   Never run more than one step per subagent, and never fold this dispatch into a background batch — the loop needs this step's outcome before deciding on the next one.

3. **The one review, when the builder could not run it.** A builder without an Agent tool pushes with its review owed; this session then runs it — **the orchestrator runs the review**, one pass, in a fresh context: one reviewer subagent (`adr-reviewer` for a record-heavy step, `security-reviewer` for auth, session, config or deployment surfaces, otherwise `code-reviewer`) over the pushed commit's diff (`git show <hash>`). Confirmed findings go to one more subagent with the findings in its prompt: it fixes them, re-runs `pnpm step:check`, appends the findings and their fates to the notes, and pushes a follow-up commit, `fix(<scope>): D<n>.<step> follow-up — the review's findings`. That pass is the step's one review; the builder's own reading never counts as a second, and there is no re-review round.
4. **Read the reports** and decide:
   - **No unchecked step remains** → stop. Say the deliverable is ready for `/ship`; do not run `/ship` yourself — closing it is the operator's call.
   - **The step closed cleanly** (ticked, committed, pushed, the step check reported green, its review done) → go back to 2 for the next one.
   - **Anything else** → apply the reasoning below before dispatching another subagent.

## Reasoning on an unexpected outcome

One pass, no re-litigating, no second-guessing a call the subagent already made:

- **Transient or environmental** — Postgres not up, a dependency install hiccup, a flaky integration test, a one-off timeout, a push the network dropped. Fix the one-line prerequisite if that's all it is, then dispatch **one** retry of the same step. A second failure of the same shape is no longer transient.
- **A genuine blocker** — a decision the plan or an ADR left to the operator, a done-when that cannot be satisfied as written, a step whose own review surfaced something that needs a product answer, a red run the fix-forward could not turn green, or a second failure of the same kind. Stop immediately. Do not guess at the decision and do not quietly reinterpret the plan or an ADR to route around it — that is exactly the kind of call the subagent itself would refuse to make alone.
- **Ambiguous** — stop rather than guess, and say precisely what is unclear.

## Stopping

Report, every time: which step is next (or that none remain), the commits pushed, what happened on the last attempt, each review's findings and fates, and — for a blocker — the exact question the operator needs to answer. Leave the tree clean and the branch pushed; never patch around a red step check from outside the subagent that owns it.

Never: run `pnpm check`, `pnpm step:check`, the gate, or any other verification yourself in this session — the delegated step owns its own check; run a step inline instead of through a subagent; review a step twice; batch fixes into a commit outside the step or follow-up that needed them; merge to or push to `main`; wait on a CI run; run `/ship`; advance to a different deliverable; retry one failure more than once.
