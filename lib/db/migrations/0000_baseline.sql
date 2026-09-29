CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hbs_service_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"service" text NOT NULL,
	"description" text NOT NULL,
	"contact_phone" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"office_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hbs_inquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"linked_service_request_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hbs_office_staff" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hbs_registration_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"reviewer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_registration_requests_status_check" CHECK ("hbs_registration_requests"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "hbs_legacy_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest" text NOT NULL,
	"exported_at" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_by" text NOT NULL,
	CONSTRAINT "hbs_legacy_imports_digest_unique" UNIQUE("digest")
);
--> statement-breakpoint
CREATE TABLE "hbs_legacy_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_id" integer NOT NULL,
	"kind" text NOT NULL,
	"legacy_id" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_inquiries" ADD CONSTRAINT "hbs_inquiries_linked_service_request_id_hbs_service_requests_id_fk" FOREIGN KEY ("linked_service_request_id") REFERENCES "public"."hbs_service_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_legacy_records" ADD CONSTRAINT "hbs_legacy_records_import_id_hbs_legacy_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."hbs_legacy_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_service_requests_user_idx" ON "hbs_service_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hbs_inquiries_user_idx" ON "hbs_inquiries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_registration_requests_user_id_unique" ON "hbs_registration_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hbs_legacy_imports_date_idx" ON "hbs_legacy_imports" USING btree ("imported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_legacy_records_source_idx" ON "hbs_legacy_records" USING btree ("import_id","kind","legacy_id");