// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');

const requiredRuntimeDependencies = [
  '@fontsource/jetbrains-mono',
  '@fontsource/montserrat',
  '@fontsource/poppins',
  'dompurify',
  'katex',
  'marked',
];
const requiredDevelopmentDependencies = [
  'autoprefixer',
  'axe-core',
  'fast-check',
  'jsdom',
  'postcss',
  'tailwindcss',
  'vite',
  'vitest',
];

describe('frontend toolchain', () => {
  it('pins every reviewed direct dependency to one exact version', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    expect(manifest.packageManager).toBe('npm@12.0.2');

    for (const name of requiredRuntimeDependencies) {
      expect(manifest.dependencies[name]).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    }
    for (const name of requiredDevelopmentDependencies) {
      expect(manifest.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    }
  });

  it('bundles reviewed Markdown, sanitizer, and math APIs locally', async () => {
    await import('../../js/vendor.js');

    expect(window.marked.parse('**Atomverse**')).toContain('<strong>Atomverse</strong>');
    expect(window.DOMPurify.sanitize('<img src=x onerror=alert(1)>')).not.toContain('onerror');
    expect(window.katex.renderToString('H_2O', { throwOnError: true })).toContain('katex');
    expect(window.renderMathInElement).toBeTypeOf('function');
  });
});
