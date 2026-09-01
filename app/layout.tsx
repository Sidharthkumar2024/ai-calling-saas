import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Vaani — AI Calling Operations',
  description:
    'A multi-tenant AI calling workspace for campaigns, callbacks, CRM and appointments.',
  openGraph: {
    title: 'Vaani — AI Calling Operations',
    description: 'AI calling operations, simplified.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Vaani AI calling operations dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vaani — AI Calling Operations',
    description: 'AI calling operations, simplified.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
