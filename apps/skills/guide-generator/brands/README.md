# Brands para `guide-generator`

Catálogo paralelo al de [`apps/packages/socia-branding`](../../../packages/socia-branding) para que la skill `guide-generator` (que se distribuye aislada del monorepo) tenga su propia copia.

Mantenimiento manual: cuando añades o modificas un brand en `apps/packages/socia-branding/src/brands/<id>/`, replica el cambio aquí en `apps/skills/guide-generator/brands/<id>/`.

## Estructura

```
brands/
└── <id>/
    ├── brand.json    ← name, palette, copy (mirror del Brand TS)
    ├── imago.png     ← símbolo cuadrado de la cover
    └── sello.png     ← sello/firma del credit box
```

## `brand.json`

```json
{
  "id": "ies-rafael-alberti",
  "name": {
    "short": "IES Rafael Alberti",
    "eyebrow": "IES Rafael Alberti · Ciberseguridad",
    "location": "Cádiz"
  },
  "palette": {
    "primary":     "#e93456",
    "primaryDark": "#c42847",
    "tint":        "#fff5f7",
    "dark":        "#222220",
    "muted":       "#9ca3af",
    "border":      "#e5e5e5"
  },
  "copy": {
    "pageFooter": "IES Rafael Alberti · Ciberseguridad",
    "guideCreditBox": "Guía generada automáticamente usando MENTORA, …"
  }
}
```

## Cómo se usa

1. La skill (`SKILL.md`) lee el brand id del contexto del docente que la invoca.
2. Resuelve la carpeta del brand en `brands/<id>/`.
3. Pasa `imago.png`, `sello.png`, `brand.json` al template HTML al construir el output.
4. `render.py` recibe `--brand-dir <path>` (o equivalente) y aplica los tokens al CSS y al HTML.

## Brands incluidos

| `id` | Centro |
|---|---|
| `socia` | SOCIA genérico (default). Paleta rosa-rojo `#e93456` sobre blanco con neutros fríos. |
| `ies-rafael-alberti` | IES Rafael Alberti (Cádiz). |
| `cifp-cuenca` | CIFP N.º 1 Cuenca. Paleta naranja `#e86b1c` (guía de tokens del centro). |
