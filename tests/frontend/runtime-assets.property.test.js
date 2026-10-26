import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findRemoteRuntimeAssets, hasRemoteCssAsset } from '../../scripts/frontend/verify-no-runtime-cdn.mjs';

/** Validates: Requirements 16.2, 16.3 */
describe('runtime asset policy', () => {
  it('rejects remote script and stylesheet references', () => {
    expect(findRemoteRuntimeAssets('<script src="https://cdn.example/app.js"></script>')).toHaveLength(1);
    expect(findRemoteRuntimeAssets('<link rel="stylesheet" href="//cdn.example/app.css">')).toHaveLength(1);
    expect(hasRemoteCssAsset('@import url("https://cdn.example/font.css");')).toBe(true);
  });

  it('accepts arbitrary local asset paths and rejects equivalent HTTPS references', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z0-9_-]+$/u), { minLength: 1, maxLength: 5 }),
        fc.constantFrom('js', 'css', 'woff2', 'png'),
        (segments, extension) => {
          const path = `./${segments.join('/')}.${extension}`;
          const localHtml = `<script src="${path}"></script><link href="${path}" rel="stylesheet">`;
          const remoteHtml = `<script src="https://assets.example/${segments.join('/')}.${extension}"></script>`;
          return findRemoteRuntimeAssets(localHtml).length === 0 && findRemoteRuntimeAssets(remoteHtml).length === 1;
        },
      ),
      { numRuns: 100 },
    );
  });
});
