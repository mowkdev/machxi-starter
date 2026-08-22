---
name: run-deliverable
description: Launch the unattended build of the in-progress deliverable in its own worktree — every pending step built, reviewed and committed, the deliverable closed, the branch pushed and a PR opened, and (chain mode) the next deliverable opened only when its plan is decided. Use as "/run-deliverable", "/run-deliverable chain 2", or "/run-deliverable ship --merge main".
---

# Run the deliverable unattended — `$ARGUMENTS`

Arguments: a mode (`ship` default, `open-next`, `chain`), an optional chain cap (a number), and optional `--merge pr|main` (default `pr`). The work happens in the `deliverable-build` workflow (`.claude/workflows/deliverable-build.mjs`); this skill puts the session where the robot may write and launches it.

1. **Check the desk is clean and pushed.** `git status --short` must be empty and `git log origin/main..HEAD` must be empty; if not, stop and say what is unpushed — a worktree branches from `origin/main`, so anything unpushed would be missing from the run.
2. **Confirm the deliverable is decided.** Read `docs/plan/README.md`: exactly one row `in progress`, and its plan has a build order with pending steps. For `chain`, also check the _next_ planned row has its ADR(s) written ahead (the index lists them) — if not, say so and offer `/plan-deliverable` first; the run would stop at that boundary anyway.
3. **Enter a worktree.** Call `EnterWorktree` with name `d<n>` for the in-progress deliverable (branch `worktree-d<n>` from `origin/main`; `.worktreeinclude` carries `.env` files). Note the worktree path it reports — that is `root`. Do not run `pnpm i` yourself; preflight does it if needed.
4. **Launch.** `Workflow({ scriptPath: "<root>/.claude/workflows/deliverable-build.mjs", args: { root: "<root>", mode, maxDeliverables, merge } })`. Tell the operator the branch name, that `/workflows` shows progress, and that the session must stay open.
5. **When it returns**, report in this order: what shipped (steps and commits), the PR URL or the fast-forward result, items recorded as pending operator acceptance (these are the operator's to-do list at the desk), the run metrics (gate tier, fix rounds and review precision per step), and — if it stopped — where, why, and the exact questions if it stopped at a deliverable boundary. Then `ExitWorktree`, keeping the branch.

Permissions the run needs in `.claude/settings.local.json` (personal, git-ignored; say so rather than editing them): `Bash(git push -u origin worktree-*)` and `Bash(gh pr create *)` for `--merge pr`, or `Bash(git push origin HEAD:main)` for `--merge main`. A denied push is recorded as `DENIED` and the run ends cleanly — nothing is lost, the commits are on the branch.

What this skill never does: run on `main`, commit with `git add -A`, force-push, accept an ADR, or claim a browser walk.
