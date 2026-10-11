CREATE TABLE "hbs_companies" (
	"user_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cr_number" text,
	"unified_number" text,
	"vat_number" text,
	"city" text,
	"address" text,
	"activity" text,
	"contact_name" text,
	"contact_phone" text,
	"notes" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hbs_company_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"full_name" text NOT NULL,
	"nationality" text,
	"occupation" text,
	"id_number" text,
	"passport_number" text,
	"iqama_expires_on" date,
	"passport_expires_on" date,
	"work_permit_expires_on" date,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_company_employees_status_check" CHECK ("hbs_company_employees"."status" in ('active', 'left'))
);
--> statement-breakpoint
CREATE TABLE "hbs_company_licenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"number" text,
	"issued_on" date,
	"expires_on" date,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_company_licenses_kind_check" CHECK ("hbs_company_licenses"."kind" in ('commercial_register', 'municipal', 'civil_defense', 'chamber', 'gosi', 'zakat_vat', 'other'))
);
--> statement-breakpoint
CREATE TABLE "hbs_request_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_request_messages_role_check" CHECK ("hbs_request_messages"."author_role" in ('customer', 'office'))
);
--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "employee_id" integer;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD COLUMN "license_id" integer;--> statement-breakpoint
ALTER TABLE "hbs_document_reminders" ADD COLUMN "employee_id" integer;--> statement-breakpoint
ALTER TABLE "hbs_document_reminders" ADD COLUMN "license_id" integer;--> statement-breakpoint
ALTER TABLE "hbs_request_messages" ADD CONSTRAINT "hbs_request_messages_request_id_hbs_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hbs_service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_company_employees_user_idx" ON "hbs_company_employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hbs_company_licenses_user_idx" ON "hbs_company_licenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hbs_request_messages_request_idx" ON "hbs_request_messages" USING btree ("request_id","created_at");--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD CONSTRAINT "hbs_service_requests_employee_id_hbs_company_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hbs_company_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_service_requests" ADD CONSTRAINT "hbs_service_requests_license_id_hbs_company_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."hbs_company_licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_document_reminders" ADD CONSTRAINT "hbs_document_reminders_employee_id_hbs_company_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hbs_company_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hbs_document_reminders" ADD CONSTRAINT "hbs_document_reminders_license_id_hbs_company_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."hbs_company_licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_document_reminders_employee_kind_unique" ON "hbs_document_reminders" USING btree ("employee_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "hbs_document_reminders_license_unique" ON "hbs_document_reminders" USING btree ("license_id");