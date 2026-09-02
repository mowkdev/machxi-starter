# ADR-0065: The starter lifecycle — forking, upstreaming and the documents that travel

- Status: proposed
- Date: 2026-09-02

> Written 2026-09-02 by `/scope` for D14 ([`docs/plan/0014-starter-hardening.md`](../plan/0014-starter-hardening.md)). `proposed` at writing; accepted at the head of the step that builds it.

## Context

This repository exists to be cloned into projects and to receive generic features back. Nothing in it implements that. There are no git tags, no changelog, no forking document and no upstreaming document; every package is private and source-only ([ADR-0002](0002-monorepo-layout-and-tooling.md), _monorepo layout and tooling_), which is right for a monorepo and says nothing about how a second repository consumes it.

The lifecycle record is thinner than its parent on exactly this point. [ADR-0024](0024-adr-lifecycle.md) rule 5 said a downstream project "supersedes; it never amends" **and gave the reason**: "editing one in place turns the next merge from the blueprint into a conflict, and loses the record of which decision was deliberately dropped." [ADR-0050](0050-adr-lifecycle-and-verification.md) (_ADR lifecycle and verification_) rule 5 carries the rule and drops the reason, which leaves the one sentence about forks in the corpus reading as etiquette rather than as mechanics.

The governing documents have a second problem, and it is measurable. Window and supersession state is restated across roughly twenty-one files, and today three of them are **wrong**: `.claude/agents/ui-builder.md`, `.claude/skills/new-resource-ui/SKILL.md` and `.claude/skills/ui-component/SKILL.md` say no window is open or that D11's is, while the ledger says D13's is. The cause is mechanical — `/ship`'s sweep list (`.claude/skills/ship/SKILL.md` step 3) names the ledger, the ADR index, `docs/README.md`, `CLAUDE.md` and `.claude/rules/*`, and does not name `.claude/**` or `README.md`. `CLAUDE.md` is about 16 KB, roughly half of it supersession history that a fork inherits as somebody else's biography.

The skills cannot start an empty project: `/step` refuses unless a ledger row is `in progress`, `/scope` presumes a ledger exists, and `/step` step 4 names a "`code-reviewer`-style agent" that is not in `.claude/agents`. Citation style is inconsistent in a way that matters for portability: the frontend skills cite bare ranges ("ADRs 0030–0054") and carry step numbers and dates, while `.claude/rules/api.md` and `db-migrator.md` gloss every citation ("ADR-0006 (schema conventions)") and carry no step numbers — the second form survives a fork that renumbers nothing and re-dates everything.

And cherry-picking will not be the upstream mechanism: 108 of 249 content commits touch `docs/` and code together, so a cherry-pick carries a fork's plan prose and step numbering into the starter.

Finally: the repository is private on GitHub and has no LICENSE, which for a work meant to be copied is the one gap that is not about process.

## Decision

A **delta** on [ADR-0025](0025-deliverables.md) (_deliverables and the ADR window_) for where window state is written, and on ADR-0050 for rule 5's reasoning; additive in everything else. Neither record's decisions about windows, amendment, supersession or verification change.

### 1. Forking is a clone with a remote, not a template

A project starts as a **clone that keeps history**, adds this repository as a remote named `starter`, and merges `starter/main` periodically. History is the point: it is what makes a merge a merge.

**A fork never edits an inherited ADR — it supersedes**, and ADR-0050 rule 5 regains its parent's reason: an edit turns the next merge into a conflict and erases the record of which decision was deliberately dropped. A fork's deviations are new ADRs in its own repository, numbered from where the inherited corpus ends, referencing the record they replace.

Platform packages stay **source-only inside the monorepo** as ADR-0002 decided. A private registry is revisited when three or more forks exist; below that the cost is a build pipeline per package for a problem nobody has.

### 2. Versioning: a tag per deliverable, a changelog line per deliverable

`/ship` creates an **annotated tag `starter-D<n>`** on the shipping commit, so a fork can say which starter it is on and `git log starter-D13..starter/main` is a real question. `docs/CHANGELOG.md` gains **one entry per shipped deliverable**, written by `/ship` from the plan's goal line: deliverable number, name, ship date, goal. Not per commit, not semver — the deliverable is already this repository's unit of shipped work.

### 3. Carried versus journal

- **Carried into forks**: `docs/adr/` and `.claude/`. These are the decisions and the machinery that applies them.
- **This blueprint's journal**: `docs/plan/` and the ledger narrative. They record how *this* repository got here.

A fork **resets `docs/plan/` to its own empty ledger** and marks the directory `merge=ours` in `.gitattributes`, so starter merges never pull journal prose down and a fork's journal never travels up. `docs/forking.md` records the recipe end to end: clone, add the `starter` remote, rename per [ADR-0064](0064-brand-seams.md) (_brand seams_), reset the ledger via `/bootstrap`, add the licence.

### 4. Upstreaming is re-implementation, never a cherry-pick

A generic feature travels back as a branch off `starter/main`, **re-implemented from the fork's diff through `/scope` and `/step` as its own deliverable** — with its own plan, its own ADRs where it decides something, its own gate run. The fork's diff is the specification, not the patch.

**Generic** has a test: no fork domain nouns, and no references to the fork's ADR numbers or plan steps. A feature that fails either is fork-specific until someone does the work to make it not. `docs/upstreaming.md` records the rule and the test.

### 5. The shape of the governing documents

- **`CLAUDE.md` carries rules, commands, repo map, search and workflow only** — about 5 KB, no window history, no supersession chronology, no ship dates.
- **All window, supersession and date history lives in exactly one section of `docs/plan/README.md`**, and every rule file, skill and agent **links to it** instead of restating it. One place to be right; nowhere else to be wrong.
- **`/ship`'s sweep list gains `.claude/**` and `README.md`** — the omission that produced the three stale files.
- **In `.claude/**`, every ADR citation carries a topic gloss and never a bare range** (`ADR-0006 (schema conventions)`, not "ADRs 0030–0054"), and **no step numbers or dates appear**. That is the form a fork inherits without a footnote.
- **The gate command is defined once**, in `CLAUDE.md` §Commands, and referenced everywhere else by name.
- **Source-code comments keep their step references.** They are the reasoning attached to the code that carries it; a fork may strip them, and the starter does not sweep them.
- A **`/bootstrap` skill** writes an empty ADR index, the ADR template and an empty ledger for a fork, so `/scope` and `/step` work on day one of an empty project. `/step`'s reviewer reference is corrected to an agent that exists.
- **A current-rules digest per area, regenerated at ship.** Two ideas taken from OpenSpec at scoping (the framework itself was not adopted): `docs/rules/<area>.md` — API and data, frontend and platform, process — is a compact statement of the rules currently in force, each line naming the record it comes from, and `/ship` regenerates it as part of the sweep. Skills and agents load the digest for their area instead of the ADR chain; the ADRs remain the source of truth and the digest is derived, never edited by hand. The `.claude/rules/*.md` files become the loaders of those digests rather than restatements.
- **A measurement spike before the digests are adopted as the loading path**: one comparable step run twice in a worktree — once with the skills loading the ADR chain as today, once loading the digest — and the two input-token counts recorded in the D14 plan. The digest stays the loading path only if it is cheaper; either way the number is written down.

### 6. Licence

`"license": "UNLICENSED"` in the root manifest, and a `LICENSE` file stating that this starter and its forks are proprietary to the operator. Private on GitHub is a hosting setting; the file is the statement.

## Consequences

- A fork has a written recipe, a stated starter version, and a merge path that does not fight over ADRs or plan prose.
- Window state stops drifting because there is one copy of it, and `/ship` now sweeps everywhere it is referenced.
- `CLAUDE.md` gets materially shorter, which is context every session pays for.
- Upstreaming is slower per feature than a cherry-pick and produces a record instead of an import; that trade is deliberate.
- One-time cost: rewriting roughly twenty-one documents to link rather than restate, and the tag and changelog work `/ship` now carries.

## Alternatives considered

- **A GitHub template repository with squashed history.** Clean start, no upstream ever — the merge path is the whole reason this record exists.
- **Publishing the packages to a registry.** Fourteen build pipelines, changesets, a registry to run, and a full supersession of ADR-0002, for a problem that begins at three forks.
- **Allowing cherry-picks for code-only commits.** Most upstream candidates are not code-only, and the rule would be litigated per commit rather than applied.
- **Sweeping step references out of source comments too.** Touches most of the tree and loses the reasoning's provenance, which is where those comments earn their keep.
