# ADR-0023: Shared contracts package (`@repo/contracts`)

- Status: accepted
- Date: 2026-08-17

## Context

Several ADRs reference `@repo/contracts` as the home of wire-level types shared between the API and its clients (`admin`, `web`, later mobile): the envelope (ADR-0012), error codes (ADR-0013), pagination types (ADR-0014), role/status unions (ADR-0017), and request/response zod schemas (ADR-0011). Without a rule for what belongs there, it either becomes a dumping ground or clients start importing from `@repo/db` and couple themselves to the ORM.

## Decision

`packages/contracts` (`@repo/contracts`) contains **only** things that describe the HTTP contract, and depends on nothing internal (only `zod`).

```
packages/contracts/src/
├── envelope.ts        # Meta, SuccessEnvelope, ListEnvelope, ErrorEnvelope, Pagination, SortSpec
├── errors.ts          # ErrorCode union, ErrorDetail, ApiError shape
├── list-query.ts      # ListQuery param names/operators (documentation-level constants), FilterOp
├── enums.ts           # Population, StaffRole, UserRole, StaffStatus, UserStatus — string unions + arrays
├── auth/              # zod schemas + inferred types: loginBody, refreshBody, registerBody, TokenPair, PrincipalResource
├── staff/             # createStaffBody, updateStaffBody, StaffResource, listStaffQuery
├── users/             # createUserBody, updateUserBody, UserResource, listUsersQuery
└── index.ts
```

Rules:

- **In**: zod schemas for request bodies/queries/params, TypeScript types for API resources (what mappers produce), enums as string unions with a matching `as const` array (so zod `z.enum(STAFF_ROLES)` and Postgres `pgEnum(..., STAFF_ROLES)` share one source), error codes, envelope types.
- **Out**: anything importing `drizzle-orm`, `express`, `pino`, Node built-ins, or DB row types. Resource types are written by hand (or derived from zod response schemas), never `InferSelectModel`.
- The API's `<module>.schemas.ts` **re-exports** from `@repo/contracts` (and may add server-only refinements); it does not duplicate schemas.
- `@repo/db` imports the enum arrays from `@repo/contracts` for `pgEnum` definitions (dependency direction: `db → contracts`, added to the ADR-0002 rule list); `contracts` never imports `db`.
- Versioning: contracts are versioned with the API (`v1/` subfolder is introduced only when a `v2` API exists).
- Published as TS source like the other internal packages (ADR-0002); browser bundlers tree-shake unused schemas.

**Amended 2026-08-18 (implementation step 4).** The tree above is what was built, plus three files it did not anticipate, and one rule the "In" list left ambiguous:

- `primitives.ts` — the field-level schemas every request body reuses (`emailSchema`, `passwordSchema`, `presentedPasswordSchema`, `idSchema`, `nameSchema`) so "what a valid email is" is decided once rather than per module. The password split is deliberate: a password being *set* carries the ADR-0018 policy, a password being *presented* for verification is only bounded, because applying the policy at login would answer "is this one of ours?" with a `400` before any credential check.
- `health.ts` — `HealthResource` (ADR-0016). It travels in the normal envelope and is consumed by clients, so it is squarely inside the "In" rule; the original file listing was illustrative, not exhaustive.
- `list-query.ts` — carries the `listQuerySchema` builder and `Page<T>` as well as the operator constants. See the ADR-0014 amendment for why the builder cannot live in the API.
- **Requests get zod schemas; responses get hand-written types.** The "In" list allowed resource types to be "derived from zod response schemas"; they are not. A response schema plus a mapper is two descriptions of the same shape that drift independently, and the mapper is the one that runs. The single exception is `envelope.ts`, which does ship runtime schemas (`successEnvelopeSchema`, `listEnvelopeSchema`, `errorEnvelopeSchema`) for the ADR-0021 envelope-conformance tests and for clients validating what they receive. Those are deliberately **not** strict — unknown keys are stripped, not rejected — so that adding a `meta` field stays the additive change ADR-0015 says it is.
- zod **v4** (`^4.4.3`) is the pinned and only dependency. A lint rule in the package forbids importing `node:*` or `@repo/*`: `@types/node` has to be in scope for `vitest.config.ts` to type-check, so TypeScript alone would not keep the package browser-safe.

## Consequences

- Clients get exact request/response types and validation for free, without ORM or server dependencies.
- One definition for every enum across DB, API validation and UI.
- Slight duplication between DB row types and resource types is intentional: the wire shape must be able to diverge from storage.

## Alternatives considered

- Generating a client from OpenAPI: planned addition, not a replacement — the zod schemas are the source the OpenAPI doc will be generated from.
- Sharing `@repo/db` types with clients: couples UIs to storage and drags ORM types into browser bundles.
