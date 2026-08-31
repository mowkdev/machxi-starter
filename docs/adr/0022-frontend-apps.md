# ADR-0022: Frontend apps — `web` (Next.js) and `admin` (Vite + React)

- Status: superseded by [ADR-0055](0055-customer-app.md) (delta: the app roster; every stack decision below stands)
- Date: 2026-08-17

> **Superseded in part 2026-08-31, at the head of `D12.1`.** [ADR-0055](0055-customer-app.md) changes exactly one paragraph of the decision below — the roster: `apps/customer` joins as the user-facing Vite + React SPA on port 3002, and `apps/web` narrows to marketing only, its architecture D14's to decide. **Everything else here stands as written**: the stacks, the one-React-version alignment, `@repo/contracts`/`@repo/ui` as the shared floor, HTTP-only access to the API, and the port discipline itself. A delta supersession under [ADR-0050](0050-adr-lifecycle.md) rule 1 — read this record for what 0055 does not touch.

## Context

The blueprint ships two frontends whose internal architecture will be decided in later ADRs. This ADR only fixes their identity, stack and how they relate to the API and shared packages, so the monorepo layout (ADR-0002) is complete.

## Decision

- **`apps/web`** — public/user-facing app: **Next.js** (App Router, React 19, TypeScript). Renamed from the starter's `storefront`. Consumes the `public` and `user` API segments (ADR-0015).
- **`apps/admin`** — staff-facing panel: **Vite + React** SPA (React 19, TypeScript, upgraded from the starter's React 18 / Vite 5 to match `web` and `@repo/ui`). Consumes the `admin` API segment.
- Both depend on `@repo/contracts` (envelope, error codes, zod schemas, role unions) and `@repo/ui`; neither depends on `@repo/db`.
- Both talk to the API over HTTP only; no server-side DB access from `web` (Next route handlers may proxy to the API if needed for cookies — future ADR on browser token transport, see ADR-0018).
- Dev ports: `api` 4000, `admin` 3001, `web` 3002 (CORS allow-list in `.env.example` includes both).
- `apps/blog` (Remix) is removed.

## Consequences

- One React version across the workspace; `@repo/ui` has a single peer target.
- Frontend architecture (state, data fetching, routing, design system, i18n) will be covered by dedicated ADRs when those apps are built out.

## Alternatives considered

- Next.js for admin as well: possible, but a pure SPA is simpler for an authenticated internal tool and keeps the two stacks illustrated, per requirement.
