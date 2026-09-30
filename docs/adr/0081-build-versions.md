# ADR-0081: Build versions — one release label and a commit, stamped at image build (supersedes ADR-0004, 0016, 0054 and 0065 in part — deltas)

- Status: accepted
- Date: 2026-09-30
- Supersedes (each at the step that makes its delta true): [ADR-0004](0004-configuration-and-environment.md) (delta: `APP_VERSION` defaults to `dev`, an empty `GIT_SHA` is absent, and neither is read from a `package.json`); [ADR-0016](0016-health-checks.md) (delta: §Consequences' fallback — `version` is the image's label or `dev`, never a manifest's); [ADR-0054](0054-design-language-instrument.md) (delta: §5's footer source — the image build's release label, not a hand-bumped `package.json`; **amended 2026-09-30 (D32.5)**, from "label and commit"); [ADR-0065](0065-starter-lifecycle.md) (delta: §2's tag namespace belongs to the repository that writes it, and §3's journal gains `docs/CHANGELOG.md`)

> Written 2026-09-30 by `/scope` for D32 ([`docs/plan/0032-build-versions.md`](../plan/0032-build-versions.md)), with D29 in progress — writing is not opening, opening is not accepting. `proposed` at writing; **accepted 2026-09-30 at the head of `D32.1`**, where [ADR-0004](0004-configuration-and-environment.md) and [ADR-0016](0016-health-checks.md) moved to `superseded by` for §1–§3's API half; [ADR-0054](0054-design-language-instrument.md) moved at `D32.2`, which built the SPAs' half, and [ADR-0065](0065-starter-lifecycle.md) moved at `D32.3`, the step that makes its delta true. Amendable in place, labelled, while D32 is `in progress` (ADR-0025 rule 2, as carried by ADR-0079). **Amended once, at `D32.5`**, on the operator's decision after `D32.4` (§2–§3, and the 0054 delta above): the SPA footer shows the label alone, and the SPAs no longer take `GIT_SHA`. Delta supersessions per [ADR-0050](0050-adr-lifecycle-and-verification.md): every parent stands for everything named below that it does not decide.

## Context

The three apps say which build they are in three different ways, and none of them is right in a deployment.

- **The API** reads `APP_VERSION` and `GIT_SHA` from its environment at boot. The reference compose passes them at run time, so `/health` reports whatever the operator typed, whatever image is running. ADR-0004's schema comment and ADR-0016 §Consequences both say it "falls back to `package.json` version". Nothing reads that file; the default is the literal `0.0.0`.
- **The SPAs** read their own `apps/*/package.json` `version` at build time (ADR-0054 §5), which holds `0.0.0`, and the record's own consequence is "bump the field or the footer lies". Three files to bump for one release, by hand, with no commit shown.
- **A fork** inherits `/ship`'s `starter-D<n>` tag and `docs/CHANGELOG.md`. Its own D21 would tag a name the starter already owns, which `git fetch starter --tags` then refuses; and appending its own changelog entries conflicts with every starter entry a merge brings down.

What established monorepos do settles the shape. Release tooling (Lerna and Nx's *fixed* mode, release-please's linked versions) keeps apps that ship together on one version. Deployed products show a human release label and a build identity side by side, and the identity is the commit. Semver's purpose, telling a consumer what is compatible, is already served for the API by `/api/v1` ([ADR-0015](0015-route-segments-and-versioning.md)), and the SPAs have no consumers.

## Decision

### 1. Two facts, one each for the whole product

- **`APP_VERSION`, the release label**: a string, with the same value in all three apps, because the reference deployment releases them as one compose resource ([ADR-0059](0059-ci-containers-and-deployment.md)). Its scheme, semver or calendar, is the owning repository's choice and is never parsed.
- **`GIT_SHA`, the build identity**: the commit the image was built from. Since `D32.5` it is the API's alone (§2–§3).
- **Unset, the label is `dev` and the commit is absent.** Local builds, the gate and the starter's own images show `dev`. An empty string is treated as unset, because a build argument cannot be left out as a bare environment key can.

### 2. Stamped at image build, under one name each wherever it is taken

_Heading amended 2026-09-30 (D32.5), from "under the same two names everywhere": since that step the SPAs take the label alone._

- All three Dockerfiles take `ARG APP_VERSION`, and the API's takes `ARG GIT_SHA` beside it. One name per fact, the [ADR-0073](0073-review-hardening.md) §9 rule: two names for one fact is how a deployment ends up with apps that disagree.
- **The API** promotes both to `ENV` in its runtime stage, and `core/config` reads them at boot as it does today. The reference compose passes them as build arguments and stops setting them at run time, so an image cannot be started under another version.
- **The SPAs** substitute the label through the Vite `define` of each `app-version.ts`, read from the process environment. Each app's `turbo.json` `build` task declares it in its `env`. **This answers ADR-0054 §5's objection to a value the cache does not key on:** a cached build cannot show another build's version, because the value is part of its hash. The hash moves only where the value is set, at image build; locally it is unset and the cache is untouched.
- **Amended 2026-09-30 (D32.5), on the operator's decision after `D32.4`.** As accepted, all three Dockerfiles took `GIT_SHA`, and the SPAs substituted it beside the label, hashed it in `turbo.json` and showed its first seven characters. **The SPAs no longer take `GIT_SHA` anywhere**: no `define`, no `turbo.json` `env` entry, no `ARG`, and the reference compose passes it to the API's image alone. The commit is the API's `/health` fact.
- **No `package.json` `version` is read by anything.** The per-app and per-package fields stay `0.0.0`, and a bump to one is inert.

### 3. Shown in two places

- The sidebar footer of both SPAs shows the label alone, as given, and `dev` when it is unset.
- `/health` answers `version` and `commit` exactly as [ADR-0016](0016-health-checks.md) shaped them. The contract does not change. It is the one place the commit is shown.
- **Amended 2026-09-30 (D32.5), on the operator's decision after `D32.4`.** As accepted, the footer showed the label and, when there was one, the commit's first seven characters. It now shows the label alone, and the commit is read from `/health`, which answers the API's image. Released as one compose resource (§1), the three images share one label and are built from one commit.

### 4. Computed by the repository that releases, with no tool adopted here

- The reference deployment's documentation derives both from git at build time: the commit from `git rev-parse HEAD`, the label from the nearest release tag matching `v[0-9]*`, or `dev` when there is none.
- **The starter adopts no release tool.** It is a blueprint and ships no product release. `docs/forking.md` recommends one for a fork: release-please in single-version mode, driven by the conventional commits the repository already writes, tagging `v<version>`.

### 5. Tags and the changelog in a fork (the ADR-0065 delta)

- **A tag namespace belongs to the repository that writes it.** `starter-D<n>` is the starter's. `/ship` tags `<prefix>-D<n>`, with the prefix read from the ledger's header. The starter's ledger states `starter`, and `/bootstrap` writes the fork's own, so a fetched starter tag never meets a fork tag of the same name. Product release tags are `v<version>`, and they are the release tool's.
- **`docs/CHANGELOG.md` joins the journal.** It records one repository's deliverables, as `docs/plan/` does. `.gitattributes` marks it `merge=ours`, `/bootstrap` resets it, and a fork reads the starter's history with `git show starter/main:docs/CHANGELOG.md`.

## Consequences

- One release is one label, set once, at build. There is no file to bump and no footer that can lie about a build.
- `/health` becomes true of the image. Before, it was true of the compose file.
- A deployment built without the arguments says `dev`. That is a truthful answer, not a guessed one.
- A fork gets version display on day one and chooses its own scheme and tool without editing a carried record.
- **Not decided here:** an API response header carrying the version and a "new version available" prompt in the SPAs. They are a planned ledger row of their own. CI building and publishing images stays where [ADR-0059](0059-ci-containers-and-deployment.md) left it.

## Alternatives considered

- **A hand-bumped version in the root `package.json`, checked against the tag in CI.** It reinvents a release tool's job badly, and the root manifest is a file the starter and a fork both edit.
- **The label from the git tag at every build, including local ones.** It needs git in the Docker build context and makes every local build's hash depend on the tag.
- **Independent versions per app.** They are the right shape for apps that deploy apart. These deploy together, and a fork that splits them supersedes §1.
- **Changesets.** It is built for publishing packages, and it asks for a changeset file with every change. These packages are source-only ([ADR-0002](0002-monorepo-layout-and-tooling.md)).
- **The short commit beside the label in the SPA footer.** Built at `D32.2` and removed at `D32.5` on the operator's decision (§3's amendment). It gave the SPAs a second build fact to stamp, hash and pass, for a value `/health` already answers.
- **Adopting release-please in the starter itself.** The starter never releases a product, so the tool would only ever run in forks. Recommending it costs nothing and leaves the choice with the repository that releases.
