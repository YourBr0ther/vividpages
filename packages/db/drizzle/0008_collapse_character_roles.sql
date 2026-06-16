-- Collapse the 4-way character role into binary main/minor (data migration, no
-- schema change: characters.role stays a free-text column). Idempotent: the
-- old values are remapped to 'main'/'minor', and re-running is a no-op since
-- the source values no longer exist after the first apply.
UPDATE "characters" SET "role" = 'main'
  WHERE "role" IN ('protagonist', 'antagonist', 'supporting');
--> statement-breakpoint
UPDATE "characters" SET "role" = 'minor'
  WHERE "role" = 'minor';
