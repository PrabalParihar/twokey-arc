import { Geist, Geist_Mono } from 'next/font/google';

// Geist for everything people read; Geist Mono for hashes, addresses and amounts that must line up.
const sans = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--f-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--f-mono', display: 'swap' });

export const fonts = `${sans.variable} ${mono.variable}`;
