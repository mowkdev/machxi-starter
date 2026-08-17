---
name: postman-sync
description: Update docs/postman collection and environment when endpoints change — add requests, envelope/status tests, token handoff scripts — and verify with newman (ADR-0021). Use after adding or changing any endpoint.
---

# Postman sync — `$ARGUMENTS` (endpoints changed)

Files: `docs/postman/machxi-api.postman_collection.json`, `docs/postman/local.postman_environment.json` (no secrets committed; credential vars empty).

1. Folder structure mirrors segments: `Health`, `Admin Auth`, `User Auth`, `Public`, `Admin › Staff`, `Admin › Users`, `User › Profile`, `<new module>`.
2. Every request: URL `{{baseUrl}}/api/v1/…`, `Authorization: Bearer {{staffAccessToken}}` or `{{userAccessToken}}`, JSON body example matching the contract schema.
3. Tests (JS) on every request: status code; `success` boolean; success → `data` present, `meta.requestId` string; list → `meta.pagination.{offset,limit,total}`; error → `error.code` equals expected. Login/refresh tests store `*AccessToken` / `*RefreshToken` into environment; logout clears them.
4. Order requests so the Collection Runner works top-to-bottom: health → admin login → me → refresh → CRUD → logout → me(401); same for user.
5. Keep ids flowing: create → `pm.environment.set('lastStaffId', …)` → get/patch by `{{lastStaffId}}`.
6. Verify: `pnpm test:postman` (newman with `local` env; API + docker running; dev fixtures seeded).
7. Update `docs/postman/README.md` if folders changed.
