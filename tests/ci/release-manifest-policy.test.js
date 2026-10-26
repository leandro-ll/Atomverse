import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { inspectReleaseArtifacts } from '../../scripts/ci/inspect-release-artifacts.mjs';
import {
  classifyPath,
  inspectLocalExclusions,
  inspectManifest,
  listPayloadFiles,
  loadPolicy,
  validatePolicy,
} from '../../scripts/ci/release-manifest-policy.mjs';

const root = resolve(import.meta.dirname, '..', '..');

const completePayload = [
  'index.html',
  'assets/index-BC-WYNlB.css',
  'assets/index-kj3P5nh_.js',
  'assets/montserrat-latin-400-normal-abc.woff2',
  'assets/logo-Dm6cO4yW.png',
  'js/ai-tutor.js',
  'js/chemistry-engine.js',
  'js/config.js',
  'js/inverse-experiment.js',
  'js/main.js',
  'js/visualization.js',
  '.vite/manifest.json',
];

/** Validates: Requirements 14.5, 24.5, 25.7 */
describe('release manifest policy', () => {
  let policy;

  beforeAll(async () => {
    policy = await loadPolicy();
  });

  it('is structurally valid and fails closed on unmatched paths', () => {
    expect(validatePolicy(policy)).toEqual([]);
    expect(classifyPath('unknown/thing.bin', policy)).toMatchObject({ decision: 'unclassified', ruleId: null });
  });

  it('includes every required runtime asset without violations', () => {
    const report = inspectManifest(completePayload, policy);

    expect(report.violations).toEqual([]);
    expect(report.included).toBe(completePayload.length);
    expect(report.unclassified).toBe(0);
  });

  it('reports a missing required runtime asset instead of passing', () => {
    const report = inspectManifest(completePayload.filter((path) => path !== 'index.html'), policy);

    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({ type: 'missing-required-asset', ruleId: 'entry-document' });
  });

  it.each([
    ['.env.local', 'secrets'],
    ['backend/.env', 'secrets'],
    ['config/provider.key', 'secrets'],
    ['backend/__pycache__/main.cpython-311.pyc', 'bytecode'],
    ['backend/.ruff_cache/CACHEDIR.TAG', 'caches'],
    ['node_modules/vite/package.json', 'caches'],
    ['.vercel/project.json', 'local-metadata'],
    ['.kiro/specs/codebase-audit-fixes/design.md', 'local-metadata'],
    ['semantic-review/review.md', 'semantic-review'],
    ['npm-debug.log', 'logs'],
    ['assets/index-kj3P5nh_.js.map', 'source-maps'],
    ['assets/Ai.mp3', 'unapproved-media'],
    ['assets/modul lingkungan.mp3', 'unapproved-media'],
  ])('excludes %s as %s', (path, category) => {
    expect(classifyPath(path, policy)).toMatchObject({ decision: 'exclude', category });
  });

  it('reports every denied path injected into a payload', () => {
    const report = inspectManifest(
      [...completePayload, '.env.local', 'assets/Ai.mp3', 'backend/__pycache__/main.cpython-311.pyc', 'semantic-review/review.md', 'app.log', '.vercel/project.json'],
      policy,
    );

    expect(report.violations).toHaveLength(6);
    expect(report.violations.every((violation) => violation.type === 'denied-content')).toBe(true);
    expect(new Set(report.violations.map((violation) => violation.category))).toEqual(
      new Set(['secrets', 'unapproved-media', 'bytecode', 'semantic-review', 'logs', 'local-metadata']),
    );
  });

  it('rejects paths that escape the payload root', () => {
    expect(classifyPath('../backend/.env', policy)).toMatchObject({ decision: 'exclude', ruleId: 'invalid-path' });
    expect(classifyPath('/etc/passwd', policy)).toMatchObject({ decision: 'exclude', ruleId: 'invalid-path' });
  });

  it('keeps every declared sensitive local path excluded', () => {
    const { checked, violations } = inspectLocalExclusions(policy);

    expect(checked.length).toBeGreaterThanOrEqual(10);
    expect(violations).toEqual([]);
  });

  it.runIf(existsSync(resolve(root, 'dist')))('accepts the real built payload', async () => {
    const payloadFiles = await listPayloadFiles(resolve(root, 'dist'));
    const report = inspectManifest(payloadFiles, policy);

    expect(payloadFiles.length).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);

    const artifactReport = await inspectReleaseArtifacts(root);
    expect(artifactReport.violations).toEqual([]);
  });
});
