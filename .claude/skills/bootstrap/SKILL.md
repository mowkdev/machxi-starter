---
name: bootstrap
description: Prepare a clone of this starter to be somebody's project — reset the journal to an empty ledger, add the `starter` remote and the merge attributes, and leave `/scope` and `/step` working on day one. Use as "/bootstrap" in a fresh fork, or "/bootstrap --empty" to start a corpus from nothing.
---

# Bootstrap $ARGUMENTS

Run once, in a clone that is about to become a project. It makes the process skills work in a repository with no history of its own: `/scope` needs a ledger, `/step` needs a row marked `in progress`, and neither exists in a fork until somebody writes them.

**Stop before doing anything if the working tree is dirty, or if `docs/plan/README.md` already lists a deliverable that is not this repository's own.** Say what you found and let the operator decide.

## 1. Decide which repository you are in

- **A fork of the starter** (`docs/adr/` holds records, `docs/plan/` holds this blueprint's deliverables) — the normal case. The records are **carried**: they stay exactly as they are, and the fork's own numbering continues after the highest inherited number. The plans are the **journal** of the repository the fork came from, and they go.
- **An empty project** (`--empty`, or `docs/adr/` has no records) — write the conventions, the template and an empty index, then the empty ledger.

## 2. The journal resets, the corpus is carried

- Delete every deliverable plan under `docs/plan/` and write a fresh `docs/plan/README.md`: the title, one sentence saying a deliverable is the unit of staged work, the empty table (`# | Title | Status | Scope in one line`), a **Rules** section, and a `## The window` section — the anchor every rule file, skill and agent links to (`docs/plan/README.md#the-window`). Copy the four rule bullets and the window section's shape from the starter's ledger; carry none of its narrative.
- Keep `.gitattributes`' `docs/plan/** merge=ours` entry and define the driver in the clone — `git config merge.ours.driver true` — so a merge from `starter/main` never pulls the blueprint's journal down and the fork's journal never travels up. Git needs the driver defined per clone; without it the attribute is inert.
- Leave `docs/adr/` alone in a fork. In `--empty` mode write `docs/adr/template.md` and a `docs/adr/README.md` holding the conventions, an empty topic table and an empty index.
- Regenerate the digests: `pnpm rules:digest`. In `--empty` mode there are no records to cite yet, and the generator drops every rule whose records the corpus does not hold, so each area renders empty. The rule lines themselves live in `scripts/rules-digest.mjs`: a fork adds its own as it writes the records they come from.

## 3. The remote, the name and the licence

- `git remote add starter <the starter's URL>` if it is missing, and `git fetch starter`. This is what makes an upstream merge a merge; see [`docs/forking.md`](../../../docs/forking.md).
- Rename: `node scripts/rename.mjs --dry-run <name>` first, read the diff, then without the flag. One identifier per side, every cookie, storage key and token audience derived from it.
- Replace `LICENSE` with the fork's own, and set the root manifest's `name` and `license`.

## 4. Prove it works before handing back

- `pnpm docs:check` and `pnpm test:scripts` green.
- The gate (`CLAUDE.md` §Commands) green on the untouched clone.
- `/scope` offers to scope the first row, and once the operator moves that row to `in progress`, `/step` starts its first step without an error. Say so explicitly in the report — that is the acceptance for this skill.

Never: edit an inherited record (a fork supersedes — [ADR-0065](../../../docs/adr/0065-starter-lifecycle.md), the starter lifecycle); renumber the inherited corpus; carry the starter's plan prose into the new ledger; open a deliverable row yourself — that is the operator's decision.
