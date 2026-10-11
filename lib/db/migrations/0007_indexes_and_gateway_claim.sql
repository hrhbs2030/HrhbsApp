ALTER TABLE "hbs_invoices" ADD COLUMN "gateway_claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "hbs_service_requests_status_updated_idx" ON "hbs_service_requests" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hbs_service_requests_created_idx" ON "hbs_service_requests" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hbs_service_requests_open_due_idx" ON "hbs_service_requests" USING btree ("due_at") WHERE "hbs_service_requests"."status" <> 'completed';--> statement-breakpoint
CREATE INDEX "hbs_request_attachments_pending_expiry_idx" ON "hbs_request_attachments" USING btree ("expires_at") WHERE "hbs_request_attachments"."request_id" is null;--> statement-breakpoint
CREATE INDEX "hbs_inquiries_linked_request_idx" ON "hbs_inquiries" USING btree ("linked_service_request_id");--> statement-breakpoint
CREATE INDEX "hbs_inquiries_status_idx" ON "hbs_inquiries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hbs_audit_log_target_idx" ON "hbs_audit_log" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hbs_invoices_status_issued_idx" ON "hbs_invoices" USING btree ("status","issued_at");