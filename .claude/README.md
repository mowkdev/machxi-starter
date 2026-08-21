# .claude — project configuration for Claude Code

- `settings.json` — shared permission defaults (safe pnpm/docker/git commands allowed; destructive DB/git ops ask; `.env` files never read). Personal overrides go in `settings.local.json` (git-ignored).
  - Recursive shell search (`grep -r`, `grep -R`, `find`, `rg`) is denied. Those commands ignore `.gitignore` and walk `node_modules` and `.turbo`, which is slow and floods the context. Use Claude's Grep/Glob tools instead — they are ripgrep-backed and skip anything `.gitignore`d.
- `agents/` — subagents: `adr-reviewer`, `module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `security-reviewer`, `adr-author`, and `gate-runner` (haiku, low effort, Bash-only: runs `pnpm check` or the full gate and returns a structured pass/fail — the cheap last stage of any workflow). The reviewers stay on the strongest model; the mechanical agents are the ones to tier down.
- `workflows/` — named multi-agent scripts for the Workflow tool (opt-in; a user asks for one by name or says "use a workflow"). `review-step` runs `adr-reviewer`, `security-reviewer` (when the scout finds the diff security-relevant) and `gate-runner` concurrently, then hands every finding to an independent refuter before reporting one ranked list — the orchestrated form of `/plan-step` step 5. Args: `range` (git diff range, default `HEAD`), `gate` (`check` | `full` | `none`), `security` (force on/off).
- `skills/` — slash-command workflows, split by where the code lives:
  - API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`.
  - Admin app and design system (D3.10): `/frontend-conventions`, `/new-resource-ui`, `/ui-component`.
  - Everything else: `/new-adr`, `/local-dev`, `/plan-step`.

Root `CLAUDE.md` is the always-loaded summary; the ADRs in `docs/adr/` are the source of truth.
