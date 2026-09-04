-- Custom migration (ADR-0067 §2): a personal organization, owned by the
-- account, for every user that already exists.
--
-- The claim this file makes true is the one the whole record rests on: **no
-- query anywhere has a "no organization" branch**. `0011` created the tables,
-- and from D15.2 every path that creates a user creates the organization in
-- the same transaction — but a database that predates those tables holds rows
-- none of those paths ever touched, and without this file the invariant would
-- be true only for accounts created after the deploy. That is the shape of
-- bug that hides for a month and then answers a switcher request with an empty
-- list.
--
-- **Idempotent by construction**, because there is no seed journal for a
-- migration either: both statements are guarded by `NOT EXISTS`, so a second
-- run inserts nothing. It is written that way rather than relying on the
-- journal so that it can also be replayed by hand against a database somebody
-- restored, and so the integration test can assert the property directly.
--
-- **Live users only** (`deleted_at is null`). A soft-deleted account has no
-- organization for the same reason it has no session: it is gone, and the
-- deletion transaction of ADR-0028 is what would have soft-deleted the
-- organization beside it. There is no restore path in this repository; the day
-- there is, it is that path's job to bring the organization back.

-- The slug is derived from the user's id, and deliberately not from their name
-- or address.
--
--   * **Deterministic**, so this file is idempotent even without the guard and
--     two concurrent runs cannot mint two different slugs for one account.
--   * **Collision-free**, so no backfill needs a retry loop against the
--     partial unique index.
--   * **It leaks nothing.** A slug is a URL segment (ADR-0067 §6) and a URL is
--     pasted into chat windows and bug reports; a slug derived from an email
--     address would put that address in every one of them, which is exactly
--     the disclosure ADR-0020 §Enumeration spends its effort avoiding.
--
-- It is ugly, and that is the right trade for an organization whose only
-- member is its owner and whose name — not its slug — is what the switcher
-- renders. A user who wants a pretty URL creates a `team` organization.
--
-- `gen_random_uuid()` is v4 where the application generates v7 (ADR-0006).
-- Deliberate: this runs once, without the driver, and a backfilled id has no
-- insertion-order property worth reproducing in SQL.
INSERT INTO organizations (id, slug, name, kind, created_by, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'personal-' || u.id::text,
  -- The account's own name when it has one, its address when it does not:
  -- both `first_name` and `last_name` are nullable on `users` (ADR-0017).
  COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email::text),
  'personal',
  u.id,
  now(),
  now()
FROM users u
WHERE u.deleted_at IS NULL
  -- `deleted_at IS NULL` on both sides of the guard, and the second half is the
  -- one that is easy to leave out. Without it a live account whose personal
  -- organization was soft-deleted is skipped forever and becomes the "no
  -- organization" branch this record says cannot exist. With it the repair is
  -- still idempotent (the second run finds the live row) and still
  -- collision-free, because `organizations_slug_active_unique` is partial: a
  -- soft-deleted row holding `personal-<uuid>` does not reserve the slug.
  AND NOT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.created_by = u.id
      AND o.kind = 'personal'
      AND o.deleted_at IS NULL
  );--> statement-breakpoint

-- The owner membership, in the same transaction as the rows above (ADR-0067
-- §2: an organization always has at least one owner, and a personal one has
-- exactly the account that owns it).
--
-- Guarded on its own rather than folded into the statement above with a
-- `RETURNING`: this file must also repair a database where the first statement
-- ran and the second did not — which is not reachable through the migration
-- runner, whose batch is one transaction, but is reachable by hand.
INSERT INTO organization_memberships (organization_id, user_id, role, created_at, updated_at)
SELECT o.id, o.created_by, 'owner', now(), now()
FROM organizations o
JOIN users u ON u.id = o.created_by
WHERE o.kind = 'personal'
  -- Live on both sides, which the statement above is too and this one has to be
  -- said separately. Once the deletion transaction of ADR-0028 soft-deletes the
  -- personal organization beside the account (ADR-0067 §2), an unfiltered
  -- replay of this file against a restored database would put the `owner` row
  -- back — a deletion request partly undone, and visible on the admin
  -- memberships list.
  AND o.deleted_at IS NULL
  AND u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships m
    WHERE m.organization_id = o.id
      AND m.user_id = o.created_by
  );
