ALTER TABLE "hbs_service_requests" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "source" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "hbs_inquiries" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "hbs_inquiries" ADD COLUMN "source" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
CREATE INDEX "hbs_whatsapp_inbound_received_idx" ON "hbs_whatsapp_inbound" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD CONSTRAINT "hbs_service_requests_source_check" CHECK ("hbs_service_requests"."source" in ('customer', 'member', 'office'));--> statement-breakpoint
ALTER TABLE "hbs_inquiries" ADD CONSTRAINT "hbs_inquiries_source_check" CHECK ("hbs_inquiries"."source" in ('customer', 'member', 'office'));