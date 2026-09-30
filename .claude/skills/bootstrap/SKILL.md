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

- **Choose the fork's tag prefix first.** `/ship` tags each deliverable `<prefix>-D<n>`, and the prefix is the repository's own tag namespace ([ADR-0081](../../../docs/adr/0081-build-versions.md), build versions). Take it from the arguments (`/bootstrap --prefix acme`) or ask the operator, offering the name the rename below will use. It is a lowercase name — a letter, then letters, digits or hyphens — and never `v` followed by a digit, whose `v2-D1` would match the `v[0-9]*` release tags a build takes its label from. **Refuse `starter`**: that namespace is the starter's, and a fork tag of the same name collides with the one `git fetch starter --tags` brings down.
- Delete every deliverable plan under `docs/plan/`, and every lane file `docs/plan/lanes/D<n>.md` — keep `docs/plan/lanes/README.md`, which describes the shape and keeps the directory when no lane is open — and write a fresh `docs/plan/README.md`: the title, one sentence saying a deliverable is the unit of staged work, the header line `` Tag prefix: `<prefix>` `` alone on its line above the table (`pnpm docs:check` refuses a ledger without it), the empty table (`# | Title | Status | Scope in one line`), a **Rules** section, and a `## The window` section — the anchor every rule file, skill and agent links to (`docs/plan/README.md#the-window`). Copy the four rule bullets and [the window section](../../../docs/plan/README.md#the-window)'s shape from the starter's ledger, the two markers of its generated block included, then run `pnpm lanes`, which writes that no lane is open; carry none of its narrative — not the starter's frozen history section after the window section, and not the narrative bullet's link to it.
- **Reset `docs/CHANGELOG.md`** to its title and preamble with no entries: name the fork's prefix where the preamble names `starter` as this repository's, and drop what it says about the starter's own older entries. The changelog records one repository's shipped deliverables, so the starter's entries are its journal, not the fork's; the fork reads them with `git show starter/main:docs/CHANGELOG.md`.
- Keep `.gitattributes`' journal entries as they are — `docs/plan/** merge=ours`, and `merge=union` for `docs/plan/*.notes.md` and `docs/CHANGELOG.md` — and **define no driver in the clone** ([ADR-0082](../../../docs/adr/0082-lanes-on-one-machine-and-one-main.md), lanes on one machine and one `main`). A lane merge then keeps both sides of the notes and the changelog and conflicts on the ledger rather than dropping a side. The merge from the starter is the one that keeps the fork's journal, by defining both drivers on its own command line: `git -c merge.ours.driver=true -c merge.union.driver=true merge starter/main`, as [`docs/forking.md`](../../../docs/forking.md) says, and it is followed by `git diff --name-only --diff-filter=A ORIG_HEAD -- 'docs/plan/lanes/D*.md' | xargs -r git rm -q`, which drops the lane files of the starter's open lanes that the merge added — a new file arrives with any merge, whatever the attributes say — before `pnpm docs:check` or `pnpm lanes` runs. Neither driver is ever defined in the clone's or a global config: a `merge.ours.driver` would make every lane merge keep its own ledger, and a `merge.union.driver` its own notes and changelog, each silently dropping the other lane's.
- Leave `docs/adr/` alone in a fork. In `--empty` mode write `docs/adr/template.md` and a `docs/adr/README.md` holding the conventions, an empty topic table and an empty index.
- Regenerate the digests: `pnpm rules:digest`. In `--empty` mode there are no records to cite yet, and the generator drops every rule whose records the corpus does not hold, so each area renders empty. The rule lines themselves live in `scripts/rules-digest.mjs`: a fork adds its own as it writes the records they come from.

## 3. The remote, the name and the licence

- `git remote add starter <the starter's URL>` if it is missing, and `git fetch starter`. This is what makes an upstream merge a merge; see [`docs/forking.md`](../../../docs/forking.md).
- Rename: `node scripts/rename.mjs --dry-run <name>` first, read the diff, then without the flag. One identifier per side, every cookie, storage key and token audience derived from it.
- Replace `LICENSE` with the fork's own, and set the root manifest's `name` and `license`.

## 4. Prove it works before handing back

- `pnpm docs:check` and `pnpm test:scripts` green; `docs:check` prints the fork's prefix, not `starter`.
- `git check-attr merge docs/plan/README.md docs/CHANGELOG.md` prints `merge: ours` for the ledger and `merge: union` for the changelog, and `git config --get-regexp '^merge\.(ours|union)\.driver$'` prints nothing.
- The gate (`CLAUDE.md` §Commands) green on the untouched clone.
- `/scope` offers to scope the first row, and once the operator moves that row to `in progress`, `/step` starts its first step without an error. Say so explicitly in the report — that is the acceptance for this skill.

Never: edit an inherited record (a fork supersedes — [ADR-0065](../../../docs/adr/0065-starter-lifecycle.md), the starter lifecycle); renumber the inherited corpus; carry the starter's plan prose into the new ledger; open a deliverable row yourself — that is the operator's decision.
