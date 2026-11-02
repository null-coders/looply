// Copies the fonts and the QR scanner library from node_modules into
// public/, so they are served as normal files (on your computer and on
// Netlify) and the app works without loading anything from the internet.
// Runs automatically after "npm install" and during the Netlify build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const pub = (...p) => path.join(root, 'public', ...p);

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

copy(nm('jsqr', 'dist', 'jsQR.js'), pub('vendor', 'jsQR.js'));

const FONTS = { 'baloo-2': [500, 600, 700, 800], mukta: [400, 500, 600, 700] };
let files = 1;
for (const [font, weights] of Object.entries(FONTS)) {
  for (const weight of weights) {
    copy(nm('@fontsource', font, `${weight}.css`), pub('fonts', font, `${weight}.css`));
    files += 1;
    for (const file of fs.readdirSync(nm('@fontsource', font, 'files'))) {
      if (file.includes(`-${weight}-normal.woff`)) {
        copy(nm('@fontsource', font, 'files', file), pub('fonts', font, 'files', file));
        files += 1;
      }
    }
  }
}
console.log(`Copied ${files} font and scanner files into public/.`);
