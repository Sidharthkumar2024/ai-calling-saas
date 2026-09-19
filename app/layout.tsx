import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './call-vaani.css';
import { LocaleProvider } from '@/components/locale-provider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Call Vani — AI Calling & Revenue Automation',
  description:
    'Capture leads, understand intent, call in the right language and turn every conversation into a revenue action.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/call-vani-logo.png',
  },
  openGraph: {
    title: 'Call Vani — AI Calling & Revenue Automation',
    description:
      'From lead capture to conversation, CRM action and retargeting.',
    images: [
      {
        url: '/media/call-vaani-phone.png',
        width: 1024,
        height: 1536,
        alt: 'Call Vani AI calling assistant',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Call Vani — AI Calling & Revenue Automation',
    description:
      'From lead capture to conversation, CRM action and retargeting.',
    images: ['/media/call-vaani-phone.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
