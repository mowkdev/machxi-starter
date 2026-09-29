# ADR-0077: Shared composition, second wave — the session in the kit, `@repo/account`, and a feature slice as a door (supersedes ADR-0062, 0051, 0045 and 0053 in part — deltas)

- Status: accepted
- Date: 2026-09-29
- Supersedes (each at the step that makes its delta true): [ADR-0062](0062-frontend-build-and-shared-composition.md) as carried by [ADR-0073](0073-review-hardening.md) and [ADR-0076](0076-the-native-compiler.md) (delta: §1's contents of `@repo/app-kit`, and the `D14.8` amendment's list of what stays in the apps — the session provider, the principal cache and the root's join move in; the rule that the kit learns no route name, resource name or policy stands); [ADR-0051](0051-platform-extraction.md) as carried by ADR-0062 (deltas: an eighth platform package, `@repo/account`; "`features` and `entities` stay strictly per-app" narrows to the features and entities no second app repeats; a feature package's door is a feature slice); [ADR-0045](0045-user-settings.md) as carried by [ADR-0053](0053-account-area.md) (delta: §The client's home — the settings entity, its writer and its gate live in `@repo/account`); [ADR-0053](0053-account-area.md) (delta: §5's homes — the profile, password, theme, locale and density features live in `@repo/account`). Every parent stands for everything not named here.

> Written 2026-09-29 by `/scope` for D22 ([`docs/plan/0022-shared-composition.md`](../plan/0022-shared-composition.md)), from `FE-01` and `FE-04` of [the 2026-09-13 review](../reviews/2026-09-13-repo-review.md) as re-measured by [the 2026-09-21 review](../reviews/2026-09-21-repo-review.md) — writing is not opening, opening is not accepting. `proposed` at writing; **accepted 2026-09-29 at the head of `D22.1`**, where [ADR-0062](0062-frontend-build-and-shared-composition.md) moved to `superseded by` for §1's delta; [ADR-0051](0051-platform-extraction.md), [ADR-0045](0045-user-settings.md) and [ADR-0053](0053-account-area.md) move at `D22.2`, the step that makes their deltas true. Amendable in place, labelled, while D22 is `in progress` (ADR-0025 rule 2). Three decisions are the operator's, taken at scoping: §2's home for the settings client, §3's door, and what §5 declines.

## Context

ADR-0062 gave the composition an owner and stopped at the line its `D14.8` amendment drew: whatever is built from an app's entities, segment, policy or route tree stays in the app. Two reviews measured what that line left behind. More than half of the same-path file pairs in the two SPAs are near-identical, their test pairs with them, and the pairs are the ones a fork edits first: session boot, settings hydration, password reset, the profile forms and the three preference cards. Read side by side, the session providers differ in the segment and one sentence; the settings providers differ in whether a grid preference adapter is mounted; the principal caches differ in what the key is made of. Each difference is a value.

The second half is `FE-04`: `@repo/grid` and `@repo/form` are certified by suites that live behind the admin's doors, so a fork that drops the admin, or a change made from a package's own suite, loses the proof. `D28.10` measured the same fact from the other side: every admin worker re-transforms the seven source-only packages, and pre-bundling them is not a configuration change.

## Decision

### 1. `@repo/app-kit` takes the session, the principal cache and the root's join

The kit gains the session provider with its unreachable notice, the principal-cache boundary, and the root composition that orders the providers. Each is parameterised by what differed: the segment, the notice's sentence, the function that derives the cache key from a principal, and slots for the providers the kit does not own. **The kit still learns no route name, no resource name and no policy.** The router, the route tree and `test/render` stay in the apps, as `D14.8` decided.

### 2. `@repo/account`, a feature package

An eighth platform package holds the account's client: the settings entity with its coalescing writer, the settings gate, the theme, locale and density cards, the password-reset forms and their hook, and the parts of the profile features both segments share. It is the first package that names a resource, and it names the account's own — settings, profile, credentials — and no other. The grid preference adapter is a parameter the admin passes; the package does not depend on `@repo/grid`. What one segment alone has stays in that app: email change, account deletion, sign-in methods, staff invalidation.

It ships its own namespace under [ADR-0046](0046-interface-localization.md) §13 as carried, composed at `init`. Navigation leaves the package as callbacks and rendered children, because `Link` types `to` against the app's route tree (ADR-0062, amended `D14.8`). It depends downward only, and on `@repo/app-kit` never.

### 3. A feature package's door is a feature slice

The app reaches `@repo/account` through the feature and entity slices that held the code: `features/profile-manage`, `features/auth`, the three card slices and `entities/settings` become index files that re-export and bind the app's values. ADR-0049's layer order and public-API rule are untouched, and a page's imports do not change. `doorRules` learns a door outside `shared/`; the invariant is ADR-0051's — a door is exempt from its own groups and from no others.

### 4. A package's behaviour is certified in the package

The door-level suites for the grid and the form move into `@repo/grid` and `@repo/form` on `@repo/app-kit/testing`, and the suites for what §1 and §2 move go with their code. Each door keeps one smoke test proving the binding. This applies ADR-0051 §Consequences' "tests move with their code"; the delta is that a door's own suite is a smoke test and no more.

### 5. What this record declines

The invitation screen's status node (`D28.8`) stays as built: the roles the spec promises hold, and the finding is uncertain without a screen reader. The sidebar and the dashboard layout stay per app, because they differ.

## Consequences

- A fix to session boot, settings hydration or the reset flow lands once. A fork starts from two packages, a route tree and a dictionary.
- Upgrade coupling widens, as ADR-0051 accepted: a change to the account package is a change to every consumer.
- Both bundles are measured at every step that moves code. The customer's entry must not gain the grid.
- The admin unit tier loses the suites that were its bill; the step that moves them records the tier's duration before and after.
- The specs under `docs/specs/` that name a moved test file are updated in the diff that moves it ([ADR-0068](0068-behaviour-specs-and-plan-notes.md) §1).

## Alternatives considered

- **All four providers in the kit**, as the ledger row first worded it. The kit would learn the settings resource, and the rule that makes its boundary checkable would be withdrawn for one provider.
- **A `shared/account` door.** It keeps the door rule unchanged and makes pages import features from `shared/`, which inverts the layer order for every reader after.
- **Generating the duplicated files** from templates. It fixes the first copy and leaves every later fix to be made twice.
- **One merged SPA.** Rejected by ADR-0062 for reasons that stand.
