import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  interpretExitCode,
  listRepositoryFiles,
  loadRegistry,
  matchSuiteFiles,
  resolveCommand,
  resolveSuiteStatus,
  validateRegistry,
} from '../../scripts/ci/test-suite-registry.mjs';

const root = resolve(import.meta.dirname, '..', '..');

/** Validates: Requirements 25.7 */
describe('CI test-suite registry', () => {
  let registry;
  let repositoryFiles;

  beforeAll(async () => {
    registry = await loadRegistry();
    repositoryFiles = await listRepositoryFiles(root);
  });

  it('declares a valid registry with an explicit empty policy per suite', () => {
    expect(validateRegistry(registry)).toEqual([]);
    for (const suite of registry.suites) {
      expect(['fail', 'allow']).toContain(suite.emptyPolicy);
    }
  });

  it('registers the baseline frontend, repository, backend, and reserved suites', () => {
    expect(registry.suites.map((suite) => suite.id)).toEqual([
      'frontend-unit',
      'ci-policy',
      'repository-safety',
      'backend-unit',
      'chemistry-domain',
      'backend-contracts',
    ]);
  });

  it('treats an unmatched required suite as a violation and a reserved suite as declared-empty', () => {
    const required = registry.suites.find((suite) => suite.id === 'frontend-unit');
    const reserved = registry.suites.find((suite) => suite.id === 'backend-contracts');

    expect(resolveSuiteStatus(required, 0).status).toBe('violation');
    expect(resolveSuiteStatus(required, 3).status).toBe('run');
    expect(resolveSuiteStatus(reserved, 0)).toEqual({ status: 'declared-empty', reason: reserved.emptyReason });
    expect(resolveSuiteStatus(reserved, 2).status).toBe('run');
    expect(resolveSuiteStatus(required, -1).status).toBe('violation');
  });

  it('rejects a registry that hides an empty suite', () => {
    const silent = {
      ...registry,
      suites: [{ ...registry.suites[0], emptyPolicy: 'allow', emptyReason: 'too short' }],
    };
    const undocumented = {
      ...registry,
      suites: [{ ...registry.suites[0], emptyPolicy: 'skip' }],
    };
    const successfulEmptyExit = {
      ...registry,
      runners: { ...registry.runners, pytest: { ...registry.runners.pytest, exitCodes: { 0: 'passed', 5: 'passed' } } },
    };

    expect(validateRegistry(silent).join(' ')).toContain('emptyReason');
    expect(validateRegistry(undocumented).join(' ')).toContain('emptyPolicy');
    expect(validateRegistry(successfulEmptyExit).join(' ')).toContain('empty exit code 5');
  });

  it('maps runner exit codes without turning an empty run into success', () => {
    expect(interpretExitCode(registry, 'pytest', 0).outcome).toBe('passed');
    expect(interpretExitCode(registry, 'pytest', 1).outcome).toBe('failed');
    expect(interpretExitCode(registry, 'pytest', 5).outcome).toBe('empty');
    expect(interpretExitCode(registry, 'pytest', 99).outcome).toBe('failed');
    expect(interpretExitCode(registry, 'vitest', 0).outcome).toBe('passed');
    expect(interpretExitCode(registry, 'vitest', 1).outcome).toBe('failed');
    expect(interpretExitCode(registry, 'unknown', 0).outcome).toBe('failed');
  });

  it('matches at least one real test file for every suite that forbids an empty run', () => {
    for (const suite of registry.suites.filter((item) => item.emptyPolicy === 'fail')) {
      expect(matchSuiteFiles(suite, repositoryFiles).length, suite.id).toBeGreaterThan(0);
    }
    for (const suite of registry.suites.filter((item) => item.emptyPolicy === 'allow')) {
      expect(matchSuiteFiles(suite, repositoryFiles), suite.id).toEqual([]);
    }
  });

  it('resolves platform-specific interpreters and package runners', () => {
    const backendSuite = registry.suites.find((suite) => suite.id === 'backend-unit');
    const frontendSuite = registry.suites.find((suite) => suite.id === 'frontend-unit');

    const windows = resolveCommand(backendSuite, { rootDirectory: root, platform: 'win32', environment: {} });
    const posix = resolveCommand(backendSuite, { rootDirectory: root, platform: 'linux', environment: {} });
    const overridden = resolveCommand(backendSuite, { rootDirectory: root, platform: 'linux', environment: { ATOMVERSE_PYTHON: 'python3' } });
    const frontend = resolveCommand(frontendSuite, { rootDirectory: root, platform: 'win32', environment: { ATOMVERSE_NODE: '/usr/bin/node' } });

    expect(windows.executable).toContain('.venv');
    expect(windows.executable.endsWith('python.exe')).toBe(true);
    expect(posix.executable.replaceAll('\\', '/').endsWith('.venv/bin/python')).toBe(true);
    expect(overridden.executable).toBe('python3');
    expect(frontend.executable).toBe('/usr/bin/node');
    expect(frontend.args[0]).toBe('node_modules/vitest/vitest.mjs');
  });
});
