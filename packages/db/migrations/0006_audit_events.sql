CREATE TYPE "public"."audit_actor_type" AS ENUM('staff', 'user');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"acting_as_type" "audit_actor_type",
	"acting_as_id" uuid,
	"event" text NOT NULL,
	"request_id" text,
	"ip" "inet",
	"user_agent" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_type","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_event_idx" ON "audit_events" USING btree ("event","occurred_at");