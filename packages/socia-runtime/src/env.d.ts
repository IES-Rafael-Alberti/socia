/**
 * Build-time environment variables surfaced via `import.meta.env`.
 *
 * Defined here (not just in vite/client) so the package typechecks on its
 * own without depending on Vite. The actual injection happens at build time
 * when the package is bundled inside the extensions (`apps/extensions/`),
 * where Vite reads `apps/extensions/.env` and inlines variables prefixed
 * with `EXT_` into `import.meta.env.*`.
 *
 * Keep this file in sync with `apps/extensions/.env.example`.
 */
interface ImportMetaEnv {
  /** OpenRouter API key compiled in at build time. Falls back to a key the
   *  student supplies through the SOCIA settings UI when empty. */
  readonly EXT_OPENROUTER_API_KEY?: string;
  /** OpenRouter model id used for hint generation. */
  readonly EXT_OPENROUTER_MODEL_HINTS?: string;
  /** OpenRouter model id used for the final evaluation. */
  readonly EXT_OPENROUTER_MODEL_EVAL?: string;
  /** When 'true', the hint overlay surfaces a debug panel with the LLM
   *  system + user prompts and the raw response. */
  readonly EXT_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
