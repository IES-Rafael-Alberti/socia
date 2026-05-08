# SOCIA Docs

Documentación pública del proyecto **SOCIA** — guías de uso para docentes y alumnado.

Construida con [Astro Starlight](https://starlight.astro.build/). Se publica en `https://socia.fpciberseguridad.com/docs/` mediante GitHub Pages — el deploy lo gestiona [`/.github/workflows/static.yml`](../../.github/workflows/static.yml).

## Estructura

```
src/content/docs/      ← páginas .md / .mdx (cada archivo = una ruta)
src/assets/            ← imágenes referenciadas desde el contenido
public/                ← favicon y otros estáticos servidos sin procesar
astro.config.mjs       ← configuración de Starlight (sidebar, base, locales)
```

## Desarrollo local

Esta carpeta es parte del **sub-workspace** `web/`. Para arrancarla:

```bash
cd web
pnpm install                # solo la primera vez
pnpm dev:docs               # http://localhost:4321
```

O directamente desde aquí:

```bash
cd web/docs
pnpm install
pnpm dev
```

## Añadir contenido

- Crea un archivo `.md` o `.mdx` dentro de `src/content/docs/`.
- El nombre del archivo es la ruta. `src/content/docs/empezar/instalacion.md` → `/docs/empezar/instalacion`.
- Usa frontmatter para `title` y `description` (visible en buscador y SEO).
- Imágenes: en `src/assets/` y referenciadas con paths relativos (`![Logo](../../../assets/socia-logo.svg)`).

## Stack

- [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/) + [sharp](https://sharp.pixelplumbing.com/) (para procesar imágenes).
