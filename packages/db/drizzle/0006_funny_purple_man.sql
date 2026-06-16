ALTER TABLE "books" ADD COLUMN "mature_content" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "mature_content_default" boolean DEFAULT false NOT NULL;