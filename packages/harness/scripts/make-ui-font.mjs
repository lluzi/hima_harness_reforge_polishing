// Keep the client self-contained: the existing bundle carries the licensed font,
// with no remote font service, asset route, or additional browser dependency.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const bytes = readFileSync(new URL('../assets/fonts/Manrope.woff2', import.meta.url));
const target = new URL('../src/client/aix-font.ts', import.meta.url);
writeFileSync(target, '// Generated from assets/fonts/Manrope.woff2 by scripts/make-ui-font.mjs.\n'
  + '// Manrope is licensed under SIL OFL 1.1; see assets/fonts/OFL.txt.\n'
  + `export const AIX_FONT_URL = ${JSON.stringify(`data:font/woff2;base64,${bytes.toString('base64')}`)};\n`);
console.log(`ui font: ${fileURLToPath(target)} (${bytes.length} font bytes)`);
