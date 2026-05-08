# Aviso de licencia y marcas

El **código fuente** de este repositorio se distribuye bajo la licencia [MIT](LICENSE). Eso incluye todo el TypeScript, JavaScript, CSS, HTML, Markdown, scripts, configuraciones y assets generados a partir del código (PDFs, JSONs, etc.).

La licencia MIT **no se extiende** a ciertos elementos visuales y nombres comerciales que pertenecen a terceros y se incluyen aquí únicamente con un propósito identificativo —para que SOCIA pueda mostrar quién participa en el proyecto, qué herramientas integra o qué centro educativo aplica un branding determinado al PDF de evaluación—. Esos elementos siguen sujetos a los derechos de sus titulares respectivos.

> **TL;DR para personas que hacen fork**: puedes copiar, modificar y redistribuir el código sin pedir permiso. Si vas a publicar un derivado bajo tu propia marca, **sustituye los logos y nombres de terceros que aparecen en este aviso** por los tuyos. No los uses para implicar respaldo, certificación o asociación con esos terceros si no la tienes.

## Marcas, logos y nombres de terceros

Las siguientes marcas y logos están protegidos por derechos de autor y/o registrados como marcas comerciales por sus respectivos titulares. Su inclusión en este repositorio se acoge a un uso nominativo / descriptivo (identificar a sus titulares en el contexto de este proyecto) y **no implica respaldo, certificación o asociación comercial** más allá de la colaboración explícita declarada por las partes.

### Centros e instituciones colaboradoras

| Marca / logo | Titular | Ubicación en el repo |
|---|---|---|
| **IES Rafael Alberti** (logos imago, sello y wordmark) | IES Rafael Alberti, Cádiz | `packages/socia-branding/src/brands/ies-rafael-alberti/`, `tools/skills/guide-generator/brands/ies-rafael-alberti/`, `web/landing/src/assets/Sello-Rafael-Alberti-Primario.svg` |
| **CIFP N.º 1 Cuenca** (logo y wordmark) | CIFP N.º 1 Cuenca | `packages/socia-branding/src/brands/cifp-cuenca/`, `tools/skills/guide-generator/brands/cifp-cuenca/`, `web/landing/src/assets/logo-cifp-cuenca.png` |
| **Aktios Security Services** | Aktios Security Services, S.L. | `web/landing/src/assets/atkios.svg` |

Estos logos están aquí porque cada centro/empresa colabora activamente con SOCIA. Si haces fork del proyecto y no formas parte de esa colaboración, **debes retirar los logos** o sustituirlos por los del centro/organización que adopte tu derivado.

### Financiación pública

| Marca / logo | Titular |
|---|---|
| **Ministerio de Educación, Formación Profesional y Deportes** | Gobierno de España |
| **Plan de Recuperación, Transformación y Resiliencia (PRTR)** | Gobierno de España |
| Logo de la **Unión Europea** / *NextGenerationEU* | Unión Europea |

Ubicación: `web/landing/src/assets/funding/`. Su inclusión cumple con la obligación de publicidad asociada a los proyectos financiados por estos fondos. Si redistribuyes este código fuera del marco de financiación, **retira estos logos**.

### Herramientas SOC integradas

SOCIA opera sobre herramientas reales del ecosistema SOC. Sus logos aparecen para identificarlas en la web y en la documentación, sin implicar afiliación oficial:

| Marca | Titular | Ubicación |
|---|---|---|
| **Wazuh** | Wazuh, Inc. | `web/landing/src/assets/tools/wazuh.png` |
| **OPNsense** | Deciso B.V. | `web/landing/src/assets/tools/opnsense.png` |
| **Velociraptor** | Velocidex Enterprises / Rapid7 | `web/landing/src/assets/tools/velociraptor.svg` |
| **Malcolm** | Idaho National Laboratory / U.S. CISA | `web/landing/src/assets/tools/malcolm.png` |

### Dependencias y herramientas con marca propia

Las marcas **Astro**, **Starlight**, **WXT**, **Vite**, **React**, **Tailwind CSS** y otras dependencias del stack pertenecen a sus respectivos titulares. Sus logos no se incluyen en el repo (solo se mencionan en docs y READMEs por referencia).

### Atribución de plantilla

La landing en `web/landing/` está construida sobre el template open source [`astro-landing-page`](https://github.com/markusahlf/astro-landing-page) (MIT). Su `LICENSE` original se preserva en `web/landing/LICENSE` por atribución.

## Cómo retirar los logos al hacer fork

Si vas a publicar un derivado que no forma parte del proyecto SOCIA original:

1. Sustituye los archivos PNG de los brands en `packages/socia-branding/src/brands/<id>/imago.b64.ts` y `sello.b64.ts` por logos propios. Mismo procedimiento en el espejo `tools/skills/guide-generator/brands/<id>/`.
2. En la landing (`web/landing/src/components/partners.astro`) sustituye o retira los partners que no apliquen.
3. Vuelve a ejecutar `pnpm og` desde `web/landing/` para regenerar la OG card sin los logos del repo original.
4. Actualiza este `NOTICE.md` con tus titulares.

## Reportar un problema de uso indebido

Si eres titular de una de las marcas listadas y consideras que su uso aquí no es apropiado, contáctanos por la vía descrita en [`SECURITY.md`](SECURITY.md) y atenderemos la petición en plazo razonable.
