# Changelog

One entry per **shipped deliverable** — the unit of work this repository ships ([ADR-0025](adr/0025-deliverables.md), deliverables) — written by `/ship` from the plan's goal line. Not per commit, and not semver: every entry from the deliverable that decided this on carries an annotated tag `<prefix>-D<n>` on its shipping commit, the prefix named in the ledger's header — `starter` here — and the entries below that point predate it ([ADR-0065](adr/0065-starter-lifecycle.md) §2, the starter lifecycle, as carried by [ADR-0081](adr/0081-build-versions.md) §5).

**This file is journal, like [`plan/`](plan/README.md).** It records this repository's deliverables and no one else's. `.gitattributes` marks it `merge=ours`, so a merge from the starter never brings the starter's entries into a fork's, and `/bootstrap` resets it to this preamble with the fork's own prefix. A fork reads the starter's history with `git show starter/main:docs/CHANGELOG.md`, and says which starter it is on by naming a `starter-D<n>` tag.

The ledger in [`plan/README.md`](plan/README.md) carries the full story of each — how it opened, what moved in its window, and on what evidence it closed.

## D31 — Interface polish · 2026-09-30

Five changes the operator named after using both SPAs. A grid header's name is now a plain label, and its sort and filter controls sit together at the cell's end: sort is an icon button of its own, named "Sort by <header>" and showing the direction it holds. The shell's drawer toggle shows and announces whether the drawer is open. The auth screens are one centred card on a gradient drawn between two existing tokens, with each screen's ways out inside the card. The customer's "Change email" sits on the email's own row. A navigation or deep link that takes longer than a second shows a pending state, held for at least half a second so it never flickers, and the boot loader's delay runs once per page load; a static indicator in `index.html` was tried and withdrawn. Frontend only, and the first deliverable built as a lane beside another. Tag `starter-D31`.

## D30 — Parallel lanes · 2026-09-29

Deliverables whose records never meet can now be built at the same time, in separate sessions, without a second mutable copy of any record. The rule of one deliverable in progress gives way to a condition: no record belongs to two open lanes, and at most one lane adds migrations. The ledger's window section names every open lane in one shape, and `pnpm docs:check` refuses two lanes sharing a record, a second schema lane, and an entry that is malformed or missing. `/step`, `/steps` and `/ship` take the lane as their argument and refuse a bare call while more than one lane is open. A lane builds on its own branch, merging `main` in before each gate and out when green, or on `main` while it is the only lane; `/ship` runs on `main`. The rule travels with the records into a fork, and the ledger's lanes do not. Tag `starter-D30`.

## D22 — Shared composition, second wave · 2026-09-29

What the two SPAs repeated moved into packages before the starter is forked, so a fork edits a route tree and a dictionary rather than files a later merge from the starter also touches. The session, the principal cache and the root's composition now live in `@repo/app-kit`, and each app's copy is a binding. The settings client, the preference cards, password reset and the shared profile features form a new eighth platform package, `@repo/account`, which each app reaches through the feature and entity slices that held them. The grid's and the form's door-level suites live in their own packages. The kit declares its side effects and the barrel guard no longer exempts it, and the parallel unit tier runs two workspaces at a time, so its workers start on a many-core machine. Tag `starter-D22`.

## D21 — Stack majors · 2026-09-29

The queued majors, one step each so every breakage reads apart: Vitest 5, ESLint 10 with its plugin set, Vite 8 with `@vitejs/plugin-react` 6 under the bounded bundle budgets, `@types/node` at the Node 24 floor, and TypeScript 6.0 with the defaults it flips written into the presets. The TypeScript 7 spike landed: `tsc -b` runs on the native compiler (a cold `check-types` from about 50s to 15s) while the linter keeps 6.0 through an alias until `typescript-eslint` admits 7. `dotenv` left `@repo/db` for Node's own loader, so no file in the API image carries a loader package any more, and the configuration record's loading rules were brought back in line with the tree. Tag `starter-D21`.

## D28 — Review follow-ups · 2026-09-23

Every finding of the 2026-09-21 repository review that was an hour to close, closed in one wave before the stack majors land: the four gaps of one shape — a control present in one place and missing from its twin — so `i18n:check` and a nightly audit now run in the gate's first link, a held dependency is one `overrides` fact rather than nine pins and a hope, pnpm and Renovate state the same cooldown with the security-patch procedure beside it, and every accepted record is the primary citation of a digest line or the generator refuses to run. Around them: the prune's predicates indexed and its table list guarded, the session cap counting only the customer's own sessions, every credential event spending every outstanding link in one place, the policy proved on the built page, the client directive gone from `@repo/ui`, the three fragment landings and the spinner audible to a screen reader, coverage off the default unit run after measuring it as a quarter of the link, and a unit suite's cache hash covering its workspace dependencies. Tag `starter-D28`.

## D20 — Review hardening · 2026-09-21

Every finding of the 2026-09-13 repository review that was an hour or a step to close, closed in one wave so a fork inherits none of them. The runtime moves to Node 24 and pnpm 12 with the advisories cleared and every pin explained, and the gate now runs the script tests and the hygiene check it used to skip, with `check-types` no longer able to replay a green from a restored buildinfo. The API budgets argon2 per principal as well as per address, keys its limiter so a wrong proxy hop cannot collapse it into one bucket, states its timeouts, and caps each principal's live sessions, with a prune service in the reference deployment; the database holds `updated_at` and the proven-address invariant itself. The SPA images send a Content-Security-Policy and honour reduced motion, bundle ceilings are bounded at 15% over a committed baseline, the composition root is wired per module, and the four thousand-line files are split. The deliverable-sized findings are planned rows D21–D26, and the residual the gate's fix left is D27. Tag `starter-D20`.

## D19 — Sign in with Google · 2026-09-12

A person signs in to the customer app, or creates an account there, through Google: plain OpenID Connect with PKCE and no new auth library, the ID token verified with `jose` against a provider port that has a real adapter and a fake, and the callback handed to the SPA as a sixty-second fragment token bound to the browser that answered it. Resolution is by subject, then by a verified address against an active account — which Google must host for the address to link — then creation wherever self-registration is open. An account keeps its ways in under its owner's control: Google is linked and unlinked from a Sign-in methods card that replaces the password card, a passwordless account sets a password through a reset link minted by its own session, and every recovery that writes a password without the account's own authority disconnects the identities it did not predate. The three endpoints exist only where a client is configured, so a default clone answers `404` and the mount is the control. Tag `starter-D19`.

## D18 — Mail flows · 2026-09-11

Every flow that needs a mailbox, built on one mechanism: a single-use, hashed token delivered in a fragment link. A self-registered account is usable once its address is proven — registration issues no session, the link does; either population recovers a password by mail, every session ending with the reset; an invitation is delivered and accepted from its link; a person changes their own address by proving the new one, refused under impersonation; a super admin sets any account's address outright; and a staff member is onboarded from an invitation instead of a password typed by an admin. Templates are English with a locale on the seam, the SMTP adapter is the one transport, three budgets bound what an unauthenticated caller can make the API mail, and the browser tier reads its links out of Mailpit. Tag `starter-D18`.

## D17 — Impersonation in a new tab · 2026-09-09

The admin panel stays on screen while an operator acts as a customer: the Impersonate confirm opens the customer app in a tab of its own — pre-opened on the click itself, so no pop-up blocker can refuse it, with its opener disowned client-side and by the production `Cross-Origin-Opener-Policy` — and falls back to the same tab only when the open is refused. Because the panel now sits one click from a second mint, the exchange ends the impersonated session it replaces in the same browser, on the audit trail, so a stale tab meets a signed-out screen on its next authenticated request rather than silently changing identity. Tag `starter-D17`.

## D15 — Organizations · 2026-09-09

Multi-tenancy as a first-class model: organizations and memberships with a personal organization on every path, the membership guard and the scoped repositories, invitations without delivery, the admin resource built through the generator, the customer app's context switcher with the private context at the root and a team's settings area, self-service registration, and — riding in the same window — behaviour specs per capability with the plan kept apart from its build notes, and the development rate-limit profile. Tag `starter-D15`.

## D14 — Starter hardening · 2026-09-04

A very good two-app reference implementation made into a starter a project can clone, deploy and build on: a production edge (CI, images, a reference deployment, database roles, observability and mail seams), scale defaults that hold past ten thousand rows, one shared composition for both SPAs instead of two drifting copies, resource configs the compiler checks against the contracts, generators for the two shapes every feature repeats, and a mechanical way to fork the starter and bring generic features back. The first deliverable to carry a `starter-D<n>` tag.

## D13 — Customer impersonation · 2026-09-02

Staff open the customer app as a chosen customer: a minted `user` session, an audit event on every request, a banner and an exit, and credential operations refused throughout.

## D12 — Customer app · 2026-09-01

`apps/customer`, a Vite SPA over the `/user` segment, as the second consumer of the shared compositions and the platform packages — self-service v1, localized from the first screen.

## D11 — Design foundations and account area · 2026-08-31

The structural redesign ("Instrument" — tokens, grid chrome, layouts) applied through the shared packages, and `/account` with sections built in the new style.

## D10 — Data grid and admin follow-ups · 2026-08-29

Visible grid state (hot-filter chips, resize affordance, drag-and-drop column reorder, stripes), navigation felt-latency work done measure-first, a Playwright `test:e2e` tier, and the bundle budget in the gate chain.

## D9 — Platform extraction · 2026-08-28

The behavioural machinery leaves the admin app's `shared/` tree for six packages; the app becomes its first consumer through thin doors. Mechanical by design.

## D8 — App shell and record surfaces · 2026-08-27

The two compositions both SPAs are built from, designed with slots in `@repo/ui`: a slotted application shell, and one record container in modal, drawer and page variants.

## D7 — Interface localization · 2026-08-22

Every operator-facing string into a typed dictionary, with the strategy designed for both SPAs and the shared packages, and the locale persisted as an account setting.

## D6 — User settings · 2026-08-22

Server-persisted per-account settings — theme, locale and per-grid preferences behind an adapter seam — on both segments.

## D5 — Grid URL readability · 2026-08-22

The grid screens' address bar: list state in the API's own query language, and record routes that carry only the record.

## D4 — Data grid v2 · 2026-08-21

Selection and bulk actions, capability-driven toolbars, filter UX, viewport layout, edit surfaces in the URL, and persisted column settings.

## D3 — Admin panel · 2026-08-20

The staff-facing SPA over the admin segment, with its two prerequisites: `packages/ui` and the CSRF bootstrap endpoint.

## D2 — API hardening and D3 prerequisites · 2026-08-19

The gaps D1's review found, closed, plus the decisions the frontend apps could not start without.

## D1 — API foundation · 2026-08-18

A running, testable API: configuration, logging, database, migrations, seeds, both auth flows, the staff and user admin resources, and profile.
