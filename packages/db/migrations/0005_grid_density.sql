CREATE TYPE "public"."grid_density" AS ENUM('comfortable', 'compact');--> statement-breakpoint
ALTER TABLE "staff_settings" ADD COLUMN "grid_density" "grid_density" DEFAULT 'comfortable' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "grid_density" "grid_density" DEFAULT 'comfortable' NOT NULL;