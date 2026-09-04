# Changelog

One entry per **shipped deliverable** — the unit of work this repository ships ([ADR-0025](adr/0025-deliverables.md), deliverables) — written by `/ship` from the plan's goal line. Not per commit, and not semver: a fork says which starter it is on by naming a tag, and from the deliverable that decided this on, every entry carries an annotated tag `starter-D<n>` on its shipping commit — the entries below predate it ([ADR-0065](adr/0065-starter-lifecycle.md) §2, the starter lifecycle).

The ledger in [`plan/README.md`](plan/README.md) carries the full story of each — how it opened, what moved in its window, and on what evidence it closed.

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
