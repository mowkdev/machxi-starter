---
paths:
  - "apps/api/**"
  - "packages/contracts/**"
  - "packages/db/**"
  - "packages/crypto/**"
  - "packages/logger/**"
---

# API and data — load the digest

**Read [`docs/rules/api-and-data.md`](../../docs/rules/api-and-data.md) before writing code here.** It is the generated statement of the rules currently in force for the API and its data packages, each line naming the record it comes from. Open a record when a line is not enough; the records in `docs/adr/` are the source of truth and the digest is derived from them.

**A behaviour change updates its spec.** The capability's file in [`docs/specs/`](../../docs/specs/) states what a client observes on the wire — requirements with scenarios, each citing its record and the test that proves it — and it changes in the same step as the behaviour, or is written when the capability has none (ADR-0068, behaviour specs).

`/api-conventions` is the fuller working reference; `/new-api-module`, `/add-endpoint`, `/db-schema-change` and `/postman-sync` are the checklists.

Which amendment window is open, and which records are in force, is stated in one place: [the ledger](../../docs/plan/README.md#the-window). Do not restate it here.
