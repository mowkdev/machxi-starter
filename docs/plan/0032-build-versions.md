# D32 — Build versions

- Status: **in progress** — **scoped in full 2026-09-30 by `/scope`**, on the operator's question about versioning before the fork, with D29 in progress (ledger §How D32 was scoped). **Opened 2026-09-30** on the operator's decision, as a lane beside D29 once `D29.5` had landed, rather than after D29 ships as scoping recorded. It builds on `lane/D32` in a worktree of its own (ledger §How D32 opened).
- Records: [ADR-0081](../adr/0081-build-versions.md) (one release label and a commit, stamped at image build; a fork's own tag namespace and changelog) — written `proposed` at scoping, accepted at the head of `D32.1`. Parents: [ADR-0004](../adr/0004-configuration-and-environment.md), [ADR-0016](../adr/0016-health-checks.md), [ADR-0054](../adr/0054-design-language-instrument.md), [ADR-0065](../adr/0065-starter-lifecycle.md). Amends none. **Adds no migration.**
- Schema: no
- Ledger: [`docs/plan/README.md`](README.md)
- Notes: [`0032-build-versions.notes.md`](0032-build-versions.notes.md)

## Goal

The API, the admin app and the customer app show the same release label and the commit they were built from. **Amended 2026-09-30 (D32.5):** the SPAs show the label alone, and the commit is the API's `/health` fact. The values are stamped once, at image build, under two names, and nobody bumps a file. A fork gets this on day one, chooses its own versioning scheme and release tool, and tags and logs its own deliverables without colliding with the starter's.

## Constraints

- `APP_VERSION` and `GIT_SHA` are the only names, in every Dockerfile, in compose and in `turbo.json`. There is no `VITE_`-named twin (ADR-0081 §2, the ADR-0073 §9 rule).
- The health contract's shape does not change: `version` and an optional `commit` (ADR-0016; ADR-0081 §3).
- Configuration is read in `core/config` alone, at boot (ADR-0004 as carried by ADR-0075).
- The SPAs' values are compile-time constants through the existing `define`. There is no runtime fetch and no inline script (ADR-0054 §5 as carried by ADR-0081; ADR-0074 §6).
- Every operator-facing string is a key in `en` and `lv`, and `pnpm i18n:check` holds (ADR-0046, as carried).
- A spec under `docs/specs/` that states the changed behaviour is updated in the same diff (ADR-0068 §1).
- No release tool, no new dependency and no CI image pipeline (ADR-0081 §4, ADR-0059).
- A fork never edits a carried record. `/bootstrap` writes only the journal and the clone's config (ADR-0065 §1 and §3 as carried).
- Nothing here restarts the operator's stack. Image builds in a done-when are throwaway builds beside it (`CLAUDE.md`).
- The gate as `CLAUDE.md` §Commands defines it, at every step.

## Decisions taken at scoping (2026-09-30)

These were asked of the operator, who answered each with the recommended option:

- **The API's values are baked into the image.** Compose stops passing them at run time.
- **D32 opens after D29 ships.** `D29.5` rewrites both SPA Dockerfiles and the reference compose, and ADR-0059 is in D29's set. _Revised at opening, 2026-09-30:_ `D29.5` landed first, and the operator opened D32 as a lane beside D29.
- **`docs/CHANGELOG.md` is journal.** It is marked `merge=ours` and reset by `/bootstrap`.
- **The "new version available" prompt is not built here.** It is a planned ledger row of its own (D33).

Recorded, not asked:

- **Unset means `dev`.** It is not `0.0.0`.
- **The footer shows the commit's first seven characters, and `/health` gives the full commit as passed.** _Revised after `D32.4`, on the operator's decision:_ the footer shows the label alone, and the commit is `/health`'s alone (`D32.5`).

## Steps

Each step: implement, gate green, one bounded diff review, commit (ADR-0050). ADRs listed are what the builder reads first.

- [x] **1. Accept ADR-0081; the API's version.** Accept 0081 at the head. [ADR-0004](../adr/0004-configuration-and-environment.md)'s and [ADR-0016](../adr/0016-health-checks.md)'s status lines gain their deltas, and the index row, the topic table and the ledger's window section say so. Write 0081's digest lines in `scripts/rules-digest.mjs`.
  - `APP_VERSION` defaults to `dev`, and an empty `GIT_SHA` parses as absent.
  - `apps/api/Dockerfile` takes both as `ARG` and promotes them to `ENV` in the runtime stage.
  - The reference compose passes both as build arguments to the API image and removes them from the `api` service's environment.
  - Both `.env.example` files say where the values come from.
  - `docs/specs/health-and-metrics.md` states what `version` and `commit` answer when unset.

  **ADRs:** 0081 §1–§3, 0004 §Decision's schema as carried by 0075, 0016 with its 0066 delta, 0059 §4.
  **Done when:**
  - `pnpm test --filter api` green, with config cases "APP_VERSION defaults to dev" and "an empty GIT_SHA is absent", and `health.int.test.ts` still asserting the configured version;
  - `docker build -f apps/api/Dockerfile --build-arg APP_VERSION=9.9.9 --build-arg GIT_SHA=0123456789abcdef -t machxi-d32-api .` then `docker run --rm machxi-d32-api node -e "process.stdout.write(process.env.APP_VERSION + ' ' + process.env.GIT_SHA)"` prints `9.9.9 0123456789abcdef`;
  - `docker compose -f docker/prod/compose.yaml config` renders with no `APP_VERSION` in the `api` service's `environment`;
  - `pnpm rules:digest` writes;
  - `pnpm docs:check` clean;
  - the gate green.

- [x] **2. The SPAs' version.** [ADR-0054](../adr/0054-design-language-instrument.md)'s status line gains its delta at the head.
  - Both `app-version.ts` read `APP_VERSION` and `GIT_SHA` from the process environment instead of `package.json`, and install a define for each.
  - `turbo.json`'s `build` task declares both in `env`.
  - Both SPA Dockerfiles take both as `ARG`, promoted to `ENV` in the build stage, and compose passes them to both images.
  - Both sidebar footers show the label and the short commit when present, with the text in both catalogues.

  **ADRs:** 0081 §2–§3, 0054 §5, 0062 §3–§4 as carried, 0026 as carried by 0074.
  **Done when:**
  - `pnpm test:unit --filter admin` and `pnpm test:unit --filter customer` green, each with cases "the footer shows the release label and the short commit" and "the footer shows dev and no commit when unset";
  - `APP_VERSION=9.9.9 pnpm turbo run build --filter admin --dry=json` lists `APP_VERSION` among the task's environment variables;
  - `docker build -f apps/admin/Dockerfile --build-arg APP_VERSION=9.9.9 --build-arg GIT_SHA=0123456789abcdef --build-arg VITE_API_URL=http://localhost:4000 -t machxi-d32-admin .` then `docker run --rm machxi-d32-admin grep -rlqF 9.9.9 /usr/share/nginx/html/assets` exits `0`; **Amended 2026-09-30 (D32.2): `-F`.** Without it `9.9.9` is a pattern whose dots match any character, and it exited `0` on a bundle that carried `dev`, because some hash in the assets matched;
  - `pnpm i18n:check` green;
  - `pnpm size` green;
  - the gate green.

- [x] **3. A fork's tags, changelog and release.** [ADR-0065](../adr/0065-starter-lifecycle.md)'s status line gains its delta at the head.
  - The ledger's header states the tag prefix, `starter`, in one parseable line. `/ship` reads it and tags `<prefix>-D<n>`.
  - `.gitattributes` marks `docs/CHANGELOG.md merge=ours`, and the changelog's own preamble says it is journal.
  - `/bootstrap` resets the changelog and writes the fork's prefix. It refuses `starter`.
  - `docs/forking.md` gains how a fork releases: the two build arguments, deriving them from git, and release-please in single-version mode tagging `v<version>`, recommended rather than adopted.
  - `docs/forking.md` §5 and §"What conflicts" name the changelog and the prefix.
  - `pnpm docs:check` refuses a ledger with no tag prefix line.

  **ADRs:** 0081 §4–§5, 0065 §1–§3 as carried by 0068 and 0074, 0079 §1.
  **Done when:**
  - `node --test scripts/docs-hygiene.test.mjs` green, with case "the ledger names the tag prefix /ship writes", red with the line removed;
  - `git check-attr merge docs/CHANGELOG.md` prints `merge: ours`;
  - `pnpm docs:check` clean;
  - the gate green.

- [x] **4. Close-out.**
  - Every parent's status line carries its delta.
  - The topic table's rows for configuration, health, the design language and forking name 0081.
  - The digests are regenerated.
  - `README.md`'s quick start and the admin and customer `.env.example` files are swept for the old `package.json` wording.

  **ADRs:** 0081, 0065 §5 as carried.
  **Done when:**
  - `pnpm rules:digest` writes, then reports nothing stale;
  - `pnpm docs:check` clean;
  - `pnpm test:e2e` green in both apps;
  - the gate green.

- [x] **5. The footer shows the label alone.** Added 2026-09-30 after `D32.4`, on the operator's decision: the SPA footer shows the release label and no commit. The commit remains the API's `/health` fact alone. ADR-0081 §3 is amended in place, labelled, while D32 is in progress, and §2 is amended where it has the SPAs taking `GIT_SHA`.
  - Both sidebar footers render the label alone. The `{{version}} · {{commit}}` string leaves both catalogues in `en` and `lv`.
  - The SPAs no longer take `GIT_SHA` anywhere. Each `app-version.ts` installs a define for the label only, each app's `turbo.json` `build` `env` drops it, each SPA Dockerfile drops its `ARG`, and compose passes it only to the API's build.
  - `docs/deploy.md`, `docker/prod/.env.example`, the SPA `.env.example` comments, `docs/forking.md` and 0081's digest line say the commit is the API's alone.

  **ADRs:** 0081 §2–§3, 0054 §5 as carried by 0081.
  **Done when:**
  - `pnpm test:unit --filter admin` and `pnpm test:unit --filter customer` green, each with cases "the footer shows the release label alone" and "the footer shows dev when unset", and each `app-version.test.ts` asserting no commit define;
  - `APP_VERSION=9.9.9 GIT_SHA=0123456789abcdef pnpm turbo run build --filter admin --dry=json` lists `APP_VERSION` and not `GIT_SHA` among `admin#build`'s environment variables;
  - `docker compose -f docker/prod/compose.yaml config` renders `GIT_SHA` in the `migrate` and `api` images' build arguments only; **Amended 2026-09-30 (D32.5): and `prune`'s.** All three services build the one API image from the shared `x-api-image` anchor, so the rendered config carries it on each; what the done-when excludes is the `admin` and `customer` builds;
  - `pnpm test:e2e` green in the admin, with the footer case "the sidebar footer shows the build's version";
  - `pnpm i18n:check` green;
  - `pnpm size` green;
  - `pnpm rules:digest` writes, then reports nothing stale;
  - `pnpm docs:check` clean;
  - the gate green.
