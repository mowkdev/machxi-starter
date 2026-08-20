# .claude — project configuration for Claude Code

- `settings.json` — shared permission defaults (safe pnpm/docker/git commands allowed; destructive DB/git ops ask; `.env` files never read). Personal overrides go in `settings.local.json` (git-ignored).
  - Recursive shell search (`grep -r`, `grep -R`, `find`, `rg`) is denied. Those commands ignore `.gitignore` and walk `node_modules` and `.turbo`, which is slow and floods the context. Use Claude's Grep/Glob tools instead — they are ripgrep-backed and skip anything `.gitignore`d.
- `agents/` — subagents: `adr-reviewer`, `module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `security-reviewer`, `adr-author`.
- `skills/` — slash-command workflows, split by where the code lives:
  - API and data: `/api-conventions`, `/new-api-module`, `/add-endpoint`, `/db-schema-change`, `/postman-sync`.
  - Admin app and design system (D3.10): `/frontend-conventions`, `/new-resource-ui`, `/ui-component`.
  - Everything else: `/new-adr`, `/local-dev`, `/plan-step`.

Root `CLAUDE.md` is the always-loaded summary; the ADRs in `docs/adr/` are the source of truth.
