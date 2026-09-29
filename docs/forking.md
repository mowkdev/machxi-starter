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

- **`docs/plan/` resets.** The plans and the ledger narrative are the blueprint's journal — how _this_ repository got here. A fork writes its own from row one, and `.gitattributes` marks `docs/plan/ merge=ours` so the journal never travels in either direction.
- **`docs/adr/` is carried.** The records are the decisions the code stands on; they come with the code. The fork's own records continue the numbering after the highest inherited one.
- **`.claude/` is carried.** The rules, agents and skills are the machinery that applies the records. They are written to survive the trip: every citation carries a topic gloss, and no step number or date appears in them (`pnpm docs:check` enforces it).
- **Some of `.claude/` is optional, and some is not.** A fork that does not run the process may delete the process skills (`/scope`, `/step`, `/steps`, `/ship`, `/new-adr`), the builder agents (`module-builder`, `ui-builder`, `db-migrator`, `test-engineer`, `adr-author`) and `gate-runner`: they are conveniences over the gate and the records, and nothing the gate runs depends on them. Other inherited documents still mention them by name — `CLAUDE.md` and `.claude/README.md` list them, a reviewer or a skill may recommend `/new-adr`, `docs/upstreaming.md` walks through `/scope`, `/step` and `/ship` — so a deletion leaves those mentions dangling unless the fork trims them too, and the process digest's header is trimmed in `scripts/rules-digest.mjs`, never in the generated file. It keeps `.claude/rules/`, the digests in `docs/rules/` and the three reviewers (`adr-reviewer`, `security-reviewer`, `code-reviewer`): the rules and digests are how the records reach a session that touches the code, and the reviewers are the one review pass a change gets. A deleted file comes back as a modify/delete conflict whenever the starter changes it; resolve it by deleting again.
- **The lane rule travels with the records; the lanes do not.** [ADR-0079](adr/0079-parallel-lanes.md) (parallel lanes) is inherited like every record, so a fork may run more than one deliverable at once on the same condition — no record shared between two open lanes, at most one adding migrations — and `pnpm docs:check` enforces it against the fork's own ledger. The starter's open lanes are entries in its journal, which resets: a fork's ledger starts with none, and its first lane opens alone.
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

Every shipped deliverable of the starter is an annotated tag `starter-D<n>` and one entry in [`CHANGELOG.md`](CHANGELOG.md). A fork records the tag it forked at, and then:

```bash
git fetch starter --tags
git log starter-D13..starter/main --oneline    # what has landed since
git merge starter/main
```

Merge periodically rather than once a year: the conflicts are proportional to the distance.

## 6. Diverging from an inherited decision

**A fork never edits an inherited record — it supersedes.** An edit turns the next merge from the blueprint into a conflict, and erases the record of which decision was deliberately dropped. Write a new record in the fork's own numbering, state the delta, and move the inherited one to `superseded by` in the fork's index — the same lifecycle the starter itself runs ([ADR-0050](adr/0050-adr-lifecycle-and-verification.md), the ADR lifecycle, as carried by [ADR-0065](adr/0065-starter-lifecycle.md)).

The same rule applies to `.claude/` and the digests: change them by writing the fork's own rules beside the inherited ones, so that a merge shows you exactly what the starter changed and what you did.

## What conflicts, and what does not

| Path                 | On a merge from `starter/main`                                           |
| -------------------- | ------------------------------------------------------------------------ |
| `docs/plan/`         | never — `merge=ours` keeps the fork's journal                            |
| `docs/adr/`          | only where the fork edited an inherited record, which is why it must not |
| `docs/rules/`        | generated; regenerate with `pnpm rules:digest` after the merge           |
| `docs/specs/`        | like code: where both sides changed one capability's behaviour           |
| `.claude/`           | where both sides changed the same skill; the fork's additions sit beside |
| `apps/`, `packages/` | ordinary code conflicts, proportional to how long since the last merge   |
