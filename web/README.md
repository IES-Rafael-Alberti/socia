# `web/`

Sites públicos del proyecto SOCIA. **Fuera del workspace pnpm de `apps/`**: cada site tiene su propio `package.json` y su propio `node_modules`. Quien clona el repo solo para usar las apps (extensiones / servidor) **no necesita instalar nada de aquí**.

## Apps

- **[`landing/`](landing)** — landing page (Astro). Despliega en la raíz del dominio, ej. `https://socia.fpciberseguridad.com/`.
- **[`docs/`](docs)** — documentación de uso (Astro Starlight). Despliega bajo `/docs`, ej. `https://socia.fpciberseguridad.com/docs/`.

## Trabajar en local

`web/` es un **sub-workspace pnpm** independiente del workspace de `apps/`. Tiene su propio `pnpm-workspace.yaml` y su propio lockfile. Esto le aísla del install de las apps.

Desde `web/` se construye y desarrolla cualquiera de las dos:

```bash
cd web
pnpm install
pnpm dev:landing      # http://localhost:4321
pnpm dev:docs         # http://localhost:4321
pnpm build            # construye landing y docs
```

También funciona entrar directamente en una de ellas:

```bash
cd web/landing
pnpm install
pnpm dev
```

## Deploy

Lo hace [`/.github/workflows/static.yml`](../.github/workflows/static.yml): instala y construye cada app independientemente, y publica el resultado combinado en GitHub Pages.

## Por qué fuera del workspace

Las dependencias de la web (Astro, Starlight, sharp, tailwind…) son grandes y no aportan nada a quien quiere usar las apps. Mantenerlas separadas:

- Acelera el `pnpm install` del workspace de `apps/`.
- Permite a la web usar versiones de Astro distintas sin coordinarlas con el resto.
- Da una separación clara para colaboradores: "yo toco docs" vs. "yo toco código".
