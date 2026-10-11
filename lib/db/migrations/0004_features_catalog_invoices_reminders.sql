CREATE TABLE "hbs_service_offers" (
	"slug" text PRIMARY KEY NOT NULL,
	"price_halalas" integer,
	"government_fees_note" text,
	"processing_days" integer,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_service_offers_price_check" CHECK ("hbs_service_offers"."price_halalas" is null or "hbs_service_offers"."price_halalas" >= 0),
	CONSTRAINT "hbs_service_offers_days_check" CHECK ("hbs_service_offers"."processing_days" is null or "hbs_service_offers"."processing_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "hbs_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"description" text NOT NULL,
	"amount_halalas" integer NOT NULL,
	"vat_rate_basis_points" integer NOT NULL,
	"vat_halalas" integer NOT NULL,
	"total_halalas" integer NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"payment_method" text,
	"payment_reference" text,
	"gateway_invoice_id" text,
	"payment_url" text,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "hbs_invoices_status_check" CHECK ("hbs_invoices"."status" in ('issued', 'paid', 'cancelled')),
	CONSTRAINT "hbs_invoices_method_check" CHECK ("hbs_invoices"."payment_method" is null or "hbs_invoices"."payment_method" in ('manual', 'online')),
	CONSTRAINT "hbs_invoices_amount_check" CHECK ("hbs_invoices"."amount_halalas" > 0 and "hbs_invoices"."vat_halalas" >= 0 and "hbs_invoices"."total_halalas" = "hbs_invoices"."amount_halalas" + "hbs_invoices"."vat_halalas")
);
--> statement-breakpoint
CREATE TABLE "hbs_document_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"expires_on" date NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"last_reminder_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_document_reminders_kind_check" CHECK ("hbs_document_reminders"."kind" in ('iqama', 'passport', 'commercial_register', 'work_permit', 'other'))
);
--> statement-breakpoint
CREATE TABLE "hbs_customer_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"whatsapp_opt_in" boolean DEFAULT false NOT NULL,
	"whatsapp_phone" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hbs_service_requests" DROP CONSTRAINT "hbs_service_requests_status_check";--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "rating_comment" text;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD CONSTRAINT "hbs_invoices_request_id_hbs_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hbs_service_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_invoices_request_idx" ON "hbs_invoices" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_invoices_gateway_unique" ON "hbs_invoices" USING btree ("gateway_invoice_id");--> statement-breakpoint
CREATE INDEX "hbs_document_reminders_user_idx" ON "hbs_document_reminders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hbs_document_reminders_expires_idx" ON "hbs_document_reminders" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "hbs_service_requests_assigned_idx" ON "hbs_service_requests" USING btree ("assigned_to");--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD CONSTRAINT "hbs_service_requests_rating_check" CHECK ("hbs_service_requests"."rating" is null or "hbs_service_requests"."rating" between 1 and 5);--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD CONSTRAINT "hbs_service_requests_status_check" CHECK ("hbs_service_requests"."status" in ('received', 'reviewing', 'waiting_on_customer', 'submitted_to_authority', 'awaiting_payment', 'completed'));