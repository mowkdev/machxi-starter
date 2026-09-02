# D15 — Organizations

> **Inserted 2026-09-02 together with [D14](0014-starter-hardening.md)**, ahead of the marketing site (now D16) — a ledger decision; see `docs/plan/README.md` §How D14 and D15 were inserted.

- Status: **planned** — scope document only. The record is written; the one-page plan is `/scope D15`'s job when D14 ships.
- Records: [ADR-0067](../adr/0067-organizations.md) (organizations — multi-tenancy), written `proposed` 2026-09-02 while D14 was scoped, so that D14's indexes, count flag, generators and typed configs are built tenant-aware. Accepted at the head of the D15 step that builds the tables.
- Ledger: [`docs/plan/README.md`](README.md)

## Scope in one page

**Goal.** Every user belongs to organizations; every tenant-owned table is scoped by one; staff stay above all of them. Sign-up creates a personal organization so no query has a "no organization" branch; a user may belong to many, each membership with a role. The active organization is in the URL and a membership guard resolves it per request. The admin app manages organizations as a resource; the customer app switches between them.

**Why now.** The one gap in the blueprint review that is not additive: retrofitting tenancy touches every table, query, guard and token. Deciding it before any fork exists is the whole reason ADR-0067 was written a deliverable early.

**What D14 leaves ready for it.** The app role (`D14.4`, the precondition for row-level security); the index and count conventions (`D14.5`); the mail port invitations need (`D14.6`); generator templates with the `organizationScoped` variable (`D14.11`); typed configs (`D14.10`) the organizations resource screen is written against.

**Shape of the steps** (to be written by `/scope D15`, each with commands and test names):

1. Schema and contracts — `organizations`, `organization_memberships`, the role tuple, the migration, seeds with a personal org per fixture user, the personal-org-on-sign-up transaction.
2. The guard and the context — `requireMembership(...roles)`, `ctx.organization`, `404` for non-members, the scoped executor and its ESLint rule.
3. The API surface — `/api/v1/user/orgs` (list mine), `/user/orgs/:orgId` (read, update as owner or admin), memberships sub-resource; `/api/v1/admin/organizations` with the standard resource shape and a memberships sub-resource; Postman.
4. The admin resource screen — through the `D14.11` generator, the first proof that it produces a real screen.
5. The customer app — routes under `/orgs/$orgSlug/...`, the switcher in the shell header, the organization settings section.
6. Registration surface — the self-service sign-up ADR-0055 §5 deferred, now required because sign-up creates the personal org (behind `FEATURE_USER_REGISTRATION` as today).
7. Close-out — definition of done, `starter-D15`.

**Constraints already decided** (ADR-0067): shared schema; `organization_id not null` with a composite index led by it on every tenant-owned table; roles `owner | admin | member`; staff never members; resolution by URL; `security-reviewer` on every step — this is the feature where a missed filter is a cross-tenant leak.

**Not in D15.** Invitations' delivery (the mail flows deliverable), billing, plans, SSO, per-organization settings beyond name and slug, enabling row-level security (a follow-up step once D15's tables exist; the shape is fixed in ADR-0067 §5).
