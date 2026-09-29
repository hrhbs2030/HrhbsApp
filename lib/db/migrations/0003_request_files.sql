CREATE TABLE "hbs_request_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploader_role" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_reason" text,
	CONSTRAINT "hbs_request_files_role_check" CHECK ("hbs_request_files"."uploader_role" in ('customer', 'office')),
	CONSTRAINT "hbs_request_files_type_check" CHECK ("hbs_request_files"."content_type" in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "hbs_request_files_size_check" CHECK ("hbs_request_files"."size_bytes" > 0 and "hbs_request_files"."size_bytes" <= 10485760),
	CONSTRAINT "hbs_request_files_deleted_reason_check" CHECK ("hbs_request_files"."deleted_reason" is null or "hbs_request_files"."deleted_reason" in ('uploader', 'office', 'retention'))
);
--> statement-breakpoint
ALTER TABLE "hbs_request_files" ADD CONSTRAINT "hbs_request_files_request_id_hbs_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hbs_service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_request_files_request_idx" ON "hbs_request_files" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_request_files_storage_key_unique" ON "hbs_request_files" USING btree ("storage_key");