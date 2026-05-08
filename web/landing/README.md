# SOCIA Landing Page

Landing pública del proyecto **SOCIA** (Plataforma para el entrenamiento de gestión de incidentes de Ciberseguridad tutorizada con Inteligencia Artificial).

Se publica en `https://socia.fpciberseguridad.com/` mediante GitHub Pages — el deploy lo gestiona [`/.github/workflows/static.yml`](../../.github/workflows/static.yml).

## Desarrollo local

Esta carpeta es parte del **sub-workspace** `web/`. Para arrancarla:

```bash
cd web
pnpm install                # solo la primera vez
pnpm dev:landing            # arranca en http://localhost:4321
```

O directamente desde aquí:

```bash
cd web/landing
pnpm install
pnpm dev
```

## Stack

- [Astro](https://astro.build/) + [Tailwind CSS](https://tailwindcss.com/) + [Astro Icon](https://github.com/natemoo-re/astro-icon).

## Atribución

Construida sobre el template open source [`astro-landing-page`](https://github.com/markusahlf/astro-landing-page) (MIT). El [`LICENSE`](LICENSE) original se conserva en esta carpeta.
