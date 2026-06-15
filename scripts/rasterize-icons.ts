/**
 * One-off rasterizer for the PWA icons.
 *
 * Renders the on-brand SVGs in apps/web/public/icons/ to the PNG sizes the
 * web app manifest references (192, 512, and a maskable 512). sharp is a
 * dependency of @vividpages/core, so we run this with that package resolvable
 * (e.g. `pnpm -F @vividpages/core exec tsx scripts/rasterize-icons.ts` from
 * the repo root, or plain `tsx` once node_modules are hoisted).
 *
 * Re-run whenever icon.svg / icon-maskable.svg change, then commit the PNGs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, '..', 'apps', 'web', 'public', 'icons');

const jobs: { src: string; out: string; size: number }[] = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
];

async function main() {
  for (const { src, out, size } of jobs) {
    const svg = await readFile(join(iconsDir, src));
    const png = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(join(iconsDir, out), png);
    console.log(`wrote icons/${out} (${size}x${size}, ${png.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
