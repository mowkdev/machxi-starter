# Upstreaming a feature back to the starter

A fork builds something generic. This is how it gets into the blueprint. The decision is [ADR-0065](adr/0065-starter-lifecycle.md) §4 (the starter lifecycle); the way out is [`forking.md`](forking.md).

## The rule

**Re-implementation, never a cherry-pick.** The feature travels back as a branch off `starter/main`, built through `/scope` and `/step` as its own deliverable — its own plan, its own records where it decides something, its own gate run, its own review pass. **The fork's diff is the specification, not the patch.**

This is slower per feature than `git cherry-pick`, deliberately. Most commits worth upstreaming are not code-only: in this repository's own history, well over a third of content commits touch `docs/` and code together, so a cherry-pick carries a fork's plan prose, its step numbering and its domain nouns into the blueprint, where none of them mean anything. The alternative — litigating "is this one code-only?" per commit — is a rule nobody applies twice the same way.

## The test for "generic"

A feature is generic when both are true:

1. **No fork domain nouns.** Not in identifiers, not in copy, not in table names, not in the tests. If the feature knows what an "invoice" or a "shipment" is, it is the fork's.
2. **No reference to the fork's own records or plan steps.** A comment citing the fork's ADR-0080, or a test named after `D7.3` of the fork's ledger, means the reasoning does not travel.

A feature that fails either is fork-specific **until somebody does the work to make it not** — which is a real piece of work, usually the parameterisation the starter's platform packages already show how to do: the thing that varies becomes an argument, and the domain noun stays in the fork.

## The recipe

1. **Decide it is generic** against the test above. Say which of the two it passes uneasily; that is where the review will look.
2. **Open a deliverable in the starter.** `/scope` from the fork's diff as the specification — the goal in one line, constraints, the records it touches, and steps whose done-whens are commands and test names. The scope should read as if the feature had been designed here, because after this it was.
3. **Records first.** Where the feature decides something the corpus does not already decide, write the record and accept it at the head of the step that builds it. Where it diverges from an inherited decision, write the superseding record and state the delta — never edit the parent.
4. **Build it with `/step`.** The fork's implementation is a reference to read, not a patch to apply: names, layering and tests follow the starter's own conventions, and the digests in [`rules/`](rules/) are what "the starter's conventions" currently means.
5. **Ship it.** `/ship` runs the definition of done, regenerates the digests, tags `starter-D<n>` and writes the changelog entry.
6. **Merge it back down.** In the fork, `git fetch starter && git merge starter/main`, then delete the fork's own implementation in favour of the upstream one — in one commit, so the fork's history says plainly which version it is on.

## What not to send

- Anything whose only justification is "we already wrote it".
- A feature that needs a fork's schema to be useful. The seam usually is worth upstreaming even when the feature is not: the port, the parameter, the door.
- Configuration, credentials, brand copy or fixtures. The starter's brand seams take a name; they do not take yours.
