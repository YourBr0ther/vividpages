-- Seed the built-in style presets. Idempotent: re-running (or a preset that
-- was already created by hand) is a no-op thanks to ON CONFLICT on slug.
INSERT INTO "style_presets" ("slug", "name", "prompt_fragment", "negative_fragment", "built_in")
VALUES
  (
    'painterly-fantasy',
    'Painterly Fantasy',
    'richly detailed digital painting, fantasy book illustration, painterly brushwork, dramatic lighting, muted jewel tones',
    'photo, photorealistic, text, watermark, signature, frame, border',
    true
  ),
  (
    'storybook-ink',
    'Storybook Ink',
    'ink and watercolor storybook illustration, expressive linework, soft washes, warm paper texture',
    'photo, 3d render, text, watermark, harsh contrast',
    true
  ),
  (
    'cinematic',
    'Cinematic',
    'cinematic film still, shallow depth of field, atmospheric volumetric light, rich color grading',
    'illustration, painting, cartoon, text, watermark, title',
    true
  ),
  (
    'soft-anime',
    'Soft Anime',
    'elegant anime illustration, clean lines, soft cel shading, detailed backgrounds, gentle color palette',
    'photo, photorealistic, western comic, text, watermark',
    true
  )
ON CONFLICT ("slug") DO NOTHING;
