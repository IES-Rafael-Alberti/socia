/**
 * @socia/branding — catalog of educational brands available to SOCIA.
 *
 * Each brand defines the palette, copy and logos applied when SOCIA produces
 * educational artifacts (evaluation PDF, guide PDF). Extension and server
 * pick a brand by `id` at runtime; a missing or unknown id falls back to
 * `defaultBrand`.
 */

import type { Brand } from './types.js';
import { iesRafaelAlbertiBrand } from './brands/ies-rafael-alberti/brand.js';
import { cifpCuencaBrand } from './brands/cifp-cuenca/brand.js';

export type { Brand, BrandPalette, BrandCopy, BrandLogos, BrandName, RGB } from './types.js';

/** All built-in brands, indexed by id. */
const registry: Record<string, Brand> = {
  [iesRafaelAlbertiBrand.id]: iesRafaelAlbertiBrand,
  [cifpCuencaBrand.id]: cifpCuencaBrand,
};

/** The brand used when no explicit id is configured. */
export const defaultBrand: Brand = iesRafaelAlbertiBrand;

/** Look up a brand by id. Falls back to `defaultBrand` if not found. */
export function getBrand(id: string | null | undefined): Brand {
  if (!id) return defaultBrand;
  return registry[id] ?? defaultBrand;
}

/** Return the list of available brands (for selector UIs). */
export function listBrands(): Brand[] {
  return Object.values(registry);
}

/** Return the list of available brand ids. */
export function listBrandIds(): string[] {
  return Object.keys(registry);
}

// Re-export individual brands so consumers can import them directly when
// they want compile-time guarantees a particular brand exists.
export { iesRafaelAlbertiBrand, cifpCuencaBrand };
