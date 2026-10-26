import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDirectory = new URL('.', import.meta.url);

function preserveLegacyScripts() {
  return {
    name: 'atomverse-preserve-legacy-scripts',
    apply: 'build',
    async generateBundle() {
      const scriptsDirectory = new URL('./js/', rootDirectory);
      const scriptNames = (await readdir(scriptsDirectory))
        .filter((name) => name.endsWith('.js') && name !== 'vendor.js')
        .sort();

      await Promise.all(
        scriptNames.map(async (name) => {
          this.emitFile({
            type: 'asset',
            fileName: `js/${name}`,
            source: await readFile(new URL(name, scriptsDirectory)),
          });
        }),
      );
    },
  };
}

export default defineConfig({
  root: fileURLToPath(rootDirectory),
  base: './',
  plugins: [preserveLegacyScripts()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
  },
  test: {
    environment: 'node',
    include: ['tests/frontend/**/*.test.js', 'tests/ci/**/*.test.js', 'tests/chemistry/**/*.test.js'],
    clearMocks: true,
    restoreMocks: true,
  },
});
