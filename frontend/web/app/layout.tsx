import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SpacetimeProvider } from '@/lib/spacetime';
import { Header } from '@/components/Header';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'HoldLess',
  description: "AI waits on customer service so you don't have to.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <SpacetimeProvider>
          <Header />
          <main className="mx-auto w-full max-w-[1240px] px-4 pb-20 sm:px-6">{children}</main>
        </SpacetimeProvider>
      </body>
    </html>
  );
}
