-- migrate:concurrently
-- Validates `organization_invitations_one_terminal_stamp`, which `0022` added
-- `NOT VALID` (ADR-0083 §3 as amended at `D35.3`; ADR-0060 §5 as carried by
-- ADR-0078, the runner's second lane).
--
-- In the second lane so the scan does not hold `0022`'s `ACCESS EXCLUSIVE`
-- lock: `VALIDATE CONSTRAINT` takes `SHARE UPDATE EXCLUSIVE`, which lets every
-- read and write of the table through while it reads the existing rows.
-- Both statements are repeatable — the `DO` block reads, and validating a
-- constraint that is already valid does nothing — so a run that fails part-way
-- reruns this file from the top.
--
-- The `DO` block names an offending row before Postgres's own message would
-- name only the constraint. It can fire only on a database a fork's own code
-- wrote two stamps into; the repair is theirs to choose (which stamp ended
-- the invitation), and it is deliberately not a silent backfill. Until it is
-- repaired the constraint still refuses every new write that breaks it.
DO $$
DECLARE
  offending bigint;
  sample text;
BEGIN
  SELECT count(*), min(id::text) INTO offending, sample
  FROM organization_invitations
  WHERE num_nonnulls(accepted_at, declined_at, revoked_at) > 1;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'organization_invitations_one_terminal_stamp: % invitation(s) carry more than one of accepted_at, declined_at and revoked_at (for example %). Keep the stamp that ended each one, clear the others, then re-run the migration.',
      offending, sample
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "organization_invitations" VALIDATE CONSTRAINT "organization_invitations_one_terminal_stamp";
