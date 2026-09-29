CREATE TABLE "hbs_request_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" integer,
	"object_path" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hbs_approved_information" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_title" text NOT NULL,
	"draft_content" text NOT NULL,
	"published_title" text,
	"published_content" text,
	"reviewed_at" timestamp with time zone,
	"published_reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hbs_approved_information_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"information_id" integer NOT NULL,
	"action" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "customer_message" text;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "client_request_id" text;--> statement-breakpoint
ALTER TABLE "hbs_request_attachments" ADD CONSTRAINT "hbs_request_attachments_request_id_hbs_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hbs_service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_approved_information_history" ADD CONSTRAINT "hbs_approved_information_history_information_id_hbs_approved_information_id_fk" FOREIGN KEY ("information_id") REFERENCES "public"."hbs_approved_information"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_request_attachments_request_idx" ON "hbs_request_attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "hbs_request_attachments_user_idx" ON "hbs_request_attachments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_request_attachments_path_unique" ON "hbs_request_attachments" USING btree ("object_path");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_service_requests_user_client_request_idx" ON "hbs_service_requests" USING btree ("user_id","client_request_id");