ALTER TABLE "books" DROP CONSTRAINT "books_style_preset_id_style_presets_id_fk";
--> statement-breakpoint
DROP INDEX "scenes_book_global_idx";--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_style_preset_id_style_presets_id_fk" FOREIGN KEY ("style_preset_id") REFERENCES "public"."style_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_book_global_idx_unique" UNIQUE("book_id","global_idx");