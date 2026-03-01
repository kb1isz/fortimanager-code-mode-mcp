import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    conditions: ['node', 'import', 'module', 'default'],
  },
  plugins: [
    {
      name: 'resolve-ts-from-js',
      enforce: 'pre',
      resolveId(source, importer) {
        // Only rewrite relative .js imports from .ts files
        if (
          source.endsWith('.js') &&
          (source.startsWith('./') || source.startsWith('../')) &&
          importer?.endsWith('.ts')
        ) {
          const tsSource = source.replace(/\.js$/, '.ts');
          const importerDir = path.dirname(importer);
          return path.resolve(importerDir, tsSource);
        }
        return null;
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30_000,
  },
});
