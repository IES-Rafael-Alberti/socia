/**
 * Brand definition.
 *
 * A "brand" is the visual identity (palette + copy + logos) applied when
 * SOCIA produces educational artifacts: the evaluation PDF and the guide PDF.
 * Every consumer of these artifacts (the SOCIA browser extension in standalone
 * mode, the SOCIA Server in managed mode, and the guide-generator skill)
 * picks a brand at runtime from this catalog.
 *
 * Adding a new brand means writing a new module under `brands/<id>/brand.ts`
 * with this shape and registering it in `index.ts`. Brands are intentionally
 * code-first (typed, versioned in git) so reviewers see exactly what changes.
 */

/** RGB triplet, 0–255. */
export type RGB = [number, number, number];

export interface BrandPalette {
  /** Main accent — used for cover background, eyebrows, bullets, dividers. */
  primary: RGB;
  /** Slightly darker variant of primary — used for high-contrast text on tint. */
  primaryDark: RGB;
  /** Light tint of primary — fills score badge, conclusion box, phase header. */
  tint: RGB;
  /** Body copy color (near-black). */
  dark: RGB;
  /** Secondary text color (~slate-500). */
  muted: RGB;
  /** Hairline / divider color. */
  border: RGB;
}

export interface BrandCopy {
  /**
   * Single-line cover footer for the evaluation PDF, e.g.
   * "Evaluación generada automáticamente por SOCIA usando un modelo de
   * lenguaje grande, desarrollada por el equipo educativo de ciberseguridad
   * del IES Rafael Alberti."
   */
  evaluationCoverFooter: string;

  /** Footer that appears on every page of the PDFs. */
  pageFooter: string;

  /**
   * Long-form text for the credit box at the end of the guide PDF.
   * Mentions MENTORA and the school that produced the recording.
   */
  guideCreditBox: string;
}

export interface BrandLogos {
  /** Square symbol/imago shown on the cover. PNG, base64 (no data: prefix). */
  imago?: string;
  /** Round seal/wordmark shown in the credit box of the guide PDF. PNG, base64. */
  sello?: string;
}

export interface BrandName {
  /** Short display name, e.g. "IES Rafael Alberti". */
  short: string;
  /**
   * Eyebrow/uppercase tagline rendered above the cover title, e.g.
   * "IES RAFAEL ALBERTI · CIBERSEGURIDAD".
   */
  eyebrow: string;
  /** Optional location qualifier, e.g. "Cádiz". */
  location?: string;
}

export interface Brand {
  /** Stable identifier, kebab-case, e.g. "ies-rafael-alberti". Used as
   *  setting value in extension and server. Once published, do not rename. */
  id: string;
  name: BrandName;
  palette: BrandPalette;
  copy: BrandCopy;
  logos?: BrandLogos;
}
