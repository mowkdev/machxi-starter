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

## Consequences

- Clients get exact request/response types and validation for free, without ORM or server dependencies.
- One definition for every enum across DB, API validation and UI.
- Slight duplication between DB row types and resource types is intentional: the wire shape must be able to diverge from storage.

## Alternatives considered

- Generating a client from OpenAPI: planned addition, not a replacement — the zod schemas are the source the OpenAPI doc will be generated from.
- Sharing `@repo/db` types with clients: couples UIs to storage and drags ORM types into browser bundles.
