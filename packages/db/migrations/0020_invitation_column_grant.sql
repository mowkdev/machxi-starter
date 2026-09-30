-- Custom migration (ADR-0078 §4 as amended at `D29.7`, ADR-0061 §2's
-- pattern): the application role may stamp an invitation, and change nothing
-- else about it.
--
-- `0019`'s consume policies (`organization_invitations_invitee_consume`,
-- `_bearer_consume`) are `FOR UPDATE` with `USING` alone, so their check
-- reuses the same expression: a transaction that can see an invitation by its
-- address or its token's hash could rewrite `organization_id` or `role` while
-- keeping the column it was admitted by. No path does that; after this file,
-- none can. The only UPDATE the API issues on this table stamps one of the
-- three terminal columns and `updated_at` (`invitations.repository.ts`).
--
-- A column-level grant, not a policy: row-level security decides which rows,
-- privileges decide which columns. The table-level UPDATE that `0008`'s
-- blanket grant gave is revoked first, because a table-level privilege
-- satisfies every column and would make the column grant decorative.
--
-- **Re-issue this pair if the table is ever recreated** (ADR-0061 §2's
-- caveat): `0008`'s `ALTER DEFAULT PRIVILEGES` grants the application role
-- every write on every table the owner creates, so a recreated
-- `organization_invitations` would come back with UPDATE on every column.
--
-- **Blocking, briefly** (ADR-0060 §5). `GRANT` and `REVOKE` take a lock on the
-- table's catalogue row and read no rows, so an invitation write waits for as
-- long as the statement's own bookkeeping and no longer, whatever the table's
-- size.
REVOKE UPDATE ON organization_invitations FROM machxi_app;--> statement-breakpoint
GRANT UPDATE (accepted_at, declined_at, revoked_at, updated_at) ON organization_invitations TO machxi_app;--> statement-breakpoint

-- The post-condition, as `0008` checks its own: a grant the migrating role
-- could not give is a warning and a commit, not an error.
DO $$
BEGIN
  IF has_table_privilege('machxi_app', 'organization_invitations', 'UPDATE')
     OR has_column_privilege('machxi_app', 'organization_invitations', 'organization_id', 'UPDATE')
     OR has_column_privilege('machxi_app', 'organization_invitations', 'role', 'UPDATE')
     OR NOT has_column_privilege('machxi_app', 'organization_invitations', 'accepted_at', 'UPDATE') THEN
    RAISE EXCEPTION
      'the column grant on organization_invitations did not take: the migrating role does not own the table (ADR-0061 §1). Run `REASSIGN OWNED BY <the role that created it> TO machxi_owner` in this database and migrate again — see docs/deploy.md.';
  END IF;
END
$$;
