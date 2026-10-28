import { Bricolage_Grotesque, Caveat, Martian_Mono, Newsreader } from 'next/font/google';

// The public pages' type: grotesque for text, an italic serif for the cheque's handwriting-like fields,
// a hand for the agent's signature, and a MICR-like mono for numbers.
const grotesk = Bricolage_Grotesque({ subsets: ['latin'], axes: ['wdth', 'opsz'], variable: '--f-grotesk', display: 'swap' });
const serif = Newsreader({ subsets: ['latin'], style: ['italic'], weight: ['400'], variable: '--f-serif', display: 'swap' });
const hand = Caveat({ subsets: ['latin'], weight: ['500'], variable: '--f-hand', display: 'swap' });
const mono = Martian_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--f-mono', display: 'swap' });

export const paperFonts = `${grotesk.variable} ${serif.variable} ${hand.variable} ${mono.variable}`;
