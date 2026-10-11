CREATE TABLE "hbs_notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"quiet_start" smallint,
	"quiet_end" smallint,
	"digest" text DEFAULT 'instant' NOT NULL,
	"muted_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_notification_preferences_quiet_start_check" CHECK ("hbs_notification_preferences"."quiet_start" is null or ("hbs_notification_preferences"."quiet_start" between 0 and 23)),
	CONSTRAINT "hbs_notification_preferences_quiet_end_check" CHECK ("hbs_notification_preferences"."quiet_end" is null or ("hbs_notification_preferences"."quiet_end" between 0 and 23)),
	CONSTRAINT "hbs_notification_preferences_digest_check" CHECK ("hbs_notification_preferences"."digest" in ('instant', 'daily'))
);
--> statement-breakpoint
CREATE TABLE "hbs_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"audience" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"path" text,
	"priority" text NOT NULL,
	"group_key" text,
	"count" integer DEFAULT 1 NOT NULL,
	"target_type" text,
	"target_id" text,
	"dedupe_key" text,
	"deliver_after" timestamp with time zone,
	"delivered" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"digested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "hbs_notifications_audience_check" CHECK ("hbs_notifications"."audience" in ('customer', 'office')),
	CONSTRAINT "hbs_notifications_priority_check" CHECK ("hbs_notifications"."priority" in ('urgent', 'high', 'normal', 'low'))
);
--> statement-breakpoint
CREATE TABLE "hbs_push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "hbs_notifications_user_created_idx" ON "hbs_notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hbs_notifications_user_unread_idx" ON "hbs_notifications" USING btree ("user_id") WHERE "hbs_notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_notifications_dedupe_unique" ON "hbs_notifications" USING btree ("dedupe_key") WHERE "hbs_notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "hbs_notifications_deliver_after_idx" ON "hbs_notifications" USING btree ("deliver_after") WHERE "hbs_notifications"."deliver_after" is not null and "hbs_notifications"."digested_at" is null;--> statement-breakpoint
CREATE INDEX "hbs_push_subscriptions_user_idx" ON "hbs_push_subscriptions" USING btree ("user_id");