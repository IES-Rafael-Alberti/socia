import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle workspace packages, but keep node_modules external (better-sqlite3
  // is native and must not be bundled).
  noExternal: ['@socia/branding', '@socia/eval', '@socia/runtime'],
  // Provide a banner that lets ESM use require()-style native deps if needed.
  banner: ({ format }) =>
    format === 'esm'
      ? {
          js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        }
      : {},
});
