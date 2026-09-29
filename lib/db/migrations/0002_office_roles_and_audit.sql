CREATE TABLE "hbs_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hbs_office_staff" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "hbs_office_staff" ADD COLUMN "added_by" text;--> statement-breakpoint
CREATE INDEX "hbs_audit_log_created_idx" ON "hbs_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_office_staff_email_unique" ON "hbs_office_staff" USING btree ("email");