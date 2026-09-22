# ADR-0026: Turborepo task graph: what may be cached and what must be serialised

- Status: superseded by [ADR-0052](0052-grid-and-admin-followups.md) (delta: the documented gate grows a fourth link), [ADR-0073](0073-review-hardening.md) (delta: `pnpm check` and the gate's first link run the repo-level script tests and `docs:check`, through the task graph rather than as links of their own) and [ADR-0074](0074-review-follow-ups.md) (delta: a cached task's hash covers every workspace whose source it runs — `test:unit` reaches its workspace dependencies through turbo's `transit` node; §The rule's purity and every other row of the task table stand)
- Date: 2026-08-18

## Context

[ADR-0002](0002-monorepo-layout-and-tooling.md) §Toolchain versions names the Turborepo tasks — `build`, `dev`, `lint`, `check-types`, `test`, plus the `db:*` family, "non-cached, see ADR-0008". [ADR-0021](0021-testing-strategy.md) §Runner names the test scripts: `test` (all), `test:unit`, `test:int` (requires DB), `test:watch`, and its acceptance checklist step 5 asks for "`pnpm test` green (unit + integration)".

Between them they say what the tasks are called and, for `db:*` alone, whether a result may be reused. For everything else, cacheability was left to whatever `turbo.json` happened to say. What it says is that `test` is cacheable and declares no `env`.

That is not a small oversight, because `apps/api`'s `test` script is `vitest run && vitest run --config vitest.int.config.ts` — unit **and** integration, as ADR-0021 requires. So the task Turborepo is caching includes a suite whose result depends on a Postgres instance, a schema rebuild, and a `DATABASE_URL_TEST` that is not part of the hash. A `pnpm test` run on 2026-08-18 reported `Cached: 6 cached, 8 total` with `api:test` among the six: the gate that `CLAUDE.md` prescribes, and that every D1 step closed on, replayed a green for an integration suite that never opened a connection.

Three further inconsistencies sit under the same missing decision:

- **`test` means two things.** In `apps/api` it is unit + integration. In `@repo/db` it is `vitest run` — unit only — while that package has a `vitest.int.config.ts` with three integration files behind `test:int`. One task name, two contracts, and `turbo run test` therefore covers `@repo/db`'s integration suite in neither the cached nor the uncached case.
- **The serialisation rule is attached to the wrong task.** ADR-0021's step-8 amendment established that the root `test:int` runs with `--concurrency=1`, because `@repo/db` and `api` both point `globalSetup` at `DATABASE_URL_TEST` and both rebuild it — run in parallel, one suite drops the schema while the other is mid-run. The root `test` script has no such flag. Today that is hidden by `@repo/db`'s `test` not running its integration files; fixing that inconsistency without fixing this one would produce exactly the race the amendment describes.
- **`turbo.json` still declares no `env` or `globalEnv` anywhere.** ADR-0004 §Turbo requires it for build-affecting variables, and D1.5's review recorded the gap as a hand-off to D1.7 with the note that it "becomes one the moment `core/config` exists". `core/config` exists. Only `apps/api/turbo.json` declares anything, on `test:int`.

The general shape is that this repository decided *what the tasks are* and never decided *what makes a task's result reusable*. Cacheability is not a per-task preference; it follows from one property, and stating that property once is cheaper than arguing it per task forever.

This decision also has a deadline attached to it that nothing else does: CI is a planned ADR, and a pipeline is the machine that turns "the gate is cacheable" from a local annoyance into a green build that tested nothing.

## Decision

### The rule

**A task result may be cached if and only if it is a pure function of the repository contents and the declared environment.** A task that reads or writes state outside the working tree — a database, a container, a network, a clock that matters — sets `cache: false`. There is no middle option and no "cache it and remember to `--force`".

**A task that reads an environment variable declares it in `env` (or `globalEnv` when it affects every task).** Turborepo 2 runs in strict env mode, so an undeclared variable is also an absent one; declaring it is simultaneously what makes the task work and what puts the value in the hash. A variable that is read from a file the task opens itself (`apps/api/.env.test`, loaded by the vitest harness) is not an environment variable for this purpose — the file is repository content and is already hashed.

**A task that contends for a shared external resource runs with `--concurrency=1`, and the flag lives in the root `package.json` script, not in the caller's memory.**

### The task table

| Task           | Cached | `env`                             | Concurrency | Notes                                                                            |
| -------------- | ------ | --------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `build`        | yes    | build-affecting vars              | parallel    | `.env*` already in `inputs`                                                       |
| `lint`         | yes    | —                                 | parallel    |                                                                                    |
| `check-types`  | yes    | —                                 | parallel    |                                                                                    |
| `test:unit`    | yes    | —                                 | parallel    | The fast loop. No database, no network.                                            |
| `test:int`     | **no** | `DATABASE_URL`, `DATABASE_URL_TEST` | **1**       | Rebuilds `machxi_test` (ADR-0021).                                                 |
| `test`         | **no** | as `test:int`                     | **1**       | Unit + integration per ADR-0021 §Runner, so it inherits `test:int`'s constraints.  |
| `test:watch`   | no     | —                                 | persistent  |                                                                                    |
| `dev`          | no     | —                                 | persistent  |                                                                                    |
| `db:*`         | no     | `DATABASE_URL`                    | parallel    | ADR-0008.                                                                          |

`test` is the composition of the two tiers below it, so it takes the stricter of their properties on both axes. That is the whole derivation: nothing about `test` is decided independently of what ADR-0021 put in it.

### What follows for the scripts

- **`@repo/db`'s `test` script runs its integration suite**, like `apps/api`'s does. ADR-0021 §Runner defines `test` as "all"; a package that has integration files and excludes them from `test` is not implementing that.
- **The root `test` script carries `--concurrency=1`**, for the reason ADR-0021's step-8 amendment gives for `test:int`. Once both packages' `test` includes integration, both rebuild `DATABASE_URL_TEST`, and the race the amendment describes is reachable from the gate.
- **The documented gate stays `pnpm lint && pnpm check-types && pnpm test`.** It does not grow a fourth command. `test` already means unit + integration, and the fix is to make that true rather than to work around its being false.

### The fast loop

`pnpm test:unit` is the loop to run while writing code: cached, parallel, no Docker. `pnpm test` is the gate, and it is slower on purpose — it is serial, it is never cached, and it needs Postgres up. A contributor who wants speed reaches for `test:unit`; the one command that must never lie is the one whose name has no qualifier on it.

## Consequences

- `pnpm test` stops being cacheable, so a green from it is always a run that happened. That is the point, and it costs the unit tiers their cache on the gate path — recovered by `test:unit`, which is where the fast loop belongs anyway.
- `pnpm test` becomes serial across packages and therefore slower than it looks today. It is measurably slower than a lie, which is the comparison that matters.

  **Amended 2026-08-18 (D2.1).** The measurement, now that it exists: `pnpm test` runs 50s–1m48s cold, against a former ~1.3s warm-cache "pass" that executed nothing. `pnpm test:unit` stays fully cached and returns in about a second on a second run, so the fast loop is unaffected. The spread in the gate's own timing is the serialisation — whichever suite Turbo starts first no longer overlaps the others.

  Three things the implementation settled that this ADR did not spell out:

  - **The `env` declarations live at the root only.** `apps/api/turbo.json` had declared `test:int`'s `env` since D1; once the root declares it for both `test` and `test:int`, the package-level copy is the same list in a second place, so it was removed. One declaration, in the file that states the rule.
  - **`.env` is not added to either task's `inputs`.** `@repo/db`'s integration suite reads `DATABASE_URL_TEST` from the git-ignored root `.env` rather than from a committed file, so it is neither repository content nor hashed. That would matter if the task were cached; both DB-touching tasks are `cache: false`, so it does not. The rule above is what makes this a non-question rather than an oversight.
  - **The `db:*` row was under-specified here, and the gap was not cosmetic.** The table below says `DATABASE_URL`; the tasks actually declare `["DATABASE_URL", "ARGON2_*", "SEED_SUPER_ADMIN_*"]`, which is what `packages/db/src/tooling/env.ts` reads. The general rule at the top of §The rule was already right — "a task that reads an environment variable declares it in `env`" — and the table simply did not enumerate it.

    What made this worth finding rather than tidying: **turbo runs in strict env mode, so an undeclared variable is a silently stripped one.** `DATABASE_URL=… pnpm db:migrate` — the usage `tooling/env.ts` documents in its own comment, and the one an operator reaches for to point a migration at a database that is not the one in `.env` — did not override anything. Turbo dropped the variable, dotenv supplied the local value, and the task migrated the developer's own database while reporting success. Verified before and after: with a bogus URL the task now prints `db:migrate → 127.0.0.1:59999/nope` and exits non-zero, where before it printed `up to date` against the real database.

    The general lesson is the one worth keeping: under strict env mode, an undeclared variable does not fail loudly, it defaults quietly. That makes "declare what you read" a correctness rule for every uncached task, not only a hashing rule for cached ones.
- CI can be written against these tasks without a special case: cache `test:unit`, `lint`, `check-types` and `build`; never cache `test` or `test:int`; provide Postgres for the latter two.
- The `env` declarations close the D1.5 hand-off that ADR-0004 §Turbo has been owed since `core/config` landed.
- A future task is a decision only about the rule above, not about caching in general. "Does its result depend on anything outside the tree?" is the whole question.
- Adding a second test database, so that `@repo/db` and `api` could run integration in parallel, stays available and stays rejected for the reason ADR-0021 gave: it buys parallelism the suites do not need and adds a variable to every environment.

## Alternatives considered

- **Redefine `test` as unit-only and require `pnpm test:int` separately.** Faster and cacheable, and a change of mind about ADR-0021 §Runner and its acceptance checklist — which under ADR-0024 rule 1 would mean superseding ADR-0021 in full, restating the pyramid, the Postman section and both amendments, to change one line. It also makes the unqualified command the weaker one, so the gate people type from memory is the one that skips the tier where SQL bugs live.
- **Keep `test` cached and require `--force` in CI.** Puts correctness in a flag somebody has to remember, in the one place nobody watches a run.
- **Declare `DATABASE_URL_TEST` in `env` and keep the cache.** Makes the hash honest about the URL and still wrong about the database behind it: the same URL points at different contents before and after a migration, a seed or another suite.
- **Give integration tests their own Postgres per package via Testcontainers.** Removes the contention this ADR serialises around. ADR-0021 already parked it as "adopt later if the shared compose test DB becomes a bottleneck", and a `--concurrency=1` on two suites is not that bottleneck.
