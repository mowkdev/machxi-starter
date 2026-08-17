# Documentation

| Path | Contents |
|---|---|
| [`adr/`](adr/README.md) | Architecture Decision Records — the *why* behind the repo structure. Start with the index. |
| [`implementation-plan.md`](implementation-plan.md) | Build order, endpoint scope and readiness assessment for the first deliverable. |
| [`../.claude/`](../.claude/README.md) | Claude Code project setup: `CLAUDE.md` summary, subagents (`agents/`), slash-command skills (`skills/`), shared permissions. |
| [`postman/`](postman/README.md) | Postman collection + environment for manual/smoke testing of the API (produced during implementation). |

Conventions: ADRs are the source of truth for decisions; this plan and the Postman collection are derived from them. When code and an ADR disagree after the first deliverable, write a superseding ADR rather than silently diverging.
