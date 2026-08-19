# ADR-0036: Admin app testing strategy — Vitest, Testing Library and MSW

- Status: accepted
- Date: 2026-08-19

> Written at the opening of D3. `D3.3` lands the infrastructure — the setup file, the MSW server, the render helper — and the suites themselves accrue in every step after it, the way the API's did under [ADR-0021](0021-testing-strategy.md). It stays amendable in place while D3 is `in progress` ([ADR-0025](0025-deliverables.md) rule 2).
>
> This ADR sits **beside** ADR-0021, not over it. ADR-0021's pyramid is titled "Test pyramid for the API" and decides nothing about a frontend; [ADR-0022](0022-frontend-apps.md) §Consequences explicitly deferred frontend architecture — testing included — to "dedicated ADRs when those apps are built out". So this adds a decision an earlier ADR declined to make, exactly as [ADR-0029](0029-browser-token-transport.md) did for ADR-0018 §Token transport, and under [ADR-0024](0024-adr-lifecycle.md) rule 1 **no supersession is required**. ADR-0021 remains the API's testing strategy, frozen with D1, untouched.

## Context

`apps/admin` already has test scripts, and they are a confession: `test` and `test:unit` are both `vitest run --passWithNoTests` — a task that exists so the repo-wide gate could run before the app did, and that passes by containing nothing. D3 replaces the placeholder app with a real one, and the sibling ADRs of this window define machinery that is exactly the kind that rots silently without tests:

- **[ADR-0033](0033-browser-api-client-and-session.md)** — the API client and session flow: response interceptors that unwrap the [ADR-0012](0012-response-envelope.md) envelope, the CSRF header, the single-flight refresh on `401`, the bootstrap sequence, the terminal codes that end a session. Every one of these is a behaviour of the *client's plumbing*, invisible in any component and wrong in ways that only show up as a user logged out on a Tuesday.
- **[ADR-0034](0034-server-state-and-notifications.md)** — query key factories and meta-driven toast dispatch: conventions whose value is that they hold *everywhere*, which is precisely what a per-feature manual check cannot establish.
- **[ADR-0035](0035-config-driven-resource-ui.md)** — the registry/config machinery: `AppFormInput` mapping a field name to a component and its props, the submit lock, server field errors landing on the right field. Generic code multiplied across every form in the app; a bug here is a bug in all of them.

ADR-0021's machinery has no analogue for any of this. Its unit tier is fake repositories behind service interfaces; its integration tier is `supertest` against a real Postgres. A frontend's "repository" is the HTTP API itself, and the question this ADR must answer is where to cut the fake: too high (mock the client's methods) and the plumbing under test is replaced by the mock; too low (a live API) and the suite inherits a database, a seed orchestration, and everything [ADR-0026](0026-task-graph-caching-and-serialisation.md) forced the API's `test` task to give up.

The forces, then: which runtime; where the API fake lives and what keeps it honest; which suites are non-negotiable; and what the repo-wide gate means for a package whose tests need no database.

## Decision

### One tier in D3: Vitest, React Testing Library, jsdom

**The admin app's D3 test surface is unit and component tests — Vitest with the `@repo/vitest-config` react base, React Testing Library, jsdom.** There is **no integration tier against a live API in this deliverable**: `test:unit` and `test` run the same suite, and `test:int` does not exist for this package. That is not a gap to be quietly filled later — the end-to-end tier is explicitly deferred, with its reasons, in §What is deferred below.

Under ADR-0026's rule the suite is **cacheable**: it is a pure function of the repository contents. Nothing opens a socket — MSW intercepts in-process before any network — and nothing reads a database. One variable needs handling rather than hand-waving: the ADR-0033 client reads `VITE_API_URL`, and a value drawn from the gitignored `.env` or the ambient environment would be invisible to Turbo's hash — the pre-D2.1 cache-lie class. So **the harness pins a fixed value inside the repository** (the vitest config's `env` sets `VITE_API_URL` to a constant test origin), the suite consumes nothing outside the tree, and the pure-function claim holds; with that pin, **no `turbo.json` change is needed for the test tasks**. The `build` task, which inlines the variable, is the one that declares it — ADR-0033 records that edit. `test:unit` is already a cached task and admin's suite joins it; `test` is `cache: false` at the root because the *API's* `test` composes an integration tier, and admin's suite re-running uncached under that shared task name costs seconds in the safe direction — an uncached run of a cacheable suite is waste, where the reverse (the pre-D2.1 state) was a lie. The asymmetry is the rule working, not a conflict: "does the result depend on anything outside the tree?" is asked per package and gets different answers for `api` and `admin`, and both answers are correct.

**`--passWithNoTests` dies with the first real test file.** The flag's only purpose was to let an empty package pass the gate; once tests exist it is a hazard — a typo in an include pattern, or a rename that orphans every `__tests__` directory, becomes a green run that executed nothing. `D3.3` removes it from both scripts.

The infrastructure `D3.3` adds (dev-dependencies: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`; `jsdom` is already present):

```
apps/admin/src/
├── test/
│   ├── setup.ts              # jest-dom matchers; MSW lifecycle: listen / resetHandlers / close
│   ├── render.tsx            # renderWithProviders(ui, options) — QueryClient, router, session provider
│   └── msw/
│       ├── server.ts         # setupServer(...defaultHandlers) via msw/node
│       └── handlers/         # per-feature, built from @repo/contracts
│           ├── envelope.ts   # ok / listOk / fail — envelope builders typed against contracts
│           ├── auth.handlers.ts
│           ├── staff.handlers.ts
│           └── users.handlers.ts
└── features/<feature>/__tests__/   # component tests live with the feature they test
```

Everything is functional per [ADR-0009](0009-api-modular-layering.md)'s house style: handler modules export `create<Feature>Handlers(state)` returning an `as const` array; no classes, no shared mutable module state — a test that needs a scripted scenario builds its own handlers and `server.use(...)`es them, and `resetHandlers()` between tests puts the defaults back.

### The load-bearing rule: MSW at the HTTP boundary, handlers derived from contracts

**API mocking is MSW (`msw/node` in tests), intercepting at the HTTP boundary — and the handlers are built from `@repo/contracts`, so a mock that drifts from the contract fails loudly instead of lying.** This is the rule the rest of the ADR hangs off, and it has two halves.

**The boundary half:** intercepting at HTTP means the *real* ADR-0033 client runs in every test — its interceptors, its envelope unwrap, its CSRF header attachment, its single-flight refresh-and-retry. Those behaviours are the most valuable thing the suite can cover and the easiest thing a higher-level mock silently replaces. A test that stubs `client.get` proves the component calls a stub; a test that answers the wire proves the whole column from component to `fetch` boundary.

**The honesty half:** an MSW handler is a second implementation of an endpoint, and a hand-written one decays into describing the API the frontend wishes it had. The defence is that handlers do not hand-write shapes — they **zod-parse request bodies with the contract schemas and answer with envelope-shaped responses built from contracts types**:

```ts
// test/msw/handlers/auth.handlers.ts
import { loginBody, type AuthResource } from "@repo/contracts";
import { fail, ok } from "./envelope.js";

export const createAuthHandlers = (state: AuthMockState) =>
  [
    http.post(`${API}/api/v1/admin/auth/login`, async ({ request }) => {
      const body = loginBody.parse(await request.json()); // request drift → thrown, test fails
      if (body.email !== state.principal.email) {
        return fail(401, "AUTH_INVALID_CREDENTIALS");
      }
      return ok<AuthResource>({ ...state.tokens, principal: state.principal }); // response drift → type error
    }),
  ] as const;
```

`fail` builds an `ErrorEnvelope` whose `code` is typed against the contracts error-code union, and `ok` / `listOk` are typed against `SuccessEnvelope<T>` / `ListEnvelope<T>` — the same interfaces `packages/contracts/src/envelope.ts` says exist "for clients that validate what they receive". When a contract changes, the handler stops compiling or stops parsing; either way the suite reports the drift instead of certifying against a fiction. This is the discipline that makes a mock-backed suite worth having, and it is a **rule, not a convention**: a handler that builds a response by object literal without the envelope builders, or reads a body without the schema, is wrong even when it passes.

### What must be covered

The named suites, in the order D3's steps produce their subjects:

1. **The session and bootstrap flow (ADR-0033).** Bootstrap: CSRF fetch → refresh → session established, and the cold-start path where the refresh answers `401` and the app lands on login. In-flight: a `401` on any request triggers **one** refresh shared by every concurrent caller (single-flight — assert the refresh handler was hit once under parallel requests) and each caller retries **once**; a second `401` after retry, or any of ADR-0033's terminal codes (`AUTH_REFRESH_REUSED`, `AUTH_SESSION_REVOKED`, `AUTH_ACCOUNT_DISABLED`, `CSRF_TOKEN_INVALID` — ADR-0033 §Boot is the canonical list), ends in the logged-out state, not a retry loop. MSW can script every one of these — a handler that fails once then succeeds, a handler that counts its calls — which is exactly why the mock lives at the HTTP boundary.
2. **The ADR-0035 machinery.** Registry resolution and config typing (unit tests, no DOM needed); `AppFormInput` mapping `fieldName → component → props` for each registered field kind; the submit lock disabling every rendered field while a mutation is pending; a server error envelope with field-level `details` landing on the correct field via `setError` — and unmatched details falling through to the form-level message rather than vanishing.
3. **The ADR-0034 conventions.** Query key factories (shape, hierarchy, invalidation targets); the meta-driven toast dispatch, asserted **once at the global handler**, which is the point of putting behaviour in a global handler — one test stands in for a per-mutation assertion in every feature.
4. **Component tests per feature.** The login form; the staff and users tables and their CRUD dialogs — written user-centric: render through `renderWithProviders`, drive with `user-event`, assert what a user sees. Every later D3 step that adds a feature adds its component tests in the same step, not in a sweep at the end.

**Testing Library discipline:** query by role and accessible name (`getByRole`, `getByLabelText`); a `data-testid` is permitted only where no role or label exists and adding one would be artificial; **no snapshot-first testing** — snapshots are reserved for tiny, stable primitives, if used at all, because a snapshot asserts "unchanged", not "correct", and a thousand-line one trains people to press update. The role/label rule is also a minimal accessibility check that costs nothing extra: a control the suite cannot query is a control a screen reader cannot name, and the failing test says so before an audit does.

### What is deferred, and to where

Two tiers are deliberately **not** built in D3. Both belong on the ADR index's _Planned_ list, so the deferral is findable rather than folklore:

- **True end-to-end browser tests (Playwright).** They need a running API, a database, seed orchestration for test accounts, and a browser matrix — a standing infrastructure with its own CI shape and its own cost curve, none of which D3 needs to ship an admin panel. That is a separate decision with a separate ADR, and bolting a thin version onto D3 would produce the worst of both: a slow suite too small to catch what only e2e catches.
- **Contract-conformance tests against the real API.** ADR-0021 already places OpenAPI/conformance in its "later" row, and the Postman collection remains the executable documentation of the API — unchanged by this ADR. Running the admin suite against a live API would duplicate the API's own integration tier from the wrong side of the wire.

D3's substitute for both is stated honestly: the contracts-derived strictness of the MSW handlers (drift fails the suite) plus the manual acceptance checklist in D3's plan, which walks the built app against the real API the way ADR-0021's checklist walked Postman against the built bundle.

### The gate

**`pnpm lint && pnpm check-types && pnpm test` stays the gate, repo-wide, with no fourth command.** Admin's suite joins `test` and runs on every gate invocation; it needs no Docker and no `.env`, so the gate's prerequisites do not grow. The fast loop stays `pnpm test:unit` — cached, parallel, and now covering the admin app's entire D3 surface, since for this package the two tiers are one.

## Consequences

- **MSW handler maintenance is the price of not running a server.** Every endpoint the admin app consumes gets a handler, and handlers are code that can rot. The bound on that rot is §The load-bearing rule: derivation from contracts turns silent drift into a compile error or a parse failure, which converts an unbounded honesty problem into a bounded typing chore.
- **The whole admin suite lives in the cached fast loop.** Component tests in jsdom are fast enough that `pnpm test:unit` stays the loop a contributor runs on every save, admin included — which is what keeps the tests written. The gate re-runs them uncached under the shared `test` task; seconds, and in the safe direction.
- **jsdom fidelity is a known ceiling.** No real layout, no real navigation, a polyfilled `fetch` boundary. The suites above are chosen to sit below that ceiling; if a future feature needs what jsdom cannot fake, Vitest browser mode is the recorded escape hatch (§Alternatives) before Playwright component testing is.
- **The deferred Playwright decision is written down where it will be found** — the index's _Planned_ list — with its real costs attached, so the day it is wanted it starts as an ADR and not as a `devDependency` in a Friday PR.
- **The `test-engineer` agent gains a frontend playbook.** Until now its instructions could only encode ADR-0021's API pyramid; once this ADR is accepted, "which tier, which boundary, which queries" has one answer for the admin app too.
- **`web` is not covered.** This ADR is written against the admin app because D3 is; the runtime, the MSW rule and the Testing Library discipline are app-agnostic and `apps/web` should adopt them when its deliverable opens, but a Next.js app has server-side surfaces this ADR has not examined, so that adoption is a check, not an assumption.

## Alternatives considered

- **Cypress or Playwright component testing.** A real browser per component test buys fidelity jsdom lacks, at the cost of a heavier runtime, a slower loop and a second test framework in the repo — for suites that RTL + jsdom covers. If jsdom fidelity bites, the first step is **Vitest browser mode** (same runner, same tests, a real browser), not a framework migration; that option is noted here so it is reached for in order.
- **Mock at the axios-adapter level instead of MSW.** Simpler — no service worker library, just an injected adapter — and it cuts the fake in above the interceptors, so the CSRF header, the envelope unwrap and the single-flight refresh are exactly what stops being tested. The plumbing is the point; the adapter mock skips the plumbing.
- **Hit the real API from vitest.** Maximum honesty, and it needs the whole stack up for a frontend unit run, makes the task uncacheable under ADR-0026, serialises it against the API's own suites on the shared test database, and duplicates coverage the API's integration tier already owns. That honesty is bought once, in the deferred e2e tier, where it pays for itself.
- **No dedicated frontend testing ADR — stretch ADR-0021 to cover it.** ADR-0021 is frozen with D1, so stretching it means superseding it in full to add a surface it never claimed; and its actual machinery — fake repositories, `supertest`, a rebuilt Postgres — has no frontend analogue, so the supersession would restate everything to share nothing. A sibling ADR, cross-referenced both ways, is the shape ADR-0029 already established for exactly this situation.
