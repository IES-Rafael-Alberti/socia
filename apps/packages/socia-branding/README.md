# `@socia/branding`

Catálogo de identidades visuales (paleta + textos + logos) que se aplican cuando SOCIA produce artefactos educativos: el **PDF de evaluación** y el **PDF de guía didáctica**.

Cada brand está versionada en código (`src/brands/<id>/brand.ts`) — añadir un centro educativo es una PR pequeña al repo, no requiere paneles ni configuración runtime.

## Brands incluidos

| `id` | Nombre | Notas |
|---|---|---|
| `socia` | SOCIA | Brand genérico por defecto. Paleta rosa-rojo `#e93456` sobre blanco con neutros fríos. |
| `ies-rafael-alberti` | IES Rafael Alberti (Cádiz) | Paleta rosa/roja institucional. |
| `cifp-cuenca` | CIFP N.º 1 Cuenca | Paleta naranja `#e86b1c` derivada de la web del centro. El sello reutiliza el imago. |

## Cómo añadir un brand nuevo

1. Crea la carpeta `src/brands/<id>/` (ej. `src/brands/ies-mar-menor/`).
2. Codifica los logos a base64 y guárdalos en `imago.b64.ts` y `sello.b64.ts`. Hay un helper para generarlos:
   ```bash
   # Desde la raíz del repo
   node -e "
   const fs = require('fs');
   for (const [src, dst] of [
     ['ruta/a/imago.png', 'apps/packages/socia-branding/src/brands/<id>/imago.b64.ts'],
     ['ruta/a/sello.png', 'apps/packages/socia-branding/src/brands/<id>/sello.b64.ts'],
   ]) {
     const b64 = fs.readFileSync(src).toString('base64');
     fs.writeFileSync(dst,
       '/* eslint-disable */\n' +
       '// Auto-generated: PNG bytes encoded as base64. Do not edit by hand.\n' +
       'export const base64 = ' + JSON.stringify(b64) + ';\n');
   }
   "
   ```
3. Crea `brand.ts` exportando un objeto `Brand` (ver `types.ts` para los campos exactos).
4. Regístralo en `src/index.ts` añadiéndolo al `registry`.
5. **(Importante)** Replica la carpeta paralela en [`apps/skills/guide-generator/brands/<id>/`](../../skills/guide-generator/brands/) para que la skill que genera la guía didáctica también pueda usar el brand. La sincronización es manual a propósito (la skill se distribuye aislada del monorepo).

## Cómo se selecciona el brand

- **Extensión SOCIA en standalone**: el alumno elige el brand desde Ajustes (`standaloneBrandId`). Default `socia`.
- **SOCIA Server (managed)**: la variable de entorno `BRAND_ID` del docker-compose / `.env` fija el brand del servidor. Aplica a todas las evaluaciones que genere ese servidor.
- **Skill `guide-generator`**: el agente lee el brand del contexto del docente que invoca la skill (instrucciones en su `SKILL.md`).

## Paleta

Cada brand define seis colores RGB (`[r, g, b]`, 0–255):

| Token | Uso |
|---|---|
| `primary` | Fondo de cover, eyebrows, bullets, dividers |
| `primaryDark` | Texto de alto contraste sobre `tint` |
| `tint` | Fondo del badge de nota, caja de conclusión, header de fase |
| `dark` | Body copy |
| `muted` | Texto secundario |
| `border` | Hairlines |

## Tamaños recomendados de logos

- **Imago** (símbolo cuadrado para la cover): PNG transparente, ~512×512 px.
- **Sello** (sello/firma para el credit box): PNG transparente, ~256×256 px o aspecto 1:1.

Como referencia: el imago del IES Rafael Alberti pesa ~10 KB; el sello, ~100 KB. Si el sello supera los 200 KB conviene optimizarlo (compresión `pngquant` por ejemplo) — recuerda que se embebe en cada bundle (extensión, server) como base64.
