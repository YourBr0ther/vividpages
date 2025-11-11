CREATE TABLE IF NOT EXISTS "character_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"change_type" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"prompt_modifier" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "character_embeddings_character_id_unique" UNIQUE("character_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vivid_page_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"aliases" text[],
	"initial_appearance" jsonb NOT NULL,
	"reference_image_path" varchar(1000),
	"role" varchar(50),
	"first_appearance_scene" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "setting_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "setting_embeddings_setting_id_unique" UNIQUE("setting_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vivid_page_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"visual_keywords" text[],
	"first_appearance_scene" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_changes_character_id" ON "character_changes" ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_changes_scene_id" ON "character_changes" ("scene_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_character_embeddings_character_id" ON "character_embeddings" ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_characters_vivid_page_id" ON "characters" ("vivid_page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_characters_name" ON "characters" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_setting_embeddings_setting_id" ON "setting_embeddings" ("setting_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settings_vivid_page_id" ON "settings" ("vivid_page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settings_name" ON "settings" ("name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_changes" ADD CONSTRAINT "character_changes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_changes" ADD CONSTRAINT "character_changes_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_embeddings" ADD CONSTRAINT "character_embeddings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_vivid_page_id_vivid_pages_id_fk" FOREIGN KEY ("vivid_page_id") REFERENCES "vivid_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_first_appearance_scene_scenes_id_fk" FOREIGN KEY ("first_appearance_scene") REFERENCES "scenes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "setting_embeddings" ADD CONSTRAINT "setting_embeddings_setting_id_settings_id_fk" FOREIGN KEY ("setting_id") REFERENCES "settings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_vivid_page_id_vivid_pages_id_fk" FOREIGN KEY ("vivid_page_id") REFERENCES "vivid_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settings" ADD CONSTRAINT "settings_first_appearance_scene_scenes_id_fk" FOREIGN KEY ("first_appearance_scene") REFERENCES "scenes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Create HNSW indexes for vector similarity search
CREATE INDEX IF NOT EXISTS "idx_character_embeddings_vector" ON "character_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_setting_embeddings_vector" ON "setting_embeddings" USING hnsw ("embedding" vector_cosine_ops);
