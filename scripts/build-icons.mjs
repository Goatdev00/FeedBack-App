// =====================================================================
// FEEDBACK — Icon builder
// Takes `portada APP.png` and emits three variants with a solid dark
// background so iOS / Android home-screen icons stop rendering blank
// (the source has a transparent / white background which iOS fills in
// with white, making the logo invisible).
//
//   public/logo.png       1024x1024  → big/share preview, og:image
//   public/logo-512.png    512x512   → PWA manifest "any"
//   public/logo-192.png    192x192   → PWA manifest small + favicon-sized
//   public/logo-180.png    180x180   → Apple touch icon
//
// Run with: `node scripts/build-icons.mjs`
// =====================================================================

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC  = resolve(__dirname, '..', 'portada APP.png');
const OUT  = resolve(__dirname, '..', 'public');

mkdirSync(OUT, { recursive: true });

const BG = { r: 10, g: 10, b: 15, alpha: 1 }; // #0A0A0F brand background

// Each variant: target square size + how much the logo should occupy.
// Padding is very small (3-4%) so the lettering reaches close to the
// rounded-corner edge. iOS clips the corners — 3% on a 180px icon = ~5px
// safety margin, which is enough to keep the letterforms intact.
const VARIANTS = [
  { file: 'logo.png',     size: 1024, padding: 0.04 },
  { file: 'logo-512.png',  size: 512, padding: 0.04 },
  { file: 'logo-192.png',  size: 192, padding: 0.03 },
  { file: 'logo-180.png',  size: 180, padding: 0.03 },
];

async function buildOne({ file, size, padding }) {
  const inner = Math.round(size * (1 - padding * 2));

  // Resize the logo to the inner content area, preserving aspect ratio.
  const logoBuf = await sharp(SRC)
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // keep transparency in resize
    })
    .png()
    .toBuffer();

  const outPath = resolve(OUT, file);
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logoBuf, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  console.log(`✓ ${file} (${size}×${size})`);
}

console.log(`Source: ${SRC}`);
console.log(`Output: ${OUT}`);
console.log(`Background: rgb(${BG.r}, ${BG.g}, ${BG.b})\n`);

for (const v of VARIANTS) {
  await buildOne(v);
}

// Transparent variant for the splash / login screen — keeps the original
// alpha channel, just resized to a sane web dimension. The home-screen
// PWA + favicon variants still need the baked-in dark background; this
// one is purely for on-screen rendering where the page bg is already dark.
const transparentMax = 512;
await sharp(SRC)
  .resize(transparentMax, transparentMax, {
    fit: 'inside',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png({ compressionLevel: 9 })
  .toFile(resolve(OUT, 'logo-transparent.png'));
console.log(`✓ logo-transparent.png (max ${transparentMax}px, alpha preserved)`);

console.log('\nDone.');
