CREATE TABLE "illustration_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"char_offset" integer NOT NULL,
	"anchor_quote" text NOT NULL,
	"moment_description" text NOT NULL,
	"present_character_ids" text[] DEFAULT '{}'::uuid[] NOT NULL,
	"score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "illustration_points" ADD CONSTRAINT "illustration_points_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "illustration_points" ADD CONSTRAINT "illustration_points_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "illustration_points_chapter_idx_unique" ON "illustration_points" USING btree ("chapter_id","idx");--> statement-breakpoint
CREATE INDEX "illustration_points_book_idx" ON "illustration_points" USING btree ("book_id");