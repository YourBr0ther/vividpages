import type { MetadataRoute } from 'next';

/**
 * Web app manifest (served at /manifest.webmanifest by Next's metadata route).
 *
 * Colors are drawn from the "candlelit library" design system: the deepest
 * ink (#131110 — the Reader's dark surface in globals.css) is both the splash
 * background and the theme color, so the OS chrome and the install splash sit
 * flush against the app's darkest ground.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VividPages',
    short_name: 'VividPages',
    description: 'Turn your EPUBs into illustrated, AI-storyboarded reads — by candlelight.',
    start_url: '/',
    display: 'standalone',
    background_color: '#131110',
    theme_color: '#131110',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
