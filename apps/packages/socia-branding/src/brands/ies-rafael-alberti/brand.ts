import type { Brand } from '../../types.js';
import { base64 as imagoBase64 } from './imago.b64.js';
import { base64 as selloBase64 } from './sello.b64.js';

export const iesRafaelAlbertiBrand: Brand = {
  id: 'ies-rafael-alberti',
  name: {
    short: 'IES Rafael Alberti',
    eyebrow: 'IES RAFAEL ALBERTI · CIBERSEGURIDAD',
    location: 'Cádiz',
  },
  palette: {
    primary: [233, 52, 86],       // #e93456
    primaryDark: [196, 40, 71],   // #c42847
    tint: [255, 245, 247],        // #fff5f7
    dark: [34, 34, 32],           // #222220
    muted: [100, 116, 139],       // slate-500
    border: [229, 229, 229],      // #e5e5e5
  },
  copy: {
    evaluationCoverFooter:
      'Evaluación generada automáticamente por SOCIA usando un modelo de lenguaje grande, ' +
      'desarrollada por el equipo educativo de ciberseguridad del IES Rafael Alberti.',
    pageFooter: 'IES Rafael Alberti · Ciberseguridad',
    guideCreditBox:
      'Guía generada automáticamente usando MENTORA, desarrollada por el equipo educativo ' +
      'de ciberseguridad del IES Rafael Alberti (Cádiz). MENTORA graba las acciones del ' +
      'profesor sobre las herramientas reales del SOC y produce automáticamente este ' +
      'material didáctico, garantizando que la documentación coincide con la práctica ' +
      'actual del aula.',
  },
  logos: {
    imago: imagoBase64,
    sello: selloBase64,
  },
};
