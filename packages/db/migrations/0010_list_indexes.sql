-- ADR-0060 §3 and §4: an index for every column the list allow-lists admit,
-- plus the two the last deliverable needed and never got.
--
-- **Blocking, deliberately** (ADR-0060 §5, rule 2). Each `CREATE INDEX` is the
-- plain form, which holds a `SHARE` lock — concurrent reads fine, concurrent
-- writes blocked — for the length of the build; the two `DROP INDEX`
-- statements take `ACCESS EXCLUSIVE` on their tables, briefly, and this whole
-- file is one transaction with the rest of the pending batch, so the locks are
-- held until it commits. `CREATE INDEX CONCURRENTLY` is not available inside
-- that transaction at all. Every table in this blueprint is small — `staff` is
-- a directory and `users` a seed — so the choice costs a moment on a fork's
-- first migrate. A deployment whose `users` table cannot take the lock is the
-- deployment that revisits the migrator's shape.
--
-- The two `DROP INDEX` statements rebuild `staff_created_at_idx` and
-- `users_created_at_idx` as `(created_at, id)`: the pagination key includes
-- the `id` tiebreaker `applyListQuery` appends, so the composite is the key
-- and the old single-column index was a prefix of it. They are dropped rather
-- than kept beside the composites because a `(created_at)` index is a prefix
-- of `(created_at, id)` and buys nothing the wider one does not already
-- serve.
--
-- The `gin_trgm_ops` indexes require `pg_trgm`, which `0009_pg_trgm.sql`
-- installs immediately before this file.

DROP INDEX "staff_created_at_idx";--> statement-breakpoint
DROP INDEX "users_created_at_idx";--> statement-breakpoint
CREATE INDEX "audit_events_acting_as_idx" ON "audit_events" USING btree ("acting_as_type","acting_as_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "sessions_impersonated_by_staff_id_idx" ON "sessions" USING btree ("impersonated_by_staff_id") WHERE "sessions"."impersonated_by_staff_id" is not null;--> statement-breakpoint
CREATE INDEX "staff_updated_at_idx" ON "staff" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "staff_first_name_idx" ON "staff" USING btree ("first_name","id");--> statement-breakpoint
CREATE INDEX "staff_last_name_idx" ON "staff" USING btree ("last_name","id");--> statement-breakpoint
CREATE INDEX "staff_status_idx" ON "staff" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "staff_last_login_at_idx" ON "staff" USING btree ("last_login_at","id");--> statement-breakpoint
CREATE INDEX "staff_email_trgm_idx" ON "staff" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "staff_first_name_trgm_idx" ON "staff" USING gin ("first_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "staff_last_name_trgm_idx" ON "staff" USING gin ("last_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email","id");--> statement-breakpoint
CREATE INDEX "users_first_name_idx" ON "users" USING btree ("first_name","id");--> statement-breakpoint
CREATE INDEX "users_last_name_idx" ON "users" USING btree ("last_name","id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "users_last_login_at_idx" ON "users" USING btree ("last_login_at","id");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at") WHERE "users"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "users_email_trgm_idx" ON "users" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_first_name_trgm_idx" ON "users" USING gin ("first_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_last_name_trgm_idx" ON "users" USING gin ("last_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "staff_created_at_idx" ON "staff" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at","id");