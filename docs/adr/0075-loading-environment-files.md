# ADR-0075: Loading environment files — Node's own loader, nothing in the image that loads one, the readers beside the application (supersedes ADR-0004 in part — a delta)

- Status: accepted
- Date: 2026-09-29
- Supersedes: [ADR-0004](0004-configuration-and-environment.md) as carried by [ADR-0059](0059-ci-containers-and-deployment.md) (delta: how the database tooling loads the root `.env`, why and how no loader package ships in production, which processes outside `core/config` may read the environment — a predicate in place of the list its amendments kept — and that `@repo/db`'s CLI tooling may default an unset `NODE_ENV` while the API may not). ADR-0004 stands for everything not named here.

> Written 2026-09-29 for D21 ([`docs/plan/0021-stack-majors.md`](../plan/0021-stack-majors.md)), after `D21.4` and over what that step built — so it belongs to `D21.4` and is **accepted at writing**: the tree already carries every delta below, and a record whose building step has passed has no head left to gate (the 0068/0069 shape, written and accepted at once). [ADR-0004](0004-configuration-and-environment.md) moved to `superseded by` in the same change, because the delta is already true (the `D10.5` precedent read from the far side: a parent is marked superseded when the tree carries the delta, not before). Joins D21's window; amendable in place, labelled, while D21 is `in progress`.
## Context

ADR-0004 decides that local development loads variables from the root `.env` and production injects them, and says of loading: `drizzle.config.ts` and the seed scripts "load the same file with `dotenv`. No `dotenv` in production builds." Its step-6 amendment made `packages/db/src/tooling/env.ts` the one loader in `@repo/db` and credited that choice with keeping `dotenv` "off the library surface".

The library surface was never what reached production. Since `D14.3`, `@repo/db` builds `dist/migrate.js` — and since `D20.5` `dist/prune-sessions.js` — by inlining their whole closure ([ADR-0059](0059-ci-containers-and-deployment.md) §5, [ADR-0073](0073-review-hardening.md) §3), and both run `tooling/env.ts`; `apps/api/Dockerfile` copies them into the image's `dist/`. So `dotenv` shipped in the API image from `D14.3` until `D21.4` while the record said it did not, and nothing checked. `D21.4` removed it, on the operator's decision to drop the package from `@repo/db` rather than narrow the check to the server bundle. The record still names the old loader and the wrong reason.

Separately, ADR-0004 kept a list of the processes allowed to read `process.env` outside `core/config`, adding a name at each amendment, and step 10 said that naming them was the point. Since then the browser tier and its reference-shot script load the root `.env` and read seed credentials in the same way, and they were never added to the list. The list is out of date in the way ADR-0050's altitude rule predicts for an enumeration.

## Decision

### 1. Env files are loaded by Node's own loader

Code that could end up in a production artefact loads an env file only with Node's built-in loader: `--env-file` on a command line (`apps/api`'s `dev` script, unchanged), and `process.loadEnvFile` in code.

```ts
// packages/db/src/tooling/env.ts — still the one loader in @repo/db (ADR-0004)
export const loadEnvFile = (path = resolve(repoRoot, ".env")): void => {
  if (loaded) return;
  // No file → nothing, and no throw: a deployed image has none.
  if (existsSync(path)) process.loadEnvFile(path);
  loaded = true;
};
```

Two properties are part of the decision, and `packages/db/src/__tests__/env.test.ts` proves both:

- **A value already in the environment wins.** The file only fills gaps. This is what lets `DATABASE_URL=… pnpm db:migrate` target another database, and what lets a deployed job run with injected variables.
- **A missing file is skipped, not an error.** Node's loader throws on a missing file, and a deployed image has no `.env`.

A **test harness** that has to _override_ the environment may use a loader package as a **development dependency**. `apps/api/test/setup/env.ts` does this: it loads `apps/api/.env.test` over whatever the shell exported, which is ADR-0004's step-7 rule that `.env.test` wins for the test run.

### 2. Nothing the image carries contains a loader package

ADR-0004's "No `dotenv` in production builds" now means: **no file under the API image's `dist/` contains an env-file loader package.** That covers the server bundle and every bundle `apps/api/Dockerfile` copies in beside it. The reason is the one the Context gives: a bundle that inlines its closure ships whatever its tooling imports, however the library surface is kept. The library-surface property keeps what it actually provides: `import '@repo/db'` reads no environment and no file.

`scripts/docs-hygiene.test.mjs` "the API image's dist/ carries no dotenv" enforces this. It finds the bundles by reading the Dockerfile's copy lines, builds each one into a scratch directory, and reads what would ship. It checks for `dotenv`, the only loader package this tree has used. A fork that adopts a different loader package widens that check in the same change.

### 3. Who reads the environment outside `core/config`: a predicate, not a list

- **In an application's source** (`apps/api/src`), only `core/config` reads the environment. **In `@repo/db`**, only `src/tooling/env.ts` does. Lint enforces both, as before ([ADR-0002](0002-monorepo-layout-and-tooling.md) §Lint rules).
- **Beside the application**, a process may read the variables it needs directly. That means test harnesses, the browser tier, repository scripts and an image's health probe. Such a process may load the root `.env` under §1's two properties, or load its own committed test file. It validates nothing and only passes values on to a check that fails visibly when they are wrong. A process that grows a real configuration surface goes behind a schema. This is ADR-0004's step-10 rule for `scripts/`, now applied to every process in this group.

The SPAs' `import.meta.env` is not covered here. It is governed by [ADR-0033](0033-browser-api-client-and-session.md) §Configuration as carried, and by ADR-0059 §4's build arguments.

### 4. The database tooling may default an unset `NODE_ENV`; the API may not

`@repo/db`'s CLI tooling reads `NODE_ENV` through `readNodeEnv()` in `tooling/env.ts`, and it may treat an unset `NODE_ENV` as `development`. That covers `db:seed`, `db:reset` and `db:sessions:prune`, plus `isProduction()` behind the reset refusal, the `--dev` refusal, the committed-seed-password refusal and the `@repo/db/testing` helpers. The API keeps ADR-0004's step-7 rule unchanged: its config schema requires `NODE_ENV` and has no default.

The two differ because they run in different places. The tooling runs from a developer's bare shell through `pnpm db:*`, where requiring the variable would add a step to every local command. In production, every process that runs the tooling runs from the API image. `apps/api/Dockerfile`'s runtime stage sets `ENV NODE_ENV=production`, and `docker/prod/compose.yaml` sets it again on `migrate`, `api` and `prune`. So the bundled `dist/migrate.js` and `dist/prune-sessions.js` never reach the default.

**No guard refuses an unset `NODE_ENV`.** If a production database is targeted from a shell that forgot the variable, the run is treated as development: `db:reset` runs, `--dev` fixtures seed, and a committed seed password is accepted. What stands in the way is weaker, and it is all this record claims:

- `db:seed`, `db:reset` and `db:sessions:prune` print the target (`host:port/database`) and the `NODE_ENV` they resolved before they act.
- Every DDL-capable entry point requires `DATABASE_URL_OWNER` with no fallback ([ADR-0061](0061-database-roles-and-append-only-enforcement.md) §1), so reaching a production database from a shell means stating its owner credential explicitly.
- `migrateFreshDatabase` also refuses any database whose name does not end in `_test` ([ADR-0008](0008-database-migrations-and-seeding.md)).

This is an accepted residual risk. Closing it means requiring `NODE_ENV` in the tooling too, and that needs a record of its own.

**Carried unchanged by reference.** Everything else in ADR-0004 (as carried by ADR-0059) stands and is in force as part of this record: the zod schema validated once at startup, fail-fast with keys and never values, `NODE_ENV` with no default in the API, the known-public enumerations, the three-place change for a new variable, the file layout and `.env.test`'s precedence, what the harness derives and overwrites, `z.stringbool()`, the Turbo declarations, and ADR-0059 §7's `TRUST_PROXY`.

## Consequences

- The migrate and prune bundles no longer carry a loader. A deployed job's variables are exactly what the platform injected, because no file can fill them in.
- The rule about what the image carries is now checked by a test. Before, it was a sentence that stayed wrong from `D14.3` to `D21.4`.
- `dotenv` remains in the tree only as the API's development dependency, used by the test harness.
- A new reader beside the application no longer needs an amendment to be allowed. It needs to fit §3's predicate.
- The tooling's `NODE_ENV` default is a recorded decision, not an unexplained difference from the API (§4). A production run from a shell that forgets `NODE_ENV` is still treated as development, and the printed target is what warns the operator. That risk is accepted, not closed.

## Alternatives considered

- **Keep `dotenv` in `@repo/db` and check only the server bundle.** Rejected by the operator at `D21.4`. The check would then pass while the image still shipped the package in two of its three bundles.
- **Mark `dotenv` external in `packages/db/tsdown.config.ts`.** The bundle would then import a package that the deployed tree for `apps/api` does not resolve. That is the failure the inline-everything rule exists to prevent.
- **Add the browser tier and the reference-shot script to ADR-0004's list.** This would fix today's gap and bring the same drift back with the next reader. ADR-0050 asks for a predicate.
