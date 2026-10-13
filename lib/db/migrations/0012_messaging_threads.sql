CREATE TABLE "hbs_inquiry_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"inquiry_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"channel" text DEFAULT 'portal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_inquiry_messages_role_check" CHECK ("hbs_inquiry_messages"."author_role" in ('customer', 'office')),
	CONSTRAINT "hbs_inquiry_messages_channel_check" CHECK ("hbs_inquiry_messages"."channel" in ('portal', 'whatsapp'))
);
--> statement-breakpoint
CREATE TABLE "hbs_thread_reads" (
	"user_id" text NOT NULL,
	"thread_type" text NOT NULL,
	"thread_id" integer NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hbs_thread_reads_user_id_thread_type_thread_id_pk" PRIMARY KEY("user_id","thread_type","thread_id"),
	CONSTRAINT "hbs_thread_reads_type_check" CHECK ("hbs_thread_reads"."thread_type" in ('request', 'inquiry'))
);
--> statement-breakpoint
ALTER TABLE "hbs_request_messages" ADD COLUMN "channel" text DEFAULT 'portal' NOT NULL;--> statement-breakpoint
ALTER TABLE "hbs_inquiry_messages" ADD CONSTRAINT "hbs_inquiry_messages_inquiry_id_hbs_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."hbs_inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hbs_inquiry_messages_inquiry_idx" ON "hbs_inquiry_messages" USING btree ("inquiry_id","created_at");--> statement-breakpoint
ALTER TABLE "hbs_request_messages" ADD CONSTRAINT "hbs_request_messages_channel_check" CHECK ("hbs_request_messages"."channel" in ('portal', 'whatsapp'));