---
name: add-endpoint
description: Checklist for adding a single endpoint to an existing API module — contract schema, controller/service/repository functions, route with guards, tests, Postman. Use for "add GET/POST … to <module>".
---

# Add endpoint — `$ARGUMENTS` (e.g. `PATCH /admin/users/:id/disable`)

Read `/api-conventions`. Then:

1. **Contract** — in `packages/contracts/src/<module>/schemas.ts` add params/query/body zod (`.strict()`, uuid params, max lengths) and response resource type changes; export.
2. **Service** — add `(ctx, ...)` function to `create<X>Service`; business rules + policies (`assertOwnerOrRole`); throw factories; return resource / `Page<T>` / `void`.
3. **Repository** — add the query if needed (`tx: DbExecutor = db` last); no business rules.
4. **Controller** — add handler: `respond.ok|created|list|noContent(res, await svc.fn(req.ctx, req.valid.…))`.
5. **Route** — `r.<verb>('/path', [authorize(...)?], validate({ params, query, body }), c.fn)`; segment must match ADR-0015 (`admin` staff-only, `user` user-only, `public`). Verb: POST create/action, PATCH partial, DELETE → 204.
6. **Errors** — new codes → `<m>.errors.ts` + contracts `ErrorCode`.
7. **Tests** — unit (service) + integration (happy, 400, 401, 403, 404 as applicable; list checks if list).
8. **Postman** — `/postman-sync`.
9. **Docs** — the current deliverable plan in `docs/plan/` scope; env vars if any.
10. `pnpm lint && pnpm check-types && pnpm test --filter api`.
