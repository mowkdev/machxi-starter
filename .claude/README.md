# .claude — project configuration for Claude Code

- `settings.json` — shared permission defaults (safe pnpm/docker/git commands allowed; destructive DB/git ops ask; `.env` files never read). Personal overrides go in `settings.local.json` (git-ignored).
  - Recursive shell search (`grep -r`, `grep -R`, `find`, `rg`) is denied. Those commands ignore `.gitignore` and walk `node_modules` and `.turbo`, which is slow and floods the context. Use Claude's Grep/Glob tools instead — they are ripgrep-backed and skip anything `.gitignore`d.
- `agents/` — subagents: `adr-reviewer`, `module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `security-reviewer`, `adr-author`, and `gate-runner` (haiku, low effort, Bash-only: runs `pnpm check` or the full gate and returns a structured pass/fail). The reviewers stay on the strongest model; the mechanical agents are the ones to tier down.
- `rules/` — path-scoped rules (`paths:` frontmatter): `api.md` loads with `apps/api` and the data packages, `frontend.md` with `apps/admin` and `packages/ui`. They carry the ADR non-negotiables that used to make `CLAUDE.md` 13 KB; `CLAUDE.md` keeps what always applies.
- `.worktreeinclude` (repo root) — the untracked files copied into a worktree Claude creates: `.env`, `apps/admin/.env`, `apps/customer/.env`. Each browser app reads its own (ADR-0033), so a worktree without the customer file starts an app that cannot reach the API.
- `skills/` — slash-command workflows, split by where the code lives:
  - API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`.
  - Admin app and design system: `/frontend-conventions`, `/new-resource-ui`, `/ui-component`.
  - Process ([ADR-0050](../docs/adr/0050-adr-lifecycle-and-verification.md)) — **scope → step → ship**: `/scope` (a deliverable into a one-page plan whose done-whens are commands and test names), `/step` (the next step: implement, gate green, one bounded diff review, commit), `/ship` (the close-out and the ledger row). Plus `/new-adr` and `/local-dev`.

**There are no orchestration workflows.** The previous generation — a three-stage decide → verify → build pipeline with multi-agent refutation gates (`deliverable-plan`, `deliverable-verify`, `deliverable-build`, `step-review`, and their v1 predecessors) — was removed 2026-08-26 after seventeen verification rounds against D8's records burned ~17M tokens converging on prose instead of building code. The post-mortem and the replacement rules are ADR-0050: **machines gate** (`pnpm lint && pnpm check-types && pnpm test && pnpm size && pnpm format:check` is the stamp — five links since `D13.1`, ADR-0057 §8), **review is one bounded pass on a diff**, and **uncertain mechanics get a timeboxed spike in a worktree, not a debate**. The retired scripts live in git history (`d32f382` and earlier) if a future measurement wants the baseline.

Root `CLAUDE.md` is the always-loaded summary; the ADRs in `docs/adr/` are the source of truth.
