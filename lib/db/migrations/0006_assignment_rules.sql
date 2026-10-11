CREATE TABLE "hbs_assignment_rules" (
	"category" text PRIMARY KEY NOT NULL,
	"assignee" text,
	"due_days" integer,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_assignment_rules_category_check" CHECK ("hbs_assignment_rules"."category" in ('passports', 'labor', 'business', 'other')),
	CONSTRAINT "hbs_assignment_rules_days_check" CHECK ("hbs_assignment_rules"."due_days" is null or "hbs_assignment_rules"."due_days" between 1 and 90)
);
