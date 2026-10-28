import { JetBrains_Mono, Onest } from 'next/font/google';

// One sans for everything people read, one mono for hashes, addresses and amounts that must line up.
const sans = Onest({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--f-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--f-mono', display: 'swap' });

export const fonts = `${sans.variable} ${mono.variable}`;
