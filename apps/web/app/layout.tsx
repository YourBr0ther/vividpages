import type { Metadata } from 'next';
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
  title: 'VividPages',
  description: 'EPUB to AI-storyboard reader',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${albertSans.variable} ${literata.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
