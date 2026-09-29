#!/usr/bin/env node
// Generates `docs/rules/<area>.md` — the current-rules digests (ADR-0065 §5).
//
// The digest is DERIVED: this script owns the rule lines, the ADR corpus owns
// every citation. For each cited record the generator reads the record's own
// title and `- Status:` line, renders the citation with a topic gloss taken
// from the title, and refuses to emit a digest that cites a record which is out
// of force. It also refuses to run while an accepted record is cited by no
// line as its own, so accepting a record means writing its lines (ADR-0074
// §3). `/ship` runs it as part of the sweep; `docs/rules/*.md` is never
// edited by hand.
//
// Usage:
//   node scripts/rules-digest.mjs           write the digests
//   node scripts/rules-digest.mjs --check   fail if any digest is out of date

import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * The rule lines, per area. `records` names the record each line comes from;
 * the generator turns an id into a glossed link and checks it is in force.
 */
export const AREAS = [
  {
    slug: "api-and-data",
    title: "API and data — the rules in force",
    loadWhen:
      "`apps/api`, `packages/contracts`, `packages/db`, `packages/crypto`, `packages/logger`",
    rules: [
      {
        topic: "Functional style, no OOP",
        records: ["0009"],
        text: "No `class`, no `this`, no decorators, no DI framework. Every layer is `create<Module><Layer>(deps)` returning an `as const` object; types come from `ReturnType`. Third-party constructors are wrapped in `create*` functions.",
      },
      {
        topic: "Layers",
        records: ["0009"],
        text: "`*.routes.ts` → `*.controller.ts` → `*.service.ts` → `*.repository.ts`. Services never import Express or SQL; repositories hold every Drizzle query; controllers read `req.valid`, call the service with `req.ctx` first, and answer through `respond.*`.",
      },
      {
        topic: "Envelope",
        records: ["0012"],
        text: "Controllers use `respond.ok / created / list / noContent` and nothing else; `res.json` appears only inside the API's own `core/http`.",
      },
      {
        topic: "Errors",
        records: ["0013"],
        text: "One branded `AppError`, thrown through factories (`notFound()`, `forbidden()`, a module's `*.errors.ts`) and matched with `isAppError(e)` plus `e.code` — never `instanceof`, never a new error class. The API's `message` is developer-facing English and is never rendered by a client. The handler reports 5xx through the reporting seam and the response shape does not widen.",
      },
      {
        topic: "Configuration",
        records: ["0004"],
        text: "In `apps/api/src` only `core/config` reads `process.env`; in `@repo/db` only `src/tooling/env.ts` does. A new variable means a zod schema entry, an `.env.example` line and — when a task reads it — a `turbo.json` `env` entry.",
      },
      {
        topic: "Loading env files",
        records: ["0075"],
        text: "An env file is loaded with Node's own loader (`--env-file`, `process.loadEnvFile`): the environment wins over the file, and a missing file is skipped. No file in the API image's `dist/` carries a loader package; a test harness may keep one as a dev dependency when it must override. Beside the application — harnesses, the browser tier, repository scripts — a process may read what it needs and forwards it unvalidated; a real configuration surface goes behind a schema. `@repo/db`'s CLI tooling may read an unset `NODE_ENV` as `development`; the API requires it.",
      },
      {
        topic: "Request context",
        records: ["0010"],
        text: "Services take `ctx: RequestContext` as their first parameter; `getContext()` belongs to infrastructure only.",
      },
      {
        topic: "Validation",
        records: ["0011", "0023"],
        text: "Zod schemas live in `@repo/contracts` and are re-exported by `<module>.schemas.ts`; controllers read `req.valid.{params,query,body}` and nothing else; bodies are `.strict()`.",
      },
      {
        topic: "Auth and guards",
        records: ["0017", "0019", "0057"],
        text: "Two populations — `staff` and `user` — with separate tables and separate segments `/api/v1/{public,user,admin}`; `authenticate()` at router level and `authorize()` at the mount; `super_admin` bypasses staff role checks. Self-scoped resources carry no `authorize` because the subject is `ctx.principal`. An impersonated session is a `user` session minted by staff: it carries the actor, rotates without extending, and refuses credential operations.",
      },
      {
        topic: "Database",
        records: ["0006", "0008", "0061"],
        text: "Schema in `packages/db/src/schema`; migrations are generated with `drizzle-kit generate` and committed, never pushed; the API never auto-migrates; seeds are idempotent. The API connects as the application role (`DATABASE_URL`) with table privileges and no DDL, and every tooling connection is the owner role (`DATABASE_URL_OWNER`, required with no fallback).",
      },
      {
        topic: "Migrations applied by hash",
        records: ["0078"],
        text: "`db:migrate` is the repository's own runner, under the advisory lock: a journal entry is applied when no row of `drizzle.__drizzle_migrations` records its hash or its journal timestamp — never because it is newer than the newest row — in journal order, a run of ordinary files in one transaction. A file whose first line is `-- migrate:concurrently` runs each statement on its own outside any transaction and is recorded when the last succeeds, so its statements are single and repeatable (an index is dropped `CONCURRENTLY IF EXISTS` before it is built). The migrations directory is pinned to LF.",
      },
      {
        topic: "Append-only audit",
        records: ["0058", "0061"],
        text: "`audit_events` is append-only in the database as well as in the lint rule — a revoked grant and a `BEFORE UPDATE OR DELETE` trigger — so retention is a reviewed migration and never a job.",
      },
      {
        topic: "Per-population data",
        records: ["0045", "0053"],
        text: "Per-population data gets a table per population with a real foreign key rather than a discriminated table; `sessions` is the single exception and says why in place.",
      },
      {
        topic: "List endpoints at scale",
        records: ["0014", "0060"],
        text: "One list-query language, its codec in `@repo/contracts`. `offset` has a ceiling and `count` is an optional flag: with `count=false` a repository skips the aggregate and returns `total: null`. Every sortable and searched column carries a covering index declaration, trigram indexes for search and btree for sorts.",
      },
      {
        topic: "Tenancy",
        records: ["0067"],
        text: "One database, one schema: every tenant-owned table carries `organization_id not null` and is indexed tenant-led, with no bare `(column, id)` pairs beside those composites. A repository over such a table takes the organization id as a required parameter; the sanctioned exception is a read scoped by the **principal** rather than by a tenant, named in its repository for what it is, and the hand-maintained `TENANT_OWNED_TABLES` list is what the enumeration test checks the roster against. Every path that creates a user creates their personal organization in the same transaction, and every path that deletes one soft-deletes it in the same transaction; staff are never members. A third guard, `requireMembership(...roles)`, resolves the caller's membership of the organization in the path and places it on the context — a non-member is answered `404` rather than `403`, a member whose role is too low `403`, and only the guard that checks writes the field. The `/user` segment's organization requests carry `/orgs/:orgId`; requests about the caller — their organizations, their invitations — stay outside it. Impersonated sessions are refused the tenant writes: role changes, removals and leaving, deletion, and creating or accepting an invitation. An invitation names an address, not an account: its create path mints a single-use token and stores only the SHA-256 in `token_hash`, which nothing returns and nothing reads until the mail deliverable — acceptance in D15 matches by address.",
      },
      {
        topic: "Infrastructure seams",
        records: ["0066"],
        text: "Mail goes through the `MailSender` port in `core/mail` and never through a client a service imports; `GET /metrics` lives in `core/metrics` beside `/health`, above every limiter, labelled by route pattern and behind a token; the reporter in `core/reporting` fires on 5xx only and is given the request id, route, status and principal — never the body; every rate limiter shares one store, Redis when configured and memory otherwise, failing closed. All four seams are inert in a default clone.",
      },
      {
        topic: "The development rate-limit profile",
        records: ["0069"],
        text: "The committed development template, `.env.example`, raises `RATE_LIMIT_GLOBAL_MAX` to hold a failed verification run and its retry; the schema default stays the security baseline's number, and the production template does not carry the variable, so a deployment that states nothing inherits the baseline. A development value is kept off the deployment's path by separation, not refused at startup.",
      },
      {
        topic: "A per-principal hash budget",
        records: ["0073"],
        text: "Every authenticated route that verifies a password through the hash limiter also carries the per-principal limiter, keyed on `ctx.principal.id` (`RATE_LIMIT_PRINCIPAL_HASH_MAX` per `RATE_LIMIT_PRINCIPAL_HASH_WINDOW`), so a few sessions cannot shed login for everyone and an actor guessing their own password spends their own budget. The rule is the criterion — a new route that verifies a password joins it — and the roster lives in the specs and the integration tier.",
      },
      {
        topic: "Limiter keys",
        records: ["0073"],
        text: "A limiter key never degrades to one shared bucket: without a validated address the key generator falls back to the socket's remote address and warns once per process naming the proxy configuration. The fallback keys the limiter only and is never written to `sessions.ip`.",
      },
      {
        topic: "The session cap and the prune",
        records: ["0073", "0074"],
        text: "Login and the federated exchange revoke the principal's oldest live sessions beyond `AUTH_MAX_SESSIONS_PER_PRINCIPAL` (`0` uncapped) inside the mint's transaction, reason `session_cap`. An impersonated session neither counts toward the cap nor is evicted by it — it ends on its own clock. The reference deployment runs the `prune` service on `PRUNE_INTERVAL`, so a production database stops growing by default.",
      },
      {
        topic: "Credential events spend every link",
        records: ["0074", "0071"],
        text: "One `supersedeAll(ctx, principal, tx)` in `core/tokens` spends every outstanding account link, and every credential event calls it — an administrative or staff reset, a password or address change, an account deletion — rather than a per-purpose loop copied into a service. A purpose that should survive a credential event says so where it is declared.",
      },
      {
        topic: "The impersonation exchange ends what it replaces",
        records: ["0070"],
        text: "When `POST /user/auth/impersonate` arrives with a refresh cookie that resolves to a live impersonated session, the exchange revokes that session and writes its `impersonation.ended` row, marked replaced, in the transaction that mints the new one. A cookie resolving to a real customer session is left alive in the database, and one resolving to nothing is ignored.",
      },
      {
        topic: "Account deletion",
        records: ["0028", "0072"],
        text: "A user is soft-deleted — `deleted_at`, `status = 'disabled'`, every live session revoked `account_deleted` and every federated identity hard-deleted, in one transaction — and the address is released by a partial unique index, so every `on conflict` on `users.email`, seeds included, carries the `deleted_at is null` predicate. A deleted account stays readable and refuses writes with `409 USER_DELETED`; there is no restore. Staff are hard-deleted, never by themselves, under the rank rule and the last-super-admin invariant behind its advisory lock, their sessions revoked before the row goes.",
      },
      {
        topic: "Federated identity",
        records: ["0072"],
        text: "A sign-in resolves by `(provider, subject)` first and by address only when the claim is verified, the provider is authoritative for the address, and a live `active` user holds it. The Google routes mount only when both client settings are set; the provider is a port with a fake the integration tier drives. The callback hands off through a sixty-second `federated_login` account token bound to the browser the callback answered, and a password written without the account's own authority removes every federated identity. Link and unlink are refused to an impersonated session, and unlinking the last credential is refused.",
      },
      {
        topic: "Server timeouts and the runtime floor",
        records: ["0073"],
        text: "`server.ts` sets the request, headers and keep-alive timeouts from `HTTP_REQUEST_TIMEOUT`, `HTTP_HEADERS_TIMEOUT` and `HTTP_KEEP_ALIVE_TIMEOUT` beside the drain deadline, keep-alive above a proxy's. The runtime floor is Node 24 at the patch the dependency tree requires (`engines.node`), with `.nvmrc`, the workflows and the Dockerfiles moving together; pnpm 12 through Corepack, its settings in `pnpm-workspace.yaml`.",
      },
      {
        topic: "Invariants in the database",
        records: ["0073"],
        text: "`updated_at` is written by the column's `$onUpdate`, not by a repository remembering it, and `users` carries `CHECK (status <> 'active' OR email_verified_at IS NOT NULL)` — an invariant the code leans on is a database error, not a review finding.",
      },
      {
        topic: "The composition root and the line ceiling",
        records: ["0073", "0074"],
        text: "`core/container.ts` is ordering only: `createRateLimiters(config, store)` returns the named set and each module exports one `wire<Module>(deps)` returning its repositories, services and controllers. No source file in the trees the hygiene test's `LINE_CEILING_ROOTS` names — the API's modules and `core` among them — runs past a thousand lines.",
      },
      {
        topic: "Logging",
        records: ["0005"],
        text: "pino through `ctx.logger`; a fields object first and a short static message second; no `console.*`.",
      },
      {
        topic: "Contracts",
        records: ["0023"],
        text: "`@repo/contracts` depends on `zod` alone; an enum is defined there once and consumed by both `pgEnum` and zod.",
      },
      {
        topic: "Tests",
        records: ["0021"],
        text: "Unit tests use fake repositories as plain objects; integration tests go through `createApp(buildContainer({ db: testDb }))` and supertest against the test database. Every new endpoint gets both, plus a Postman request.",
      },
      {
        topic: "Lint is the mechanical half",
        records: ["0002", "0062"],
        text: "`packages/config-eslint/api.js` already fails the build on classes, raw responses, `process.env` and layer-crossing imports. A rule a reviewer keeps repeating belongs there instead.",
      },
      {
        topic: "Behaviour specs",
        records: ["0068"],
        text: "`docs/specs/<capability>.md` states what a client observes on the wire — requirements with WHEN/THEN scenarios, each citing its record and the test file that proves it — and is edited in place by the step that changes the behaviour, in the same diff as the code and the test. `pnpm docs:check` refuses a requirement without a scenario, a record that does not exist or a test that does not.",
      },
    ],
  },
  {
    slug: "frontend-and-platform",
    title: "Frontend and platform — the rules in force",
    loadWhen:
      "`apps/admin`, `apps/customer`, `packages/ui` and the eight platform packages",
    rules: [
      {
        topic: "Where the machinery lives",
        records: ["0051", "0062", "0077"],
        text: "The behavioural machinery is packages, not app code: `@repo/api-client` (client, session, CSRF, URL⇄query), `@repo/i18n`, `@repo/resource`, `@repo/grid`, `@repo/form`, `@repo/app-services`, `@repo/app-kit` (the provider stack, the auth and account layouts, the app loader, the top-level error boundary, the router defaults, the app i18n factory, and the SPA test harness behind its own `testing` entry) and `@repo/account` (the account's client: the settings entity and gate, the preference cards, password recovery and the shared profile forms). An app keeps what a door cannot bind with a value — the binding of the settings gate, its router, route tree, dictionary, policy data, config and size budget.",
      },
      {
        topic: "The session and the root in the kit",
        records: ["0077", "0062"],
        text: "`@repo/app-kit` holds the session provider with its unreachable notice, the principal-cache boundary and the root composition that orders the providers, each parameterised by what differed between the apps: the segment, the notice's sentence, the function that derives the cache key from a principal, and slots for the providers the kit does not own. An app's `app/providers/session.tsx`, `principal-cache.tsx` and `app/index.tsx` are bindings. The kit learns no route name, no resource name and no policy; the router, the route tree and `test/render` stay in the apps. A package's behaviour is certified in the package, and a door's own suite is a smoke test of the binding.",
      },
      {
        topic: "The account package",
        records: ["0077", "0045", "0053", "0051"],
        text: "`@repo/account` names the account's own resources — settings, profile, credentials — and no other. It depends downward only, on `@repo/app-kit` never and on `@repo/grid` never; what it needs from either arrives as a parameter or a slot. Navigation leaves it as callbacks and rendered children. It ships its own namespace, and copy the two apps word differently stays in the app and arrives as a key. What one segment alone has stays in that app.",
      },
      {
        topic: "Doors",
        records: ["0051", "0062", "0077"],
        text: "An app reaches a platform package only through its own `shared/` door; `no-restricted-imports` refuses the package path anywhere else. A door is the only path to those symbols — not one slice per package, since a slice may front several — so the door blocks are generated per slice from each app's `DOORS` table. A feature package's door is a feature or entity slice rather than a `shared/` slice, and a page's imports do not change. The invariant is unchanged: a door is exempt from its own groups and from no others.",
      },
      {
        topic: "Design system",
        records: ["0047", "0054"],
        text: "shadcn/ui in `@repo/ui` on Tailwind v4, reached only through the `shared/ui` door. The design speaks through three surfaces — the token sheet, the hand-written compositions, and the grid's own styling; a need none of the three can meet is an owned edit carrying its comment, or a finding for the record, never a quiet restyle of a generated primitive.",
      },
      {
        topic: "Tokens",
        records: ["0054"],
        text: "Colour, radius, type and spacing come from tokens; a raw hex or an arbitrary `oklch()` in a component is the defect. The neutrals and the primary sit on one hue at low chroma, borders are solid rather than alpha in dark, and four tokens extend shadcn's set.",
      },
      {
        topic: "Generated versus written UI",
        records: ["0047", "0074"],
        text: 'Primitives under `packages/ui/src/components/` and `src/hooks/` stay byte-identical to the CLI output and are prettier-exempt; an edit to one earns itself with a comment naming the rule that forced it. Hand-written compositions live in `src/compositions/` under the ordinary regime and are presentation-only: no contracts import, no routing, no forms, no session — and no `"use client"` directive, which a consumer that needs one reintroduces by its own record.',
      },
      {
        topic: "Architecture",
        records: ["0049", "0051", "0062"],
        text: "FSD layers `app → pages → widgets → features → entities → shared` with downward-only imports enforced by lint, and file-based routes. An entity may not import another entity — the feature layer is where two entities meet.",
      },
      {
        topic: "Session",
        records: ["0033", "0051", "0030", "0056"],
        text: "Credentials live in memory only — no token, CSRF token or principal in `localStorage`, `sessionStorage` or a client-set cookie; non-credential display state may be persisted. Refresh is single-flight, the CSRF token comes from the bootstrap endpoint, its cookie is named per population, and the client never reads `document.cookie`.",
      },
      {
        topic: "Server state",
        records: ["0043", "0044"],
        text: "TanStack Query owns all server state through per-entity key factories — never an inline key. Outcomes are declared in typed mutation `meta` and delivered by one global handler; queries are silent and render their own failure panel. List state lives in the URL in the API's own query language through the shared codec; a record URL carries only the record, and the way back travels as history state.",
      },
      {
        topic: "Resource configs",
        records: ["0035", "0063"],
        text: "One `ResourceConfig<TRow, TCreate, TUpdate>` per resource — serializable config plus named registries — drives both the grid and the config-driven forms over the contracts schemas; every field is disabled while a mutation is pending, and copy in a config is a translation key. Columns are keyed by the row and fields by either body; the claims no type can make are one call of `assertConfigMatchesContract`.",
      },
      {
        topic: "The grid",
        records: ["0037", "0038", "0039", "0041", "0042", "0052", "0054"],
        text: "A grid page is a height budget with one scroll container, a sticky header and a static pager, every wrapper down to the grid carrying `flex flex-col flex-1 min-h-0` and nothing on that path clipping. Capability flags say what a surface offers and `can(action, resource)` says who may use it, conjoined once per screen so the grid never learns a resource name. There is no filter row: a filterable column gets a header dialog that commits on Apply, hot filters are toolbar stances, and the applied-filters bar renders from the URL. Create and the Columns control sit in the page-header band. Bulk delete is a bounded client-side fan-out with per-item refusals.",
      },
      {
        topic: "What owns what",
        records: ["0041", "0043", "0044", "0054"],
        text: "The URL owns view state, preferences own ergonomics, history state owns the way back, and the table owns nothing durable. Preferences, theme, locale and row density are an account fact with `localStorage` as the cache in front, and the preference store never learns that a grid id is on the wire. Density is a mode rather than a scale, moving the row height, the cell padding and the in-row badge and nothing else.",
      },
      {
        topic: "The account area",
        records: ["0053"],
        text: "One `/account` route family with sections; the account menu is identity and exit only, the quick controls live in preferences, and the sidebar carries no account entry.",
      },
      {
        topic: "Copy",
        records: ["0046"],
        text: "Two localized catalogues: error codes in the `errors` namespace, typed complete over `ErrorCode`, and field rules as zod's own messages through the client-side error map. The API's `error.message` is never rendered. Every operator-facing string is a typed key — a literal in JSX fails lint. `@repo/ui` gains no i18n dependency; its strings arrive through the `UiStrings` context.",
      },
      {
        topic: "Brand seams",
        records: ["0064"],
        text: "The app identifier is configuration, not a literal: the API derives its cookie names and token audience from it, and each SPA derives every device-storage key as `${appId}.${segment}.${fact}` through parameters on the packages that store anything.",
      },
      {
        topic: "Testing",
        records: ["0036", "0052"],
        text: "Vitest, Testing Library and MSW with handlers derived from the contracts; no live-API tier, because a mock more permissive than the service certifies the opposite of production. Assertions go by accessible name in English, and the pseudo-locale suite proves no literal survived.",
      },
      {
        topic: "Build and budget",
        records: ["0002", "0062"],
        text: "Packages stay source-only and Vite consumes `src`; project references add a declarations-only build for type-checking, emitted where nothing resolves to it at runtime. Vendor groups are explicit chunks, sourcemaps are hidden, and each SPA's budget carries per-chunk ceilings beside its totals.",
      },
      {
        topic: "Budget headroom",
        records: ["0073"],
        text: "Every ceiling in a `size-budget.json` is at most 15% over its committed baseline, enforced by `scripts/size.mjs`, and a diff that raises a ceiling re-measures its baseline, so a raise always shows both numbers; a measurement more than ten percent over its baseline is reported beside the table and never fails the link. The entry stays lean by declaration rather than by a raise: a rendering package the composition root imports by barrel declares `sideEffects: false` when nothing in it acts on import.",
      },
      {
        topic: "The content policy",
        records: ["0073", "0074"],
        text: "Both SPA images send a Content-Security-Policy from `nginx.conf`: scripts from `'self'` only, styles from `'self'` plus `'unsafe-inline'` (Tailwind's stated price), `connect-src` the API origin substituted from `VITE_API_URL` and refused unless it is `scheme://host[:port]`, `object-src 'none'`, `frame-ancestors 'none'`. A built `index.html` carries no inline script, inline style element or event-handler attribute, checked after `size`'s build; an origin a fork adds goes in `nginx.conf`.",
      },
      {
        topic: "Impersonation in a new tab",
        records: ["0070", "0057"],
        text: "The confirm opens a blank tab synchronously inside the click, mints, then disowns the tab's `opener` before navigating it to the handoff; a refused mint closes the tab and keeps the confirm with its toast, and a browser that refuses the open falls back to the same tab.",
      },
      {
        topic: "Invalidation",
        records: ["0043"],
        text: "A mutation invalidates its own entity's keys; the feature invalidates whatever else the interaction touched.",
      },
    ],
  },
  {
    slug: "process",
    title: "Process — the rules in force",
    loadWhen:
      "`/scope`, `/step`, `/steps`, `/ship`, `/new-adr`, `/bootstrap` and any review pass",
    rules: [
      {
        topic: "Deliverables",
        records: ["0079", "0025"],
        text: "Work is staged into numbered deliverables, one plan file each, steps written `D<n>.<step>`, and each closes on an executable acceptance checklist. More than one may be in progress when no record — written, superseded or amended in place — belongs to two of them; each is a lane, and the condition is checked by a test when a lane opens. At most one open lane adds migrations. Steps stay sequential within a lane.",
      },
      {
        topic: "The window",
        records: ["0079", "0025"],
        text: "An ADR may be amended in place only while the deliverable it belongs to is in progress; once that deliverable ships the record changes only by supersession, and opening a second lane reopens nothing. Which windows are open, and which records are in force, is stated in one place — the ledger's window section, one entry per open lane — and linked from everywhere else.",
      },
      {
        topic: "Lanes",
        records: ["0079"],
        text: "A lane builds on a branch named for its deliverable, `lane/D<n>`, merges `main` in before a step's gate and merges to `main` when the step is green; a step is not closed while `main` does not carry it, and `/ship` runs on `main`. A lane that is the only one open may build on `main` itself, and cuts its branch when a second opens. Deliverable and record numbers are reserved by scoping on `main`. The shared surfaces merge by the row, and a conflicted digest is regenerated, never hand-merged. `/step`, `/steps` and `/ship` take the deliverable while more than one row is in progress and refuse a bare call then.",
      },
      {
        topic: "Acceptance at the head",
        records: ["0025"],
        text: "A record written `proposed` is accepted at the head of the step that builds it, so a step whose record is still `proposed` is gated and must not be started.",
      },
      {
        topic: "Supersession states the delta",
        records: ["0050"],
        text: "A superseding record states the delta and carries the parent's untouched sections by reference; whole restatement is permitted and never required. Where a supersession is a delta the parent still stands for everything the successor does not touch.",
      },
      {
        topic: "Altitude",
        records: ["0050"],
        text: "A record decides; it does not enumerate. Counts, rosters and anything a compiler could check belong in tests and lint rules rather than in prose.",
      },
      {
        topic: "Verification",
        records: ["0050"],
        text: "Machines are the gate; review is one bounded pass over the diff per step — no refutation rounds and no zero-finding requirement. Uncertain mechanics get a timeboxed spike in a worktree rather than a debate.",
      },
      {
        topic: "The gate",
        records: ["0026", "0052", "0057", "0074"],
        text: "The gate command is defined once, in `CLAUDE.md` §Commands, and referenced by name everywhere else. `pnpm check` is the cached inner loop; a task whose result depends on anything outside the repository is never cached and declares its `env`. A cached task's hash covers every workspace whose source it runs: `test:unit` reaches its workspace dependencies through turbo's `transit` node, which no workspace defines as a script.",
      },
      {
        topic: "The first link runs every check",
        records: ["0073", "0074"],
        text: "`lint`'s `dependsOn` carries every root and app check the repository defines — `test:scripts`, `docs:check`, `i18n:check` — and a hygiene case refuses a check it does not name, so a new one joins by predicate. A cached task's restored outputs must not decide its own result: a buildinfo sits under a cached output only beside the emit it belongs to. Coverage is reported with no threshold — on every run in the node suites, and in the jsdom suites only on `--coverage`, which keeps the slowest link a quarter shorter; `pnpm audit --prod` runs nightly beside the browser tier, reported and never gating.",
      },
      {
        topic: "Pinning, holds and the cooldown",
        records: ["0073", "0074"],
        text: "Caret ranges by default and exact for the runtime framework and the compiler; any other exact pin is named with its reason in `renovate.json`'s pinning register. A version many workspaces declare lives in the `catalog:`; GitHub Actions are pinned by digest and the base images carry a named Renovate rule. A dependency held below a version is one `overrides` entry in `pnpm-workspace.yaml`, not a pin per workspace. `minimumReleaseAge` is one day for pnpm and for Renovate alike, with the one-install override for a younger security fix written beside pnpm's setting, and a lockfile through review installs under `trustLockfile`.",
      },
      {
        topic: "The compiler",
        records: ["0076"],
        text: "`tsc -b` runs TypeScript 7, the catalog's exact version, in every workspace. `typescript-eslint` needs the JavaScript API 7 does not have, so `@repo/eslint-config` alone declares `typescript` as an exact `npm:typescript@6.0.x` alias. The lockfile carries those two versions and no third. The alias, its Renovate hold and the `@typescript-eslint/*>typescript` peer entries go together, with the first `typescript-eslint` whose peer admits 7. Declarations are the native compiler's own — type-equivalent to 6.0's, not byte-identical.",
      },
      {
        topic: "Forking",
        records: ["0065"],
        text: "A fork is a clone that keeps history, adds this repository as the `starter` remote and merges from it. A fork never edits an inherited record — it supersedes, because an edit turns the next merge into a conflict and erases which decision was deliberately dropped. `docs/adr/` and `.claude/` are carried into a fork; `docs/plan/` is this repository's journal and resets.",
      },
      {
        topic: "Upstreaming",
        records: ["0065"],
        text: "A generic feature travels back re-implemented as its own deliverable off `starter/main`, never as a cherry-pick: the fork's diff is the specification, not the patch. Generic has a test — no fork domain nouns, and no reference to the fork's own record numbers or plan steps.",
      },
      {
        topic: "Versioning",
        records: ["0065"],
        text: "`/ship` tags the shipping commit `starter-D<n>` and writes one changelog entry per shipped deliverable. Not per commit, and not semver.",
      },
      {
        topic: "Citations that survive a fork",
        records: ["0065"],
        text: "In `.claude/**` every record citation carries a topic gloss and never a bare range, and no step numbers or dates appear. Source-code comments keep their step references — they are the reasoning attached to the code that carries it.",
      },
      {
        topic: "The digests",
        records: ["0065", "0074"],
        text: "`docs/rules/<area>.md` states the rules currently in force, each line naming its record; the rule files and the skills load the digest for their area. The records remain the source of truth, and the digest is generated at ship rather than edited. The rule lines live in `scripts/rules-digest.mjs`, and the generator refuses an accepted record that no line cites as its own — accepting a record means writing its lines.",
      },
      {
        topic: "Specs and notes",
        records: ["0068"],
        text: "A behaviour spec per capability in `docs/specs/` is current truth, edited in place with the behaviour and carried into forks like code. A plan file holds only what `/step` executes; the build notes go to its `.notes.md` sibling, so a builder opens the plan and one spec rather than the journal.",
      },
    ],
  },
];

const HEADER_NOTE =
  "<!-- Generated by `node scripts/rules-digest.mjs` — do not edit by hand. The records in `docs/adr/` are the source of truth; `/ship` regenerates this file. -->";

/** Reads every ADR, returning `{ id: { title, slug, status, successors, delta } }`. */
export async function readRecords(root = repoRoot) {
  const dir = path.join(root, "docs", "adr");
  const files = (await readdir(dir)).filter((name) =>
    /^\d{4}-.*\.md$/.test(name),
  );
  const records = {};
  for (const file of files) {
    const id = file.slice(0, 4);
    const body = await readFile(path.join(dir, file), "utf8");
    const heading = body.match(/^#\s*ADR-\d{4}:\s*(.+?)\s*$/m);
    const status = body.match(/^-\s*Status:\s*(.+?)\s*$/m);
    if (!heading || !status)
      throw new Error(`ADR ${id}: no title or status line`);
    const statusText = status[1];
    const superseded = /^superseded by/i.test(statusText);
    records[id] = {
      id,
      file,
      // The gloss is the record's own title, cut at whichever separator the
      // title uses for its subtitle — an em dash, a colon or a parenthesis.
      title: heading[1].split(/ — |: | \(/)[0].trim(),
      status: statusText,
      superseded,
      delta: superseded && /delta/i.test(statusText),
      successors: superseded ? successorsOf(statusText) : [],
    };
  }
  return records;
}

/**
 * The successors named by a `- Status: superseded by …` line.
 *
 * Only *linked* references count. A delta note routinely names other records
 * in prose — ADR-0050's names the parent whose reasoning it restores — and a
 * bare match would read that parent as a successor and print the supersession
 * backwards.
 */
export function successorsOf(statusText) {
  return [...statusText.matchAll(/\[ADR-(\d{4})\]\(/g)].map((m) => m[1]);
}

function glossFor(id, records) {
  const record = records[id];
  if (!record) throw new Error(`digest cites ADR-${id}, which does not exist`);
  if (record.superseded && !record.delta) {
    throw new Error(
      `digest cites ADR-${id}, which is wholly superseded by ADR-${record.successors.join(", ADR-")} — cite the successor`,
    );
  }
  const link = `[ADR-${id}](../adr/${record.file})`;
  // Lower-case the leading letter so the gloss reads inside a sentence — unless
  // the title opens on an acronym or a code identifier, where case is meaning.
  const gloss = /^[A-Z][a-z]/.test(record.title)
    ? record.title.charAt(0).toLowerCase() + record.title.slice(1)
    : record.title;
  if (record.superseded) {
    const carriers = record.successors
      .map((s) => `[ADR-${s}](../adr/${records[s].file})`)
      .join(" and ");
    return `${link} (${gloss}) as carried by ${carriers}`;
  }
  return `${link} (${gloss})`;
}

export function renderArea(area, records) {
  const lines = [
    HEADER_NOTE,
    "",
    `# ${area.title}`,
    "",
    `Loaded with ${area.loadWhen}. Each line names the record it comes from; open that record when the line is not enough. Which windows are open and which records are in force is stated once, in [the ledger](../plan/README.md#the-window).`,
    "",
  ];
  for (const rule of area.rules) {
    // A record the corpus does not hold is not a rule this corpus is under. A
    // fork bootstrapped from nothing (`/bootstrap --empty`) has no records yet,
    // and its digests start empty rather than citing the starter's. A record
    // that exists but is out of force is a different matter and still throws.
    const cited = rule.records.filter((id) => records[id]);
    if (cited.length === 0) continue;
    const citation = cited.map((id) => glossFor(id, records)).join(", ");
    lines.push(`- **${rule.topic}** — ${rule.text} — ${citation}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * The accepted records no rule line cites as its own (ADR-0074 §3).
 *
 * A record is a line's primary citation when it is named in that line's
 * `records` — rendered with its own link — as opposed to appearing only in the
 * "as carried by" suffix of a parent it supersedes. That suffix is how ADR-0073
 * reached a session and nothing more: its decisions had no line, and a
 * regeneration writing nothing looked the same as one with nothing to write.
 * A superseded record is out of this check's scope — its successor is the one
 * accepted — and so is a `proposed` one, which a step accepts at its head.
 */
export function uncitedRecords(areas, records) {
  const cited = new Set(
    areas.flatMap((area) => area.rules.flatMap((rule) => rule.records)),
  );
  return Object.values(records)
    .filter((record) => /^accepted\b/i.test(record.status))
    .filter((record) => !cited.has(record.id))
    .map((record) => record.id)
    .sort();
}

export async function generate({
  root = repoRoot,
  check = false,
  areas = AREAS,
} = {}) {
  const records = await readRecords(root);
  const uncited = uncitedRecords(areas, records);
  if (uncited.length > 0) {
    throw new Error(
      `accepted record${uncited.length > 1 ? "s" : ""} with no digest line of ${uncited.length > 1 ? "their" : "its"} own: ${uncited.map((id) => `ADR-${id}`).join(", ")} — add the rule lines to scripts/rules-digest.mjs`,
    );
  }
  const { default: prettier } = await import("prettier");
  const results = [];
  for (const area of areas) {
    const target = path.join(root, "docs", "rules", `${area.slug}.md`);
    const options = await prettier.resolveConfig(target, {
      editorconfig: false,
    });
    const rendered = await prettier.format(renderArea(area, records), {
      ...options,
      filepath: target,
      // `endOfLine: "auto"` reads the existing file, which a generator has just
      // rewritten; LF keeps the output identical on every platform.
      endOfLine: "lf",
    });
    let previous = null;
    try {
      previous = await readFile(target, "utf8");
    } catch {
      previous = null;
    }
    const changed = previous !== rendered;
    if (!check && changed) await writeFile(target, rendered, "utf8");
    results.push({ slug: area.slug, target, changed });
  }
  return results;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const check = process.argv.includes("--check");
  const results = await generate({ check });
  const stale = results.filter((r) => r.changed);
  if (check && stale.length > 0) {
    console.error(
      `Out of date: ${stale.map((r) => r.slug).join(", ")}. Run node scripts/rules-digest.mjs.`,
    );
    process.exit(1);
  }
  console.log(
    check
      ? `docs/rules: up to date (${results.length} digests)`
      : `docs/rules: wrote ${stale.length} of ${results.length} digests`,
  );
}
