ALTER TABLE "hbs_service_requests" ADD COLUMN "quote_halalas" integer;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "quote_note" text;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "quoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "quote_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "quote_declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "quoted_by" text;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "document_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hbs_request_attachments" ADD COLUMN "checklist_key" text;--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD COLUMN "reminder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD CONSTRAINT "hbs_service_requests_quote_check" CHECK ("hbs_service_requests"."quote_halalas" is null or "hbs_service_requests"."quote_halalas" > 0);