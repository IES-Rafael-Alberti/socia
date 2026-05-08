#!/usr/bin/env node
/**
 * Generates the Open Graph social card for the SOCIA landing.
 *
 *   pnpm --filter @socia/landing og
 *   # or, from web/landing/:
 *   pnpm og
 *
 * Output: public/social.jpg  (1200x630 JPEG)
 *
 * Why this lives as a script and not as a build step:
 *   - The OG card rarely changes (brand-driven, not content-driven).
 *   - sharp + an embedded SVG renders deterministically; no need to add a
 *     plugin to Astro's pipeline.
 *
 * Re-run after a brand change. The script's only dependency is `sharp`,
 * which is already part of this package (Astro uses it for image
 * optimisation).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const landingRoot = resolve(here, '..');

const LOGO_PATH = resolve(landingRoot, 'src/assets/socia-logo.svg');
const OUTPUT = resolve(landingRoot, 'public/social.jpg');

// Brand tokens — keep in sync with packages/socia-branding (default brand).
const PRIMARY = '#e93456';
const PRIMARY_DARK = '#c42847';

const W = 1200;
const H = 630;

const logoSvg = await readFile(LOGO_PATH, 'utf8');
const logoInner = logoSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// One self-contained SVG document.
//
// Layout: logo on the left, text block on the right, partner attribution
// pinned to the bottom. Helvetica/Arial fallback covers macOS, Linux CI and
// most Windows setups; sharp ships with librsvg which uses fontconfig.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PRIMARY}"/>
      <stop offset="100%" stop-color="${PRIMARY_DARK}"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Subtle starburst pattern in the corner, just to break the flat fill -->
  <g opacity="0.06" fill="white">
    <circle cx="1080" cy="100" r="3"/>
    <circle cx="1140" cy="180" r="2"/>
    <circle cx="1020" cy="200" r="2"/>
    <circle cx="1100" cy="260" r="3"/>
    <circle cx="60"   cy="540" r="2"/>
    <circle cx="120"  cy="500" r="3"/>
    <circle cx="40"   cy="460" r="2"/>
  </g>

  <!-- Logo (drawn inside a 240×240 box, vertically centred) -->
  <g transform="translate(80, ${(H - 240) / 2}) scale(${240 / 783})">
    ${logoInner}
  </g>

  <!-- Text block, right of the logo -->
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" fill="white">
    <text x="380" y="240" font-size="96" font-weight="800" letter-spacing="-2">SOCIA</text>
    <line x1="380" y1="270" x2="540" y2="270" stroke="white" stroke-width="3" stroke-opacity="0.7"/>
    <text x="380" y="335" font-size="32" font-weight="600" opacity="0.95">
      Entrenamiento práctico de SOC con IA
    </text>
    <text x="380" y="385" font-size="22" font-weight="400" opacity="0.85">
      Casos reales · verificación automática · evaluación tutorizada
    </text>
  </g>

  <!-- Footer attribution -->
  <text x="80" y="${H - 60}"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="20" font-weight="600" fill="white" opacity="0.85"
        letter-spacing="1.5">
    IES RAFAEL ALBERTI · CIFP N.º 1 CUENCA · AKTIOS
  </text>
  <text x="80" y="${H - 35}"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="14" font-weight="400" fill="white" opacity="0.65"
        letter-spacing="0.5">
    socia.fpciberseguridad.com
  </text>
</svg>
`;

await sharp(Buffer.from(svg))
  .jpeg({ quality: 88, progressive: true, mozjpeg: true })
  .toFile(OUTPUT);

console.log(`✓ Wrote ${OUTPUT.replace(landingRoot + '/', '')} (1200x630 JPEG)`);
