import type { Brand } from '../../types.js';
import { base64 as imagoBase64 } from './imago.b64.js';
import { base64 as selloBase64 } from './sello.b64.js';

/**
 * Brand for CIFP N.º 1 Cuenca (https://www.cifpcuenca.es/).
 *
 * Palette is mapped from the centre's design tokens:
 *   primary      ← color.text.tertiary  #e86b1c   (accent orange)
 *   primaryDark  ← derived darker shade #b85410
 *   tint         ← derived warm tint    #fdf3eb
 *   dark         ← color.text.inverse   #333333
 *   muted        ← color.border.muted   #666666
 *   border       ← neutral hairline     #e5e5e5
 *
 * The CIFP brand only ships one logo asset — the same PNG is wired as
 * both `imago` (cover) and `sello` (credit box). When a square-seal
 * version becomes available, replace `sello.b64.ts` with it.
 */
export const cifpCuencaBrand: Brand = {
  id: 'cifp-cuenca',
  name: {
    short: 'CIFP N.º 1 Cuenca',
    eyebrow: 'CIFP N.º 1 CUENCA · CIBERSEGURIDAD',
    location: 'Cuenca',
  },
  palette: {
    primary: [232, 107, 28],      // #e86b1c
    primaryDark: [184, 84, 16],   // #b85410
    tint: [253, 243, 235],        // #fdf3eb
    dark: [51, 51, 51],           // #333333
    muted: [102, 102, 102],       // #666666
    border: [229, 229, 229],      // #e5e5e5
  },
  copy: {
    evaluationCoverFooter:
      'Evaluación generada automáticamente por SOCIA usando un modelo de lenguaje grande, ' +
      'desarrollada por el equipo educativo de ciberseguridad del CIFP N.º 1 Cuenca.',
    pageFooter: 'CIFP N.º 1 Cuenca · Ciberseguridad',
    guideCreditBox:
      'Guía generada automáticamente usando MENTORA, desarrollada por el equipo educativo ' +
      'de ciberseguridad del CIFP N.º 1 Cuenca. MENTORA graba las acciones del profesor ' +
      'sobre las herramientas reales del SOC y produce automáticamente este material ' +
      'didáctico, garantizando que la documentación coincide con la práctica actual del aula.',
  },
  logos: {
    imago: imagoBase64,
    sello: selloBase64,
  },
};
