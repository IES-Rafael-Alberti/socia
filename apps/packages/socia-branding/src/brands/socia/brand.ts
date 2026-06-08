import type { Brand } from '../../types.js';
import { base64 as imagoBase64 } from './imago.b64.js';
import { base64 as selloBase64 } from './sello.b64.js';

export const sociaBrand: Brand = {
  id: 'socia',
  name: {
    short: 'SOCIA',
    eyebrow: 'SOCIA · CIBERSEGURIDAD',
  },
  palette: {
    primary: [233, 52, 86],       // #e93456
    primaryDark: [176, 26, 60],   // #b01a3c
    tint: [255, 241, 244],        // #fff1f4
    dark: [20, 22, 27],           // #14161b
    muted: [82, 88, 102],         // #525866
    border: [230, 232, 236],      // #e6e8ec
  },
  copy: {
    evaluationCoverFooter:
      'Evaluación generada automáticamente por SOCIA usando un modelo de lenguaje grande.',
    pageFooter: 'SOCIA · Ciberseguridad',
    guideCreditBox:
      'Guía generada automáticamente usando MENTORA. MENTORA graba las acciones del ' +
      'profesor sobre las herramientas reales del SOC y produce automáticamente este ' +
      'material didáctico, garantizando que la documentación coincide con la práctica ' +
      'actual del aula.',
  },
  logos: {
    imago: imagoBase64,
    sello: selloBase64,
  },
};
