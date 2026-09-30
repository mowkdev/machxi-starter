# D32 — Build versions: build notes

The per-step build record of [D32](0032-build-versions.md). It holds what was built, the amendments, the review findings and their fates, the gate's output, and what is pending the operator. It is kept apart from the executable plan so that a builder opens the plan and not the journal ([ADR-0068](../adr/0068-behaviour-specs-and-plan-notes.md) §2, the plan apart from its notes). `/step` appends here; `/ship` and the close-out read it.

## D32.1 — Accept ADR-0081; the API's version (2026-09-30)

**Head: [ADR-0081](../adr/0081-build-versions.md) accepted.** [ADR-0004](../adr/0004-configuration-and-environment.md) and [ADR-0016](../adr/0016-health-checks.md) moved to `superseded by` 0081, each with a status delta and a header blockquote. The index rows of all three, the topic table's configuration and health rows, and the ledger's window paragraph say so. [ADR-0054](../adr/0054-design-language-instrument.md) and [ADR-0065](../adr/0065-starter-lifecycle.md) stay put until `D32.2` and `D32.3`. No record amended.

**The lane.** `lane/D32` was cut from `main` at `f9fe32f` and checked out at `.claude/worktrees/lane-D32`, with its own `pnpm install`. **The `.env` files were not copied in**: this session's permissions refuse both reading and copying `.env`. The API's integration tier does not need them (it loads the committed `apps/api/.env.test`), but `@repo/db`'s does: its six integration files failed on `DATABASE_URL_TEST_OWNER is not set`. The gate was therefore run with `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` exported from their committed values, which `.env.example` and `apps/api/.env.test` both state as the shared `machxi_test`. **Pending the operator:** copy `.env`, `apps/admin/.env` and `apps/customer/.env` into the worktree before `D32.2`, whose SPA builds may read them.

**Built.**

- `core/config`: `APP_VERSION` defaults to `dev`, and a blank value is unset; `GIT_SHA` goes through `optionalEnv`, so a blank one is absent and `/health` omits `commit`. Cases "APP_VERSION defaults to dev" and "an empty GIT_SHA is absent" in `config.test.ts`; the defaults case now expects `dev`.
- `apps/api/Dockerfile`: `ARG APP_VERSION` and `ARG GIT_SHA` promoted to `ENV` in the runtime stage, after the `COPY`, so a new label rebuilds two metadata layers and never the fetch, install or bundle.
- `docker/prod/compose.yaml`: both are build arguments on the shared `x-api-image` anchor (`${APP_VERSION:-}`, `${GIT_SHA:-}`), and gone from the `api` service's `environment`.
- The root `.env.example` leaves both commented and says why. `docker/prod/.env.example` says they are build arguments, derived from git in the building shell. `docs/deploy.md` gains one fact-list bullet with the two git commands.
- `docs/specs/health-and-metrics.md`: a requirement, "The version and the commit are the image's", with two scenarios. `health.int.test.ts` gains "the build's version and commit", proving both at the wire.
- `scripts/rules-digest.mjs`: a "Build versions" line in API and data, citing 0081, 0004 and 0016. `pnpm rules:digest` wrote 1 of 3. The frontend and process digests gain 0081's lines when `D32.2` and `D32.3` make those deltas true.
- **Outside the step, and why.** `scripts/docs-hygiene.test.mjs` "every service in the reference deployment states its limits and a bounded log" failed on `main` in this Windows checkout. `core.autocrlf=true` checks `compose.yaml` out as CRLF, and the case's patterns are written against `\n`; `D29.5` was built in a Linux container, where it passed. The case now normalises line endings before matching. No record changes.

**Done-whens.**

- `pnpm test --filter api` green: 816 unit, including the two new config cases, and the integration tier, `health.int.test.ts` still asserting the configured version.
- `docker build -f apps/api/Dockerfile --build-arg APP_VERSION=9.9.9 --build-arg GIT_SHA=0123456789abcdef -t machxi-d32-api .` then `docker run --rm machxi-d32-api node -e "…"` printed `9.9.9 0123456789abcdef`. An image built with neither argument carries `["",""]`, which the schema reads as `dev` and no commit.
- `docker compose -f docker/prod/compose.yaml config` rendered; the `api` service's `environment` carries no `APP_VERSION` or `GIT_SHA`, and its `build.args` carries both.
- `pnpm rules:digest` wrote; `pnpm docs:check` clean (inside `lint`).

**Review — one bounded pass, `security-reviewer`.** No Critical, High or Medium findings. Three Lows, all fixed:

1. The Dockerfile and compose comments said an image "cannot be started under a version it was not built as". A runtime `-e` still overrides an `ENV`; ADR-0081 §2 promises only that the reference compose never sets them at run time. Reworded to that.
2. The spec cited `health.int.test.ts`, which proved neither scenario at the wire. Two cases added: a labelled build answers `9.9.9` and the full commit on `/health` and `/health/live`; an unlabelled one answers `dev` with no `commit` field. The spec now says every `/health` view, liveness included.
3. `docker/prod/.env.example` showed `$(…)` lines in a dotenv template, which compose would refuse. They are now `export` lines for the building shell, with deploy.md's `2>/dev/null`.

Residuals the reviewer named, for the operator to route: `/health` is unauthenticated and will now tend to carry a full 40-character commit, which maps a public fork's running instance to exact source; neither value has a length or format bound; and whether Coolify also injects compose-resource variables into containers, which would override the baked `ENV`, was not verified.
