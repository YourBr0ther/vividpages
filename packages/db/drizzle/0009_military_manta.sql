CREATE TABLE "character_appearance_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"type" text NOT NULL,
	"descriptor" text NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"scene_mentions" integer DEFAULT 0 NOT NULL,
	"image_object_key" text,
	"thumb_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "body_model" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "wardrobe_upgraded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "illustration_points" ADD COLUMN "character_states" jsonb;--> statement-breakpoint
ALTER TABLE "character_appearance_states" ADD CONSTRAINT "character_appearance_states_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_appearance_states_character_idx" ON "character_appearance_states" USING btree ("character_id");