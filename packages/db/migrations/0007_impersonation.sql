CREATE TABLE "impersonation_handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "impersonation_handoffs_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "impersonated_by_staff_id" uuid;--> statement-breakpoint
CREATE INDEX "impersonation_handoffs_expires_at_idx" ON "impersonation_handoffs" USING btree ("expires_at");