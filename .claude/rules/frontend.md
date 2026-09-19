---
paths:
  - "apps/admin/**"
  - "apps/customer/**"
  - "packages/ui/**"
  # The behavioural machinery lives in packages rather than in an app's
  # `shared/` tree (ADR-0051, platform extraction; ADR-0062, the shared
  # composition); these rules follow the code rather than the address.
  - "packages/api-client/**"
  - "packages/app-kit/**"
  - "packages/app-services/**"
  - "packages/form/**"
  - "packages/grid/**"
  - "packages/i18n/**"
  - "packages/resource/**"
---

# Frontend and platform — load the digest

**Read [`docs/rules/frontend-and-platform.md`](../../docs/rules/frontend-and-platform.md) before writing code here.** It is the generated statement of the rules currently in force for the SPAs, `@repo/ui` and the platform packages, each line naming the record it comes from. Open a record when a line is not enough; the records in `docs/adr/` are the source of truth and the digest is derived from them.

The behaviour specs in [`docs/specs/`](../../docs/specs/) cover the API's wire behaviour first (ADR-0068, behaviour specs); a screen that consumes an endpoint reads that endpoint's spec. An SPA spec arrives only when a step names one, and the `spa-*.md` files are the ones a step has: a flow that crosses the wire and is decided on the client — a credential read out of an address, a tab opened before a request — states what a browser observes, and everything else is proved by its own suites.

`/frontend-conventions` is the fuller working reference — the package roster, the doors, the file layout and the checklists.

Which amendment window is open, and which records are in force, is stated in one place: [the ledger](../../docs/plan/README.md#the-window). Do not restate it here.
