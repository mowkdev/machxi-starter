# Forking the starter

The recipe for turning this repository into a project, end to end. The decisions behind it are [ADR-0065](adr/0065-starter-lifecycle.md) (the starter lifecycle); the way a generic feature comes back is [`upstreaming.md`](upstreaming.md).

## 1. Clone, keeping history

```bash
git clone <this repository> my-project
cd my-project
git remote rename origin starter          # the blueprint stays reachable
git remote add origin <the project's own remote>
git push -u origin main
```

**A fork is a clone that keeps history.** History is what makes the next merge a merge: without it, `git merge starter/main` is a mass of unrelated conflicts and the starter becomes a one-time copy. A template repository with squashed history buys a clean log and loses the upstream path — that trade is the reason this document exists.

## 2. Bootstrap

Run `/bootstrap`. It resets the journal and leaves the process skills working:

- **`docs/plan/` resets.** The plans and the ledger narrative are the blueprint's journal — how _this_ repository got here. A fork writes its own from row one, and the starter merge keeps it (§5), so the journal never travels in either direction.
- **The tag prefix is the fork's own.** The ledger's header names it in one line, `` Tag prefix: `<prefix>` ``, and `/ship` tags each shipped deliverable `<prefix>-D<n>`. The starter's is `starter`; `/bootstrap` asks for the fork's and refuses `starter`, so the fork's D1 is `acme-D1` and never meets the starter's `starter-D1` ([ADR-0081](adr/0081-build-versions.md) §5, build versions). `pnpm docs:check` refuses a ledger with no prefix line.
- **`docs/CHANGELOG.md` resets too.** It records one repository's shipped deliverables, so it is journal like `docs/plan/`: `/bootstrap` empties it to its preamble, and the starter merge keeps the fork's (§5). The starter's history stays one command away: `git show starter/main:docs/CHANGELOG.md`.
- **`docs/adr/` is carried.** The records are the decisions the code stands on; they come with the code. The fork's own records continue the numbering after the highest inherited one.
- **`.claude/` is carried.** The rules, agents and skills are the machinery that applies the records. They are written to survive the trip: every citation carries a topic gloss, and no step number or date appears in them (`pnpm docs:check` enforces it).
- **Some of `.claude/` is optional, and some is not.** A fork that does not run the process may delete the process skills (`/scope`, `/step`, `/steps`, `/ship`, `/new-adr`), the builder agents (`module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `adr-author`) and `gate-runner`: they are conveniences over the gate and the records, and nothing the gate runs depends on them. Other inherited documents still mention them by name — `CLAUDE.md` and `.claude/README.md` list them, a reviewer or a skill may recommend `/new-adr`, `docs/upstreaming.md` walks through `/scope`, `/step` and `/ship` — so a deletion leaves those mentions dangling unless the fork trims them too, and the process digest's header is trimmed in `scripts/rules-digest.mjs`, never in the generated file. It keeps `.claude/rules/`, the digests in `docs/rules/` and the three reviewers (`adr-reviewer`, `security-reviewer`, `code-reviewer`): the rules and digests are how the records reach a session that touches the code, and the reviewers are the one review pass a change gets. A deleted file comes back as a modify/delete conflict whenever the starter changes it; resolve it by deleting again.
- **The lane rule travels with the records; the lanes do not.** [ADR-0079](adr/0079-parallel-lanes.md) (parallel lanes) is inherited like every record, so a fork may run more than one deliverable at once on the same condition — no record shared between two open lanes, at most one adding migrations — and `pnpm docs:check` enforces it against the fork's own lane files ([ADR-0082](adr/0082-lanes-on-one-machine-and-one-main.md) §4). The starter's open lanes are files in its journal, under `docs/plan/lanes/`, which resets: a fork starts with none, and its first lane opens alone.
- **`docs/specs/` is carried, and — unlike a record — edited in place.** A spec documents the code's current behaviour and diverges where the code diverges, so both sides edit it and a merge conflicts on it exactly where it conflicts on `apps/` ([ADR-0068](adr/0068-behaviour-specs-and-plan-notes.md), behaviour specs). The same hygiene rules apply to it as to `.claude/`.

## 3. Rename

```bash
node scripts/rename.mjs --dry-run acme    # read the diff first
node scripts/rename.mjs acme
```

One identifier per side, every derived name following from it: the API's cookie names and token audience, and each SPA's device-storage keys ([ADR-0064](adr/0064-brand-seams.md), brand seams). [`rebranding.md`](rebranding.md) is the three-line recipe and what to check afterwards.

## 4. Licence and manifest

Replace `LICENSE` with the project's own and set `name` and `license` in the root manifest. The starter ships `UNLICENSED` and a proprietary `LICENSE`: private on a host is a hosting setting, and the file is the statement.

## 5. Which starter you are on

Every shipped deliverable of the starter is an annotated tag `starter-D<n>` and one entry in the starter's `docs/CHANGELOG.md`. A fork's own deliverables are tagged under its own prefix and logged in its own changelog, so the two never meet: the fetched `starter-*` tags sit beside the fork's, and the starter's changelog is read from the remote rather than merged. A fork records the tag it forked at, and then:

```bash
git fetch starter --tags
git log starter-D13..starter/main --oneline    # what has landed since
git show starter/main:docs/CHANGELOG.md        # what each of those deliverables was
git -c merge.ours.driver=true -c merge.union.driver=true merge starter/main
```

**The starter merge keeps the fork's journal, and it is the only merge that does** ([ADR-0082](adr/0082-lanes-on-one-machine-and-one-main.md) §4, shared surfaces that do not conflict). `.gitattributes` gives the ledger and the plans `merge=ours` and the notes and the changelog `merge=union`, and no clone defines a driver. So a lane merge — a lane branch and `main`, here or in the starter — keeps both sides of the notes and the changelog, which have one writer each, and conflicts on the ledger rather than dropping a side. The starter merge defines both drivers as `true` on its own command line, which keeps the fork's side of every journal file both sides changed; git looks a driver up in the config before its own built-in `union`. **Never define either driver in the clone's or your global git config** — not even to save typing the flags: with `merge.ours.driver` every lane merge keeps its own ledger, and with `merge.union.driver` its own notes and changelog, each silently dropping the other lane's. `union` keeps both sides of a collision without a conflict, so the changelog's preamble and a notes file's existing text are edited only by the lane that ships, and `pnpm docs:check` refuses the duplicated headings a union of two edits leaves. A plan or a notes file the starter adds arrives with the merge, and one the fork deleted that the starter changed comes back as a modify/delete conflict; resolve either by deleting it (`git rm`). `scripts/merge-attributes.test.mjs` proves both merges against the committed attributes.

Merge periodically rather than once a year: the conflicts are proportional to the distance.

### The migration journal

`packages/db/migrations/meta/_journal.json` is one file both sides append to, so a merge that brings the starter's migrations conflicts there once the fork has migrations of its own. Resolve it by hand, keeping **every entry from both sides** — each names its own `.sql` file and carries its own `when` — in the order they should apply to a database that has neither, with `idx` renumbered to match; keep every `.sql` and snapshot file both sides added. Never edit a migration to make the merge fit, on either side.

The runner is what makes that merge safe to apply. It applies every journal entry that no row of the applied-state table records — by hash or by journal timestamp — in journal order, rather than only entries newer than the last one applied, so a starter migration older than the fork's newest is still applied at the next `db:migrate` ([ADR-0078](adr/0078-backend-closing-wave.md) §1, migrations applied by hash). It has two lanes: ordinary files run in one transaction, and a file whose first line is `-- migrate:concurrently` runs statement by statement outside it; both kinds merge the same way. The migrations directory is pinned to LF in `.gitattributes`, so the hash of a file is the same on every checkout.

After the merge, run `pnpm db:generate` and read what it emits before committing anything: drizzle-kit diffs the schema against the newest snapshot, which is one side's.

## 6. Releasing the product

The starter ships no product release, so it adopts no release tool. A fork that releases chooses its own versioning scheme, and the images already carry whatever it chooses ([ADR-0081](adr/0081-build-versions.md), build versions).

- **Two build arguments name a build.** `APP_VERSION` is the release label, one value for all three apps and never parsed, so semver and calendar versions both work. `GIT_SHA` is the commit, and it is the API's alone. The reference compose passes the label to all three images at build and the commit to the API's; `/health` answers both, and both SPAs' sidebar footers show the label alone. Left unset, every app says `dev` and `/health` names no commit.
- **Derive both from git on the machine that builds** — [`deploy.md`](deploy.md) has the commands. The commit is `git rev-parse HEAD`, and the label is the nearest release tag matching `v[0-9]*`, or `dev` when there is none. No file the build reads carries the version: no `package.json` `version` is read by anything.
- **Recommended, not adopted: release-please in single-version mode.** One release-please package at the repository root, with the `simple` release type and no component in the tag, so it tags `v<version>` — the tag the label is derived from. It reads the conventional commits this repository already writes, opens a release pull request that bumps the version and writes release notes, and tags on merge. Its release notes are the product's, in the root `CHANGELOG.md` it writes; `docs/CHANGELOG.md` stays the deliverables' journal. A fork that deploys its apps apart, or prefers another tool, supersedes ADR-0081 in its own corpus.
- **The two tag namespaces do not overlap.** `v<version>` tags are the release tool's; `<prefix>-D<n>` tags are `/ship`'s, one per deliverable. A release usually spans several deliverables, and a deliverable need not cut a release.

## 7. Diverging from an inherited decision

**A fork never edits an inherited record — it supersedes.** An edit turns the next merge from the blueprint into a conflict, and erases the record of which decision was deliberately dropped. Write a new record in the fork's own numbering, state the delta, and move the inherited one to `superseded by` in the fork's index — the same lifecycle the starter itself runs ([ADR-0050](adr/0050-adr-lifecycle-and-verification.md), the ADR lifecycle, as carried by [ADR-0065](adr/0065-starter-lifecycle.md)).

The same rule applies to `.claude/` and the digests: change them by writing the fork's own rules beside the inherited ones, so that a merge shows you exactly what the starter changed and what you did.

## What conflicts, and what does not

| Path                                        | On a merge from `starter/main`                                           |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `docs/plan/`                                | the starter merge keeps the fork's (§5); a file the starter adds arrives |
| `docs/CHANGELOG.md`                         | the starter merge keeps the fork's (§5); `git show` reads the starter's  |
| tags                                        | never — the fork tags `<prefix>-D<n>`, the starter `starter-D<n>`        |
| `docs/adr/`                                 | only where the fork edited an inherited record, which is why it must not |
| `docs/rules/`                               | generated; regenerate with `pnpm rules:digest` after the merge           |
| `docs/specs/`                               | like code: where both sides changed one capability's behaviour           |
| `packages/db/migrations/meta/_journal.json` | whenever both sides added a migration: keep every entry (above)          |
| `.claude/`                                  | where both sides changed the same skill; the fork's additions sit beside |
| `apps/`, `packages/`                        | ordinary code conflicts, proportional to how long since the last merge   |
