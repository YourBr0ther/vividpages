import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
