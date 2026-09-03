# ADR-0066: Infrastructure seams — mail, metrics, error reporting and shared rate-limit state

- Status: accepted
- Date: 2026-09-02
- Supersedes: [ADR-0020](0020-security-baseline.md) (delta: the rate limiters take a shared store when one is configured; every limit, key and window stands); [ADR-0016](0016-health-checks.md) (delta: `/metrics` joins `/health` as an unversioned operational endpoint); [ADR-0013](0013-error-model.md) (delta: the error handler gains a reporting hook — the response shape does not widen). Additive for mail.

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; **accepted 2026-09-03 at the head of `D14.6`**, the step that builds every section — so all three parents moved to `superseded by` at that one head, the [ADR-0061](0061-database-roles-and-append-only-enforcement.md) shape rather than [ADR-0059](0059-ci-containers-and-deployment.md)'s split across two steps. Amendable in place while D14 is `in progress` ([ADR-0025](0025-deliverables-and-adr-windows.md) rule 2); **amended three times in the accepting step**, each labelled at the point it applies: §2 (the library's real name, and the pool gauges deferred with their reason), §3 (no vendor SDK enters the repository) and §Consequences (three dependency groups, not four, and none in the SPAs).

## Context

Nothing in this repository can send an email. There is no self-service password reset, no address verification and no email-change flow; `pending_verification` is a shipped `UserStatus` with no path that ever sets it, [ADR-0027](0027-credential-self-service-and-reset.md) §Out of scope names the reset as deferred, and [`README.md`](README.md) §Planned has listed "email-based password reset" and "email delivery" since D1. D15's organizations need invitations, and an invitation is mail.

Observability is what [ADR-0005](0005-logging.md) and [ADR-0016](0016-health-checks.md) built: pino lines correlated by request id, and a liveness/readiness split. That answers "what is this process doing right now" for a human reading a terminal. It does not answer "how many 5xx did we serve last hour", "is the pool saturated" or "did anyone see the crash" — there are no metrics, no error reporting and no tracing.

Rate limiting is per process. `apps/api/src/core/middleware/rate-limit.ts` says so in place: the store is `express-rate-limit`'s in-memory default, so a two-instance deployment gets twice every limit in [ADR-0020](0020-security-baseline.md), including the login limiter. [ADR-0059](0059-ci-containers-and-deployment.md) makes multi-instance deployment a realistic thing to do, which turns that recorded consequence into a live gap.

Each of these is a **seam**, not a feature. This record decides where the seam is and what fills it by default; the flows that use them are their own deliverables.

## Decision

### 1. A `MailSender` port with two adapters

Functional style, per [ADR-0009](0009-api-modular-layering.md): `createLogMailSender(deps)` and `createSmtpMailSender(deps)` (nodemailer), one chosen in `core/container.ts` from config and handed to services as a dependency like every other.

```ts
type MailMessage = { to: string; subject: string; text: string; html?: string };
type MailSender = { send: (ctx: RequestContext, m: MailMessage) => Promise<void> };
```

Config: `MAIL_TRANSPORT=log|smtp`, the `SMTP_*` group and `MAIL_FROM`. `log` is the default everywhere but production, so tests and a fresh clone need no server; production must choose. `docker/local/compose.yaml` gains Mailpit, so a developer who switches to `smtp` reads the message in a browser — the local default stays `log`, because a port that must be up to run the API is a worse default than a log line.

Templates are plain functions returning `{ subject, text, html }`. No template engine, no MJML, no localization layer for now — the first flow that needs a second language decides that, and [ADR-0046](0046-interface-localization.md) already says a locale is an account fact rather than a request header.

**The flows are not this record.** Password reset, address verification, email change and invitations each need a token table, limiters and their own decisions; they belong to a deliverable after D15. This record ships the port, the two adapters and the local mail server, so that deliverable is about the flows and not about SMTP.

### 2. `GET /metrics`, beside `/health`

Mounted in `routes/index.ts` next to `/health` — unversioned, and **before** the `/api/v1` global limiter, for the reason ADR-0016 put health there: an operational endpoint that gets rate-limited takes a working instance out of rotation. `prom-client` in `core/metrics`: default process metrics, HTTP request count and duration labelled by **route pattern** (never the raw path — an id in a label is an unbounded cardinality bug), status class, and the pool's gauges.

**Amended 2026-09-03 (`D14.6`).** Two corrections, both found while building this section.

- **The package is [`@prometheus-io/client`](https://www.npmjs.com/package/@prometheus-io/client), not `prom-client`.** They are the same project: `prom-client@15.1.3` is marked deprecated on npm with the message "prom-client has been replaced by @prometheus-io/client", and the successor ships its own type definitions (so no `@types/*` is needed either). Nothing about the decision changes — a scrapeable text endpoint from a small library — but a starter that installs a package npm itself calls deprecated is a starter that hands every fork a Renovate warning on day one.
- **The pool gauges are deferred, with the reason.** postgres.js exposes no public pool-state API: the number of open, idle and waiting connections lives in the driver's internals, and a gauge that reads them would be a metric that silently breaks or starts lying on a driver upgrade — which is worse than an absent one. What the question they answered is answered by instead: `/health/ready` reports whether the database is reachable ([ADR-0016](0016-health-checks.md)), the `statement_timeout` and `idle_in_transaction_session_timeout` of [ADR-0061](0061-database-roles-and-append-only-enforcement.md) §3 bound the pathologies, and `pg_stat_activity` filtered by `application_name` — which `DB_APPLICATION_NAME` exists to make possible — shows the pool from the side that actually knows. The seam is named here so the day postgres.js exposes one, this is where it goes.

Access: a bearer token in `METRICS_TOKEN` when set, and unauthenticated only when it is unset outside production — production refuses an unset token at startup, in the shape [ADR-0004](0004-configuration-and-environment.md)'s other production refinements already use. The body is numbers, but the numbers name every route the API has.

Tracing is deferred with its seam named: OpenTelemetry would instrument the same middleware and the same pool, and it earns its dependency the day there is a collector to send spans to.

### 3. An error-reporting seam on both sides, off by default

In the API: an optional reporter behind `ERROR_REPORTING_DSN`, hooked into the error handler and firing on **5xx only** — a `400`, a `401` or a `409` is the API working. It is given the request id, the route, the status and the principal's kind and id; it is never given the request body, which is where passwords are.

In both SPAs: the same seam behind `VITE_ERROR_REPORTING_DSN`, read by each app's single `import.meta.env` reader (`apps/{admin,customer}/src/shared/config/index.ts`, where a zod schema parses it once and hands out a frozen object) and reaching the top-level error boundary.

No DSN, no reporter and **no dependency loaded**: the adapter arrives through a dynamic import inside the branch, so a deployment that reports nothing does not execute a reporting client. The response envelope does not change in any of this — that is the whole of the delta on [ADR-0013](0013-error-model.md).

**Amended 2026-09-03 (`D14.6`): no vendor SDK enters this repository.** The paragraph above was written as though the dynamic import named `@sentry/node`; it names a **local adapter module** instead — `apps/api/src/core/reporting/log-error-reporter.ts` and `apps/{admin,customer}/src/shared/error-reporting/reporter.ts` — and those three files are the whole of what a fork replaces. Three reasons, and they are the same three §Alternatives gives for shipping a mail *port* rather than a mail *flow*:

1. **A starter must not choose its forks' vendor.** Picking Sentry here is exactly the coupling §1 refuses for SMTP, on a decision that is even more a matter of taste and contract.
2. **It would not be inert.** §Consequences claims three of the four new dependencies do nothing without configuration; a Node error SDK is not one of them — importing `@sentry/node` installs OpenTelemetry instrumentation on the process, which is a cost paid by every deployment that reports nothing.
3. **The browser half has a budget.** [ADR-0052](0052-grid-and-admin-followups.md)'s `size-budget.json` prices every byte in both SPAs, and a browser SDK is a large one to carry for a feature most forks will not turn on.

So the API ships a **log adapter** — one structured `error` line per 5xx carrying exactly the fields enumerated above, tagged `reported`, which is a real behaviour a deployment with a DSN and no SDK gets — and each SPA ships an adapter that does nothing but is the documented place three lines of `init` and `captureException` go. The seam's testable properties are unchanged and are what the step asserts: a 5xx reaches the reporter, a 4xx does not, the body never does, and no DSN means the adapter module is never evaluated.

**Also amended: the browser half's consumer arrives one step later.** The SPAs have no top-level error boundary yet — it is part of `@repo/app-kit` and lands at `D14.8` ([ADR-0062](0062-frontend-build-and-shared-composition.md) §1). `D14.6` ships the configuration, the seam and its tests in both apps; `D14.8` is where the boundary calls it.

### 4. Rate limiting gets a shared store when there is one

When `REDIS_URL` is set, the limiters use `rate-limit-redis`; when it is not, the in-memory store as today. One store is built in the container and passed to all four limiters, so the choice is made once and no limiter can be left behind. A Redis that is configured and unreachable fails the limiter closed rather than open, and says so in the log.

Redis is the first shared-state seam in this repository, and it is deliberately the smallest one: caching, background jobs and the session prune's scheduler are the obvious later tenants, and none of them is decided here. It is external in the reference deployment ([ADR-0059](0059-ci-containers-and-deployment.md) §6).

## Consequences

- D15's invitations, and every credential flow after them, have a mail port to build on instead of a decision to make first.
- An operator can answer error-rate and saturation questions with a scrape, and can be told about a 5xx without reading logs — both optional, both off in a default clone.
- **Amended 2026-09-03 (`D14.6`): three new dependency groups enter `apps/api`, and none enters either SPA.** They are `nodemailer` (with `@types/nodemailer`, which that package does not ship), `@prometheus-io/client` (see §2's amendment on the name), and the Redis pair `ioredis` + `rate-limit-redis`. The fourth — a reporting SDK — is not added, for the reasons in §3's amendment; the SPAs gain a configuration variable and a seam module and no package at all, so both bundle budgets are untouched. Two of the three are inert without configuration: nodemailer is constructed only when `MAIL_TRANSPORT=smtp` and ioredis only when `REDIS_URL` is set. `@prometheus-io/client` is always loaded, because the registry is the endpoint.
  - `ioredis` rather than the official `@redis/client`, and the reason is mechanical rather than a preference: `@redis/client` declares an optional peer on `@opentelemetry/api`, which `drizzle-orm` also declares — so installing it made pnpm resolve **two** `drizzle-orm` instances, one per peer set, and `apps/api` stopped type-checking against `@repo/db`'s tables. `ioredis` has no peer dependencies and ships its own types.
- More configuration surface: every variable above is a three-place change ([ADR-0004](0004-configuration-and-environment.md)) and the production refinements are what keep the defaults from shipping.
- Multi-instance deployment stops multiplying ADR-0020's limits, which removes the caveat that record's §Consequences has carried since D1.
- **Added 2026-09-03 (`D14.6`): a configured Redis becomes a hard availability dependency of the whole API, not of the limiters alone.** §4's "fails closed" is the decision, and this is its blast radius written down: the global limiter is the first thing every `/api/v1` request meets, so a Redis outage refuses all of them, and the client is configured with no offline queue precisely so a command rejects rather than holding a request open until Redis returns. A deployment choosing `REDIS_URL` is choosing that trade — correct limits over availability under a dependency failure — and should give the store the same monitoring as Postgres. The alternative, failing open, would mean an attacker who can reach the store can remove the login limit, which is not a trade this record is willing to make silently.
- **Added at the same head: each limiter gets its own key prefix.** `rate-limit-redis` keys on `prefix + key`, and three of the four limiters key on the address alone, so one store instance shared between them merges the global and refresh counters — five ordinary requests would spend an address's refresh budget, and the refresh limiter's `skipSuccessfulRequests` would decrement the global one. `express-rate-limit` detects the reuse and only logs it, so the collision would have been silent and visible only on the Redis path. The store is therefore built per limiter, named at the composition root, over one connection.
- Still open, and deliberately: tracing, log shipping, a metrics dashboard, and the mail flows themselves.

## Alternatives considered

- **Build the mail flows now.** Reset, verification and email change are three token tables, three limiters and a set of security decisions each — far wider than a hardening deliverable, and the reason the port ships without them.
- **Full OpenTelemetry instead of prom-client.** The heaviest dependency here and useless without a collector; `/metrics` is scrapeable by anything and costs one endpoint. Deferred with the seam named.
- **A Postgres-backed rate-limit store.** No new infrastructure, at the price of a write on every request to `/api` — the hot path, for a counter. Rejected.
- **No mail port at all until a flow needs one.** Every fork then invents its own, and the invitation flow arrives coupled to whichever SMTP client its author reached for. Rejected: the port is small and the coupling it prevents is not.
- **Metrics inside `/health`.** Conflates an orchestrator's probe with an operator's scrape, and would put an unbounded body behind an endpoint that must stay cheap. Rejected.
- **Reporting every error, not only 5xx.** Buries the crashes under validation failures and ships user input to a third party. Rejected.
