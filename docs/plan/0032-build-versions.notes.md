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

## D32.2 — The SPAs' version (2026-09-30)

**Head: [ADR-0054](../adr/0054-design-language-instrument.md) moved to `superseded by` [ADR-0081](../adr/0081-build-versions.md)**, beside its 0080 delta, with a status delta and a header blockquote: §5's footer source is the image build's label and commit, not a hand-bumped `package.json`, and everything else §5 decides about the footer stands. 0081's header, its index row, the topic table's design-language row and the ledger's window paragraph say so. No record amended.

**Built.**

- Both `app-version.ts` build the `define` from an environment: `__APP_VERSION__` is `APP_VERSION` or `dev`, `__GIT_SHA__` is `GIT_SHA` or the empty string. Blank is unset, by the API's `optionalEnv` rule, so the footer and `/health` agree on a padded or empty build argument. `vite.config.ts` passes `process.env`. `vitest.config.ts` passes `{}`, so the unit suites stay a pure function of the tree whatever the shell holds, for the reason `VITE_API_URL` is pinned there.
- Both `shared/config` doors export `APP_VERSION` and `GIT_SHA` (`undefined` when none), and neither is in the zod schema: they are facts about the build, not `VITE_*` configuration, and there is no `VITE_`-named twin.
- Both sidebar footers render `brand.version` (`{{version}}`), or `brand.versionWithCommit` (`{{version}} · {{commit}}`) with the commit's first seven characters, in `en` and `lv`. **The `v` prefix is gone**, which settles the scoping note: `v{{version}}` rendered `vdev` when unset, and would render `vv1.2.0` for a label derived from a `v`-prefixed tag, which is what `docs/deploy.md` derives. The label is shown as given.
- **`turbo.json`: the apps' own, not the root's.** Each app's `turbo.json` declares a `build` `env` of its own, and a package's `env` replaces the root's rather than adding to it. So `APP_VERSION` and `GIT_SHA` in the root table were invisible to the SPA builds. The first throwaway image built with them there carried `version:"dev"` in its bundle. Both names are now in `apps/admin/turbo.json` and `apps/customer/turbo.json`, and the root table is unchanged, because only the SPAs read them.
- Both SPA Dockerfiles take `ARG APP_VERSION` and `ARG GIT_SHA`, promoted to `ENV`, below the install and above the build. So a new label rebuilds the bundle and nothing under it, and no `ARG` sits above the fetch. `docker/prod/compose.yaml` passes both to both SPA images as `${APP_VERSION:-}` and `${GIT_SHA:-}`. `docker/prod/.env.example` and `docs/deploy.md` now say all three images are stamped.
- `apps/admin/e2e/shell.spec.ts`: the footer case asserted `^v\d+\.\d+\.\d+$` and now asserts the shape, a label and an optional `·` and seven hex characters, never `undefined`. It is not run here; `D32.4` runs the browser tier.
- `scripts/rules-digest.mjs`: a "The build's version" line in frontend and platform, citing 0081 and 0054. `pnpm rules:digest` wrote 1 of 3, and the 0054-carrying lines now read "as carried by 0080 and 0081".
- **No SPA spec.** The footer is display chrome that crosses no wire. `docs/specs/README.md` and the frontend rule file keep SPA specs for flows a step names, and this step names none. Its suites prove it.

**Two index repairs, outside the step's own rows.**

1. `D32.1` put 0081's delta on 0013's index row instead of 0016's. It is moved to 0016's row, whose ADR file already said so.
2. **0054 had no index row at all.** `58df3d7`, the commit that opened D12, dropped it, probably by accident in the edit that added 0055. It is restored from that commit's parent, with its status brought to the file's own (superseded by 0080 and 0081) and `D31.2` and `D32.2` appended.

**Plan amended, labelled:** the image done-when's `grep -rlq 9.9.9` is now `grep -rlqF`. Without `-F`, the dots match any character, and the unfixed build, whose bundle said `dev`, still passed it on some hash in the assets.

**Done-whens.**

- `pnpm test:unit --filter admin` and `--filter customer` green, each with "the footer shows the release label and the short commit" and "the footer shows dev and no commit when unset". The unset case goes through the real `define` with no mock. The labelled case replaces the two constants at the `@/shared/config` door, spreading the rest from the real module.
- `APP_VERSION=9.9.9 pnpm turbo run build --filter admin --dry=json` lists `APP_VERSION` and `GIT_SHA` under `admin#build`'s specified env, with `APP_VERSION` among the configured variables.
- `docker build -f apps/admin/Dockerfile --build-arg APP_VERSION=9.9.9 --build-arg GIT_SHA=0123456789abcdef --build-arg VITE_API_URL=http://localhost:4000 -t machxi-d32-admin .` then `docker run --rm machxi-d32-admin grep -rlqF 9.9.9 /usr/share/nginx/html/assets` exits `0`, and the built footer reads the label and the commit's `slice(0,7)`. The customer image, built the same way as `machxi-d32-customer`, carries both. `docker compose -f docker/prod/compose.yaml config` renders both arguments on all three images' builds. Both throwaway images were removed.
- `pnpm i18n:check` green in both apps. `pnpm size` green: admin js 368.2 of 383.8 kB and entry 163.3 of 170.9, customer js 312.0 of 324.2 and entry 106.6 of 111.3.
- The gate, green. As at `D32.1`, it ran with `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` exported from their committed values, because the worktree has no `.env`. The SPA builds needed none: the Dockerfiles pass `VITE_API_URL`, and `size`'s local build ran without one as before.

**Review: one bounded pass, `code-reviewer`.** Nothing broken. Two findings, both fixed:

1. **(Low) No suite ran the blank handling in `versionDefine`.** The runner passes `{}` and the labelled case mocks the door below it, so a change of `|| "dev"` to `?? "dev"` would have shipped an empty footer on an unlabelled image with every suite green. `app-version.test.ts` in each app now proves it: a blank label is `dev`, a blank commit is none, and a label and a commit pass through as given.
2. **(Minor) The SPAs trimmed a padded value and the API did not**, so `" 1.2.3"` would have differed between the footer and `/health`. The SPAs now use the API's rule: a blank value is unset, and any other value is kept as given.

Checked clean: the mock cannot leak past its file, since per-file isolation is the default and nothing overrides it; nothing still reads `__APP_VERSION__`, a `package.json` version or `v{{version}}`; the `ARG` placement passes the hygiene case.

**For the operator.**

- **The running dev servers.** `app-version.ts` is a dependency of each `vite.config.ts`, so on the merge to `main` Vite should restart its own dev server, and the footer should read `dev` on 3001 and 3002. No restart is needed from the operator. A dev server never shows a label, because the `dev` task does not pass these names through. The root `.env.example`'s "set them here only to see a label on a local run" is true of the API's `/health` alone, and `D32.4` sweeps that wording.
- **Pending the operator's eye:** the footer at 240px with a long label and a commit. `truncate` clips it rather than wrapping, and jsdom cannot measure that.
- `apps/*/src/app/routeTree.gen.ts` show as modified in the worktree with no content diff. That is line endings only, and they are left out of the commit.

## D32.3 — A fork's tags, changelog and release (2026-09-30)

**Head: [ADR-0065](../adr/0065-starter-lifecycle.md) moved to `superseded by` [ADR-0081](../adr/0081-build-versions.md)**, beside its 0068 and 0074 deltas, with a status delta and a header blockquote. The delta covers §2 and §3. Under §2 a tag namespace belongs to the repository that writes it, and `/ship` tags `<prefix>-D<n>` from the ledger's header. Under §3 `docs/CHANGELOG.md` joins the journal. Everything else 0065 decides stands. 0081's header, the index rows of both records, the topic table's forking row, the index's "starter as a starter" line and the ledger's window paragraph say so. No record amended.

**Built.**

- **The ledger's header** gains `` Tag prefix: `starter` `` alone on its line, above the table, and one sentence that says what reads it.
- **`scripts/docs-hygiene.mjs`**:
  - `parseTagPrefix` reads the header, meaning every line above the first table row or `## ` heading. `checkTagPrefix` then refuses three things:
    - `tag-prefix-missing`: no line in the header.
    - `tag-prefix-malformed`: a line in the header opens `Tag prefix` but does not parse.
    - `tag-prefix-duplicate`: more than one line.
  - A prefix is a lowercase name that git accepts as part of a tag name. It never opens with `v` and a digit (see the review).
  - `scanTagPrefix` runs from the CLI beside the lane check and prints `tag prefix: starter`. A corpus with no ledger yet is exempt, as it is from the lane check.
- **`scripts/docs-hygiene.test.mjs`**: the named case "the ledger names the tag prefix /ship writes" takes the committed ledger and checks three things:
  - the ledger is clean and names a well-formed prefix;
  - with the line removed, it is refused as `tag-prefix-missing`;
  - `/ship`'s skill names the `Tag prefix:` line and the `<prefix>-D<n>` shape.

  Two fixture cases cover the other rules: malformed, `v2`, duplicate, and a prefix below the header. **Red with the line removed** was also shown from the CLI: `node scripts/docs-hygiene.mjs` printed `docs/plan/README.md:1 [tag-prefix-missing]` and exited `1`, and restoring the ledger made it green again.

- **`/ship`** step 7 reads the prefix and tags `<prefix>-D<n>`. It stops rather than move a tag that already exists, and it ends each entry `Tag <prefix>-D<n>.`. It says the changelog is journal and that `v<version>` tags belong to the release tool, never to `/ship`. Step 8 pushes `<prefix>-D<n>`.
- **`/bootstrap`**:
  - It chooses the prefix first, from `--prefix` or by asking the operator.
  - It refuses `starter`, and it refuses a `v` followed by a digit.
  - It writes the `Tag prefix:` line into the fresh ledger and resets `docs/CHANGELOG.md` to its preamble under the fork's prefix.
  - It keeps both `merge=ours` entries, and its acceptance checks `git check-attr` on both.
- **`.gitattributes`**: `docs/CHANGELOG.md merge=ours`, with the comment extended to the changelog.
- **`docs/CHANGELOG.md`'s preamble**: the tag is `<prefix>-D<n>`, with the prefix named in the ledger. A new paragraph says the file is journal: `merge=ours`, reset by `/bootstrap`, and read in a fork with `git show starter/main:docs/CHANGELOG.md`.
- **`docs/forking.md`**:
  - §2 gains two bullets, one on the prefix and one on the changelog resetting.
  - §5 says the two namespaces never meet and adds the `git show` line.
  - A new §6, "Releasing the product", covers the two build arguments and deriving them from git (it points to `deploy.md` for the commands). It recommends, without adopting, release-please in single-version mode: the root package, the `simple` type, no component in the tag, so it tags `v<version>` and writes its own root `CHANGELOG.md`. It also says the `v<version>` and `<prefix>-D<n>` namespaces do not overlap. The old §6 is now §7; nothing linked to the section numbers.
  - "What conflicts" gains a `docs/CHANGELOG.md` row and a tags row.
- **`scripts/rules-digest.mjs`**:
  - The process "Versioning" line now cites 0081 first and describes the prefix and the `v<version>` release tags.
  - The "Forking" line names `docs/CHANGELOG.md` as journal.
  - `pnpm rules:digest` wrote 1 of 3, and the 0065-carrying lines now read "as carried by 0068 and 0074 and 0081".
- **Outside the named files, and why.** `docs/README.md`'s changelog row said "with its `starter-D<n>` tag", and the root `README.md` said `docs/CHANGELOG.md` tells a fork which starter it is on. In a fork, that file is now the fork's own. Both were reworded, each in one line. `docs/upstreaming.md`'s "tags `starter-D<n>`" is left as it is, because upstreaming ships in the starter.
- **No spec.** This is process tooling, and no `docs/specs/` capability covers it.

**Done-whens.**

- `node --test scripts/docs-hygiene.test.mjs`: 51 pass, 0 fail. This includes "the ledger names the tag prefix /ship writes", which is red with the line removed, as above.
- `git check-attr merge docs/CHANGELOG.md` prints `docs/CHANGELOG.md: merge: ours`.
- `pnpm docs:check` clean: inherited documents clean, 16 specs, 2 lanes disjoint, `tag prefix: starter`.
- **The gate: green.** `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm size` and `pnpm format:check` all passed. As at `D32.1` and `D32.2`, the gate ran with `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` exported from their committed values, against the shared `machxi_test`. After the review fixes, `pnpm lint` (which carries the script tests and `docs:check`) and `pnpm format:check` were re-run and passed. The fixes touched only scripts and documents.

**Review: one bounded pass, `adr-reviewer`.** The diff conforms, with four Minor findings, all fixed:

1. **The prefix check accepted `v2`.** Its `v2-D1` matches `v[0-9]*`, the pattern `deploy.md` derives the release label from, so a deliverable tag could have become `APP_VERSION`. `TAG_PREFIX_LINE` now refuses a `v` followed by a digit. There is a fixture case for `v2` (refused) and one for `vendor` (accepted), and `/bootstrap` states the rule.
2. **0065's banner said §3 "left `docs/CHANGELOG.md` carried"**, but §3 names it in neither list. The banner now says it "named `docs/CHANGELOG.md` in neither list, so it travelled with every merge".
3. **Two bullets in `forking.md` §6 disagreed.** One said "nothing is bumped in a file", while release-please's `simple` type bumps `version.txt`. That bullet now reads "no file the build reads carries the version".
4. **The Forking digest line cited 0081 twice**, once in 0065's carriers and once on its own. That line now cites only 0065. The Versioning line keeps 0081 as its primary citation.

The reviewer also noted, without calling it a finding, that `merge.ours.driver` is not defined in this clone. So on the lane→`main` merges here, `merge=ours` falls back to an ordinary merge, as `docs/plan/**` always has. How `merge=ours` behaves across lanes is D34's question.

**For the operator.** Nothing needs a browser. The `/bootstrap` and `/ship` wording is exercised only when a fork bootstraps or the next deliverable ships. Neither skill was run here.

## D32.4 — Close-out (2026-09-30)

**No head.** Every record was already accepted or moved, and none was amended.

**A merge `D32.3`'s note did not record.** After `D32.3` was committed (`d134911`), `main` carried D29's ship, and it was merged into the lane at `c620127`. It conflicted in one place, the ledger's window paragraph. The conflict was resolved by taking `main`'s paragraph, which records D29 shipped and D32 as the one open lane, and re-applying `D32.3`'s sentence that [ADR-0065](../adr/0065-starter-lifecycle.md) moved at `D32.3`. It is recorded here because `D32.3`'s note was written before the merge.

**The close-out bullets.**

- **Every parent's status line carries its delta.** This was already true: [0004](../adr/0004-configuration-and-environment.md) and [0016](../adr/0016-health-checks.md) moved at `D32.1`, [0054](../adr/0054-design-language-instrument.md) at `D32.2` and [0065](../adr/0065-starter-lifecycle.md) at `D32.3`. Each `- Status:` line names 0081 with its delta, and so does each index row.
- **The topic table** was already true. The forking, configuration, health and design-language rows name 0081.
- **The digests.** `pnpm rules:digest` wrote 0 of 3, and `node scripts/rules-digest.mjs --check` reported `up to date (3 digests)`. Each step had regenerated its own area.
- **The sweep.**
  - `README.md`'s quick start, `apps/admin/.env.example` and `apps/customer/.env.example` carried no `package.json` version wording, so there was nothing to remove.
  - Each SPA's `.env.example` gains one closing comment. It says the footer's label and commit are not configured there: they are `APP_VERSION` and `GIT_SHA`, build arguments of the image, with no `VITE_` twin. Unset, the footer says `dev`, and `pnpm dev` never passes them through.
  - The root `.env.example`'s "set them here only to see a label on a local run", which `D32.2`'s note flagged, now says it is the local API's `/health` alone. The SPAs' dev servers never read that file for these values.
  - The old wording remains only where it is frozen: the bodies of 0004, 0016 and 0054, which their 0081 deltas supersede, and the ledger's history.

**Done-whens.**

- `pnpm rules:digest` wrote, and then reported nothing stale.
- `pnpm docs:check` clean: inherited documents clean, 16 specs, 1 open lane, `tag prefix: starter`.
- `pnpm test:e2e` green in both apps, against the operator's running stack, which was attached to and not restarted.
  - admin: 38 passed and 1 skipped. The skip is `smoke.spec.ts`'s built-image case, which is conditional on a preview URL, as before. "the sidebar footer shows the build's version" passed.
  - customer: 12 passed.
- **The gate: green.** `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm size` and `pnpm format:check` all passed. As at the earlier steps, it ran with `DATABASE_URL_TEST` and `DATABASE_URL_TEST_OWNER` exported from their committed values, against the shared `machxi_test`. The review fix below changed two comments in `.env.example` files, which no check reads.

**Review: one bounded pass, `adr-reviewer`.** The diff conforms. There was one Minor finding, which was fixed:

1. The SPA comments said the footer says `dev` "as in every local build and dev server". That claims too much. A local build with `APP_VERSION` exported stamps it, which is `D32.2`'s own done-when, and so does a dev server started outside turbo. Both comments now say the footer is `dev` unless the building shell exports the values, and that `pnpm dev` never passes them through.

The reviewer verified the four status lines, the four topic rows and the absence of stale wording outside frozen text.

**For the operator.**

- **The running API answers `"version":"0.0.0"` on `/health`.** Under `D32.1`'s code, unset is `dev`. The `.env.example` from before D32 carried `APP_VERSION=0.0.0`, so the operator's root `.env` probably still does. This session cannot read `.env` to confirm it. Deleting that line (or `GIT_SHA`'s, if set) and restarting the API makes `/health` say `dev`. That restart is the operator's.
- Still open from `D32.2`: the footer at 240px with a long label and a commit, in a browser.
- Still open from `D32.1`: the security reviewer's residuals, namely the full commit on an unauthenticated `/health`, no length bound on either value, and whether Coolify injects compose variables over the baked `ENV`.
- Every step is ticked. D32 is ready for `/ship`.

## D32.5 — The footer shows the label alone (2026-09-30)

**Added after `D32.4`, on the operator's decision.** The SPA footer shows the release label and no commit. The SPAs no longer take `GIT_SHA` anywhere: no define in either `app-version.ts`, no entry in either app's `turbo.json` `build` `env`, no `ARG` in either SPA Dockerfile, and no build argument on the `admin` or `customer` services in the reference compose. The commit is the API's `/health` fact alone. ADR-0081 §1–§3, its 0054 delta and §Alternatives are amended in place, labelled. The `versionWithCommit` string left both catalogues in `en` and `lv`. The footer tests, the `app-version.test.ts` cases, the admin e2e footer case, `docs/deploy.md`, `docs/forking.md`, both `.env.example` files, `docker/prod/.env.example` and 0081's digest lines follow.

**Built partly by a `/step` agent the operator interrupted, and finished inline, on the operator's instruction** that a deliverable this small should not re-run the suites after every merge from the other lanes. There was no review agent, and no throwaway image builds, because the step only removes a value.

**Checked once, on the finished tree:**

- `turbo run lint check-types test:unit --filter=admin --filter=customer`: 32 of 33 tasks green. `admin#test:unit` failed while it shared the machine with the other tasks, then ran alone at 335 passed in 54 files.
- `pnpm docs:check`, `pnpm i18n:check` and `rules-digest --check`: clean, and the digests are up to date.
- Prettier: clean on the changed files.
- Grep: no `GIT_SHA`, `__GIT_SHA__` or `versionWithCommit` left in either app.

**Not run at this step:**

- the full gate;
- `pnpm size`;
- `pnpm test:e2e`;
- the `turbo --dry=json` and `docker compose config` done-whens.
