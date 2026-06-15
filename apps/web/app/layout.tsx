import { SerwistProvider } from '@serwist/next/react';
import type { Metadata, Viewport } from 'next';
import { Albert_Sans, Fraunces, Literata } from 'next/font/google';

import './globals.css';

// Display serif: Fraunces with its optical-size axis for a letterpress feel
// at large sizes. Body UI: Albert Sans, a clean humanist grotesque.
const fraunces = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-fraunces',
});

const albertSans = Albert_Sans({
  subsets: ['latin'],
  variable: '--font-albert-sans',
});

// Reading serif: Literata (designed for long-form ebook reading) with its
// optical-size axis; used only inside the Reader's text column.
const literata = Literata({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-literata',
});

export const metadata: Metadata = {
  applicationName: 'VividPages',
  title: 'VividPages',
  description: 'EPUB to AI-storyboard reader',
  // Next serves the manifest from app/manifest.ts at /manifest.webmanifest;
  // pointing at it explicitly emits the <link rel="manifest"> tag.
  manifest: '/manifest.webmanifest',
  // Installable on iOS, with the home-screen icon + standalone status bar.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'VividPages',
  },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

// theme_color for the browser/OS chrome — the deepest candlelit ink.
export const viewport: Viewport = {
  themeColor: '#131110',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${albertSans.variable} ${literata.variable}`}>
      <body className="font-sans antialiased">
        {/*
         * Registers /sw.js via @serwist/window. Disabled in development so HMR
         * and the e2e suite (which run against `next dev`) aren't fighting a
         * service worker — matching the build-time gate in serwist.config.js.
         */}
        <SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV === 'development'}>
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
