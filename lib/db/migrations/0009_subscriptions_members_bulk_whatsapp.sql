CREATE TABLE "hbs_company_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_user_id" text NOT NULL,
	"member_user_id" text,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "hbs_company_members_role_check" CHECK ("hbs_company_members"."role" in ('hr', 'finance', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "hbs_request_employees" (
	"request_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"item_status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_request_employees_pk" PRIMARY KEY("request_id","employee_id"),
	CONSTRAINT "hbs_request_employees_status_check" CHECK ("hbs_request_employees"."item_status" in ('pending', 'in_progress', 'done', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "hbs_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"price_halalas" integer NOT NULL,
	"employee_cap" integer,
	"requests_per_month" integer,
	"auto_renewals" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_plans_price_check" CHECK ("hbs_plans"."price_halalas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hbs_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renews_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"auto_renew_requests" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_subscriptions_status_check" CHECK ("hbs_subscriptions"."status" in ('active', 'past_due', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "hbs_whatsapp_inbound" (
	"wa_message_id" text PRIMARY KEY NOT NULL,
	"from_phone" text NOT NULL,
	"user_id" text,
	"request_id" integer,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled" text NOT NULL,
	CONSTRAINT "hbs_whatsapp_inbound_handled_check" CHECK ("hbs_whatsapp_inbound"."handled" in ('request_message', 'inquiry', 'unmatched', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "hbs_invoices" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD COLUMN "subscription_id" integer;--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD COLUMN "unit_amount_halalas" integer;--> statement-breakpoint
ALTER TABLE "hbs_customer_settings" ADD COLUMN "last_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hbs_company_members" ADD CONSTRAINT "hbs_company_members_company_user_id_hbs_companies_user_id_fk" FOREIGN KEY ("company_user_id") REFERENCES "public"."hbs_companies"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_request_employees" ADD CONSTRAINT "hbs_request_employees_request_id_hbs_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hbs_service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_request_employees" ADD CONSTRAINT "hbs_request_employees_employee_id_hbs_company_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hbs_company_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_subscriptions" ADD CONSTRAINT "hbs_subscriptions_plan_id_hbs_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."hbs_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_company_members_company_email_unique" ON "hbs_company_members" USING btree ("company_user_id","email");--> statement-breakpoint
CREATE INDEX "hbs_company_members_member_idx" ON "hbs_company_members" USING btree ("member_user_id");--> statement-breakpoint
CREATE INDEX "hbs_request_employees_employee_idx" ON "hbs_request_employees" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_plans_slug_unique" ON "hbs_plans" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_subscriptions_user_open_unique" ON "hbs_subscriptions" USING btree ("user_id") WHERE "hbs_subscriptions"."status" in ('active', 'past_due');--> statement-breakpoint
CREATE INDEX "hbs_subscriptions_user_idx" ON "hbs_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hbs_subscriptions_renews_idx" ON "hbs_subscriptions" USING btree ("renews_at") WHERE "hbs_subscriptions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "hbs_whatsapp_inbound_user_idx" ON "hbs_whatsapp_inbound" USING btree ("user_id","received_at");--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD CONSTRAINT "hbs_invoices_subscription_id_hbs_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."hbs_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_invoices_subscription_idx" ON "hbs_invoices" USING btree ("subscription_id");--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD CONSTRAINT "hbs_invoices_quantity_check" CHECK ("hbs_invoices"."quantity" between 1 and 500 and ("hbs_invoices"."unit_amount_halalas" is null or "hbs_invoices"."unit_amount_halalas" > 0));--> statement-breakpoint
ALTER TABLE "hbs_invoices" ADD CONSTRAINT "hbs_invoices_subject_check" CHECK ("hbs_invoices"."request_id" is not null or "hbs_invoices"."subscription_id" is not null);