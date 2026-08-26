---
name: step
description: Build the next unchecked step of the in-progress deliverable — implement, gate green, one bounded diff review, commit (ADR-0050). Use as "/step" for the next pending step, or "/step D8.3" for a specific one.
---

# Build step $ARGUMENTS

One step, end to end, in this session. The deliverable must be `in progress` in `docs/plan/README.md`; if it is `planned`, stop and ask the operator to open it (moving the row is their decision).

1. **Orient**: read the step's entry in the deliverable's plan file and every ADR its **ADRs:** line names. If the step's head accepts a `proposed` ADR, do that first: flip its status, move the superseded parent to `superseded by`, update the index — then build.
2. **Implement.** Use the domain skills (`/api-conventions`, `/frontend-conventions`, `/new-api-module`, `/new-resource-ui`, `/ui-component`, `/db-schema-change`) and the builder agents where they fit. Where the plan or an ADR turns out to be wrong against reality, **amend it in place, labelled** `**Amended YYYY-MM-DD (D<n>.<step>).**` — the window is open while the deliverable is in progress; a corrected record is the system working, not a failure to report.
3. **Gate**: `pnpm check` as the inner loop; the step ends green on `pnpm lint && pnpm check-types && pnpm test` (Postgres up). New endpoints get integration tests and Postman entries; UI geometry gets structural assertions where the done-when names them.
4. **Review — one pass, bounded**: with the gate green, have one reviewer (the `code-reviewer`-style agent, or `adr-reviewer` for ADR-heavy steps, or `security-reviewer` for auth/config surfaces) read the **diff**: correctness findings only, at most a handful, ranked. Fix what is confirmed; log the rest in the commit message or plan notes. **No re-review round, no zero-finding requirement.**
5. **Close the step**: tick its checkbox in the plan, record anything "pending operator acceptance" (browser-only geometry) honestly, and commit by explicit path with a conventional message naming the step (`feat(admin): … (D8.3)`).
6. Report: what was built, gate results verbatim, review findings and their fates, what the operator should eyeball.

Never: start a step gated on an unaccepted ADR without accepting it at the head; batch several steps into one invocation unless the operator asked; loop reviews.
