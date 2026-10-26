import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyPath, loadPolicy } from '../../scripts/ci/release-manifest-policy.mjs';

const segment = fc.stringMatching(/^[a-z0-9_-]+$/u);
const segments = fc.array(segment, { minLength: 1, maxLength: 4 });

/** Validates: Requirements 14.5, 24.5 */
describe('release manifest policy properties', () => {
  let policy;

  beforeAll(async () => {
    policy = await loadPolicy();
  });

  it('returns exactly one deterministic decision for any path', () => {
    fc.assert(
      fc.property(segments, segment, (directories, name) => {
        const path = `${directories.join('/')}/${name}`;
        const first = classifyPath(path, policy);
        const second = classifyPath(path, policy);

        return (
          ['include', 'exclude', 'unclassified'].includes(first.decision) &&
          first.decision === second.decision &&
          first.ruleId === second.ruleId
        );
      }),
      { numRuns: 200 },
    );
  });

  it('excludes secrets, bytecode, caches, logs, media, and review output at any depth', () => {
    fc.assert(
      fc.property(segments, segment, (directories, name) => {
        const prefix = directories.join('/');
        const denied = [
          `${prefix}/.env`,
          `${prefix}/.env.${name}`,
          `${prefix}/__pycache__/${name}.pyc`,
          `${prefix}/${name}.pyc`,
          `${prefix}/node_modules/${name}/package.json`,
          `${prefix}/.ruff_cache/${name}`,
          `${prefix}/${name}.log`,
          `${prefix}/${name}.mp3`,
          `${prefix}/${name}.map`,
          `semantic-review/${prefix}/${name}`,
          `.vercel/${prefix}/${name}`,
          `.kiro/${prefix}/${name}`,
        ];

        return denied.every((path) => classifyPath(path, policy).decision === 'exclude');
      }),
      { numRuns: 200 },
    );
  });

  it('includes reviewed bundled asset types at the payload asset root', () => {
    fc.assert(
      fc.property(segment, fc.constantFrom('js', 'css', 'woff', 'woff2', 'ttf', 'png', 'svg'), (name, extension) => {
        return classifyPath(`assets/${name}.${extension}`, policy).decision === 'include';
      }),
      { numRuns: 100 },
    );
  });

  it('never includes a path that is also denied', () => {
    fc.assert(
      fc.property(segments, segment, fc.constantFrom('js', 'css', 'png', 'mp3', 'log', 'map', 'pyc'), (directories, name, extension) => {
        const classification = classifyPath(`${directories.join('/')}/${name}.${extension}`, policy);
        if (['mp3', 'log', 'map', 'pyc'].includes(extension)) return classification.decision === 'exclude';
        return classification.decision !== 'exclude';
      }),
      { numRuns: 200 },
    );
  });
});
