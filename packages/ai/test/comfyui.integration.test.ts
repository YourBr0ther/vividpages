import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ComfyUIImageGen } from '../src/image/comfyui';

const COMFYUI_URL = process.env.COMFYUI_URL;
const CHECKPOINT = process.env.COMFYUI_CHECKPOINT; // optional override

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height from the IHDR chunk (always first, at byte 16). */
function pngDimensions(png: Buffer): { width: number; height: number } {
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe.skipIf(!COMFYUI_URL)('ComfyUI integration', () => {
  const gen = () =>
    new ComfyUIImageGen({
      baseUrl: COMFYUI_URL!,
      ...(CHECKPOINT ? { checkpoint: CHECKPOINT } : {}),
    });

  it('healthCheck reports server and checkpoint availability', async () => {
    const health = await gen().healthCheck();
    expect(health.ok, health.detail).toBe(true);
  });

  it(
    'generates a real 512x512 PNG',
    async () => {
      const result = await gen().generate({
        prompt: 'a red apple on a wooden table, studio light',
        width: 512,
        height: 512,
        seed: 12345,
        steps: 8,
        cfg: 1,
      });

      expect(result.png.subarray(0, 8)).toEqual(PNG_MAGIC);
      expect(result.seed).toBe(12345);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.width).toBe(512);
      expect(result.height).toBe(512);

      const dims = pngDimensions(result.png);
      expect(dims).toEqual({ width: 512, height: 512 });

      const file = join(mkdtempSync(join(tmpdir(), 'vividpages-comfyui-')), 'test.png');
      writeFileSync(file, result.png);
      expect(statSync(file).size).toBeGreaterThan(10_000);
      console.log(
        `[comfyui.integration] generated ${dims.width}x${dims.height} png ` +
          `(${result.png.length} bytes) in ${result.durationMs}ms, saved to ${file}`,
      );
    },
    330_000,
  );
});
