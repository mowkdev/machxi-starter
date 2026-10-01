---
name: bootstrap
description: Prepare a clone of this starter to be somebody's project — reset the journal to an empty ledger and changelog under the fork's own tag prefix, add the `starter` remote, keep the merge attributes, and leave `/scope` and `/step` working on day one. Use as "/bootstrap" in a fresh fork, "/bootstrap --prefix <name>" to name the fork's tag prefix up front, or "/bootstrap --empty" to start a corpus from nothing.
---

# Bootstrap $ARGUMENTS

Run once, in a clone that is about to become a project. It makes the process skills work in a repository with no history of its own: `/scope` needs a ledger, `/step` needs a row marked `in progress`, and neither exists in a fork until somebody writes them.

**Stop before doing anything if the working tree is dirty, or if `docs/plan/README.md` already lists a deliverable that is not this repository's own.** Say what you found and let the operator decide.

## 1. Decide which repository you are in

- **A fork of the starter** (`docs/adr/` holds records, `docs/plan/` holds this blueprint's deliverables) — the normal case. The records are **carried**: they stay exactly as they are, and the fork's own numbering continues after the highest inherited number. The plans are the **journal** of the repository the fork came from, and they go.
- **An empty project** (`--empty`, or `docs/adr/` has no records) — write the conventions, the template and an empty index, then the empty ledger.

## 2. The journal resets, the corpus is carried

- **Choose the fork's tag prefix first.** `/ship` tags each deliverable `<prefix>-D<n>`, and the prefix is the repository's own tag namespace ([ADR-0081](../../../docs/adr/0081-build-versions.md), build versions). Take it from the arguments (`/bootstrap --prefix acme`) or ask the operator, offering the name the rename below will use. It is a lowercase name — a letter, then letters, digits or hyphens — and never `v` followed by a digit, whose `v2-D1` would match the `v[0-9]*` release tags a build takes its label from. **`starter` is refused**: that namespace is the starter's, and a fork tag of the same name collides with the one `git fetch starter --tags` brings down.
- **Run `pnpm bootstrap --prefix <prefix>`** ([ADR-0084](../../../docs/adr/0084-fork-readiness.md) §1, fork readiness). It is the journal reset, and it is not done by hand. It removes every deliverable plan, notes file and lane file under `docs/plan/`, keeping `docs/plan/lanes/README.md`. It writes the empty ledger: the header under the fork's `` Tag prefix: `<prefix>` ``, the empty table, the **Rules** section and [the window section](../../../docs/plan/README.md#the-window) with its generated block reading no lane open, and none of the starter's narrative. It resets `docs/CHANGELOG.md` to its preamble under the fork's prefix. It refuses a tree that is not a fresh clone of the starter and writes nothing then; say what it printed and stop. It commits nothing: read the diff, then commit it.
- Keep `.gitattributes`' journal entries as they are — `docs/plan/** merge=ours`, and `merge=union` for `docs/plan/*.notes.md` and `docs/CHANGELOG.md` — and **define no driver in the clone** ([ADR-0082](../../../docs/adr/0082-lanes-on-one-machine-and-one-main.md), lanes on one machine and one `main`). A lane merge then keeps both sides of the notes and the changelog and conflicts on the ledger rather than dropping a side. The merge from the starter is the one that keeps the fork's journal, by defining both drivers on its own command line: `git -c merge.ours.driver=true -c merge.union.driver=true merge starter/main`, as [`docs/forking.md`](../../../docs/forking.md) says, and it is followed by `git diff --name-only --no-renames --diff-filter=A ORIG_HEAD starter/main -- docs/plan | xargs -r git rm -qf --ignore-unmatch`, which removes every journal file the merge brought — the plans, notes files and lane files the starter added, since a new file arrives with any merge whatever the attributes say, and a plan or notes file the fork deleted that the starter changed, which comes back as a modify/delete conflict ([ADR-0084](../../../docs/adr/0084-fork-readiness.md), fork readiness) — before the merge is committed and before `pnpm docs:check` or `pnpm lanes` runs. Neither driver is ever defined in the clone's or a global config: a `merge.ours.driver` would make every lane merge keep its own ledger, and a `merge.union.driver` its own notes and changelog, each silently dropping the other lane's.
- Leave `docs/adr/` alone in a fork. In `--empty` mode write `docs/adr/template.md` and a `docs/adr/README.md` holding the conventions, an empty topic table and an empty index.
- Regenerate the digests: `pnpm rules:digest`. In `--empty` mode there are no records to cite yet, and the generator drops every rule whose records the corpus does not hold, so each area renders empty. The rule lines themselves live in `scripts/rules-digest.mjs`: a fork adds its own as it writes the records they come from.

## 3. The remote, the name and the licence

- `git remote add starter <the starter's URL>` if it is missing, and `git fetch starter`. This is what makes an upstream merge a merge; see [`docs/forking.md`](../../../docs/forking.md).
- Rename: `node scripts/rename.mjs --dry-run <name>` first, read the diff, then without the flag; it formats the files it rewrites. One identifier per side, every cookie, storage key and token audience derived from it.
- Replace `LICENSE` with the fork's own, and set the root manifest's `name` and `license`.

## 4. Prove it works before handing back

- **The skill ends on `pnpm docs:check` and `pnpm test:scripts` green**, not on hand edits: `docs:check` prints the fork's prefix, not `starter`, and finds no broken link in the carried documents. A red here is fixed in the script or the document it names, and the two are run again.
- `git check-attr merge docs/plan/README.md docs/CHANGELOG.md` prints `merge: ours` for the ledger and `merge: union` for the changelog, and `git config --get-regexp '^merge\.(ours|union)\.driver$'` prints nothing.
- The gate (`CLAUDE.md` §Commands) green on the untouched clone.
- The rest of the fork-day checklist that opens [`docs/forking.md`](../../../docs/forking.md) is the operator's: the Renovate app, branch protection, the deploy's required variables. Name what is left of it in the report.
- `/scope` writes the first row with the number and title the operator names, and once the operator moves that row to `in progress`, `/step` starts its first step without an error. Say so explicitly in the report — that is the acceptance for this skill.

Never: edit an inherited record (a fork supersedes — [ADR-0065](../../../docs/adr/0065-starter-lifecycle.md), the starter lifecycle); renumber the inherited corpus; carry the starter's plan prose into the new ledger; open a deliverable row yourself — that is the operator's decision.
