import type { Metadata } from 'next';
import './globals.css';
import './setup.css';
import { fonts } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'Twokey on Arc',
  description: 'The two-key rule for AI agents that move USDC on Arc.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fonts}>
      <body>{children}</body>
    </html>
  );
}
