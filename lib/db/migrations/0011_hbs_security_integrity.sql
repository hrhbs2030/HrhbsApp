CREATE TABLE "hbs_invoice_gateway_pages" (
	"gateway_invoice_id" text PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"payment_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_paid_alerted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "hbs_customer_settings" ADD COLUMN "whatsapp_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hbs_customer_settings" ADD COLUMN "whatsapp_verification_challenge_hash" text;--> statement-breakpoint
ALTER TABLE "hbs_customer_settings" ADD COLUMN "whatsapp_verification_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_invoice_gateway_pages" ADD CONSTRAINT "hbs_invoice_gateway_pages_invoice_id_hbs_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."hbs_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_invoice_gateway_pages_invoice_idx" ON "hbs_invoice_gateway_pages" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "hbs_invoice_gateway_pages_reconcile_idx" ON "hbs_invoice_gateway_pages" USING btree ("last_checked_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_invoices_request_idempotency_unique" ON "hbs_invoices" USING btree ("request_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_customer_settings_verified_whatsapp_unique" ON "hbs_customer_settings" USING btree ("whatsapp_phone") WHERE "hbs_customer_settings"."whatsapp_verified" = true and "hbs_customer_settings"."whatsapp_phone" is not null;