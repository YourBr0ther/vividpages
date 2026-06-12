import type { Metadata } from 'next';
import { Albert_Sans, Fraunces } from 'next/font/google';

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
    <html lang="en" className={`${fraunces.variable} ${albertSans.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
