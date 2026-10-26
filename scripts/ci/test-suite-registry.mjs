/**
 * CI test-suite registry evaluation.
 *
 * The registry makes empty-suite handling explicit: a suite either declares
 * `emptyPolicy: "fail"` (zero matched files is a CI violation) or
 * `emptyPolicy: "allow"` together with a written reason (the suite is reported
 * as `declared-empty` and its command is never invoked, so an empty run can
 * never be mistaken for a passing run).
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { matchesAnyPattern, normalizePath } from './path-glob.mjs';

export const REGISTRY_URL = new URL('./test-suites.json', import.meta.url);

const EMPTY_POLICIES = new Set(['fail', 'allow']);
const MINIMUM_EMPTY_REASON_LENGTH = 20;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.kiro',
  '.ruff_cache',
  '.venv',
  '.vercel',
  '.vite',
  '__pycache__',
  'coverage',
  'dist',
  'node_modules',
]);

export async function loadRegistry(registryPath = REGISTRY_URL) {
  return JSON.parse(await readFile(registryPath, 'utf8'));
}

export function validateRegistry(registry) {
  const violations = [];
  if (typeof registry?.registryVersion !== 'string') violations.push('registryVersion must be a string');

  for (const [runnerId, runner] of Object.entries(registry?.runners ?? {})) {
    if (runner.emptyExitCode !== null && !Number.isInteger(runner.emptyExitCode)) {
      violations.push(`runner ${runnerId} must declare emptyExitCode as an integer or null`);
    }
    if (!runner.emptyExitCodeReason) violations.push(`runner ${runnerId} must document emptyExitCodeReason`);
    if (!runner.exitCodes || Object.keys(runner.exitCodes).length === 0) {
      violations.push(`runner ${runnerId} must map exit codes to outcomes`);
    }
    if (runner.exitCodes?.['0'] !== 'passed') violations.push(`runner ${runnerId} must map exit code 0 to "passed"`);
    if (runner.emptyExitCode !== null && runner.exitCodes?.[String(runner.emptyExitCode)]) {
      violations.push(`runner ${runnerId} must not map its empty exit code ${runner.emptyExitCode} to an outcome`);
    }
  }

  if (!Array.isArray(registry?.suites) || registry.suites.length === 0) {
    violations.push('suites must be a non-empty array');
    return violations;
  }

  const seen = new Set();
  for (const suite of registry.suites) {
    if (!suite.id) violations.push('suite is missing an id');
    if (seen.has(suite.id)) violations.push(`duplicate suite id: ${suite.id}`);
    seen.add(suite.id);
    if (!suite.description) violations.push(`suite ${suite.id} must document a description`);
    if (!registry.runners?.[suite.runner]) violations.push(`suite ${suite.id} references unknown runner ${suite.runner}`);
    if (!Array.isArray(suite.command) || suite.command.length === 0) {
      violations.push(`suite ${suite.id} must declare a command`);
    } else if (!['{node}', '{python}'].includes(suite.command[0])) {
      violations.push(`suite ${suite.id} must start its command with the {node} or {python} placeholder so no shell or PATH shim is required`);
    }
    if (!Array.isArray(suite.include) || suite.include.length === 0) {
      violations.push(`suite ${suite.id} must declare at least one include pattern`);
    }
    if (!EMPTY_POLICIES.has(suite.emptyPolicy)) {
      violations.push(`suite ${suite.id} must declare emptyPolicy as "fail" or "allow"`);
    }
    if (suite.emptyPolicy === 'allow' && (suite.emptyReason ?? '').length < MINIMUM_EMPTY_REASON_LENGTH) {
      violations.push(`suite ${suite.id} allows an empty match set and must document emptyReason`);
    }
    if (suite.emptyPolicy === 'fail' && suite.emptyReason) {
      violations.push(`suite ${suite.id} fails on an empty match set and must not declare emptyReason`);
    }
  }

  return violations;
}

export function resolveSuiteStatus(suite, matchedFileCount) {
  if (!Number.isInteger(matchedFileCount) || matchedFileCount < 0) {
    return { status: 'violation', reason: `Matched file count for ${suite.id} must be a nonnegative integer.` };
  }
  if (matchedFileCount > 0) {
    return { status: 'run', reason: `${matchedFileCount} test file(s) matched ${suite.include.join(', ')}.` };
  }
  if (suite.emptyPolicy === 'allow') {
    return { status: 'declared-empty', reason: suite.emptyReason };
  }
  return {
    status: 'violation',
    reason: `Suite ${suite.id} matched no test files and declares emptyPolicy "fail"; an empty suite must never report success.`,
  };
}

export function interpretExitCode(registry, runnerId, exitCode) {
  const runner = registry.runners?.[runnerId];
  if (!runner) return { outcome: 'failed', reason: `Unknown runner ${runnerId}.` };
  if (runner.emptyExitCode !== null && exitCode === runner.emptyExitCode) {
    return { outcome: 'empty', reason: runner.emptyExitCodeReason };
  }
  const outcome = runner.exitCodes?.[String(exitCode)];
  if (!outcome) return { outcome: 'failed', reason: `Unmapped ${runnerId} exit code ${exitCode}.` };
  return { outcome, reason: `${runnerId} exit code ${exitCode}.` };
}

export async function listRepositoryFiles(rootDirectory) {
  const root = resolve(rootDirectory);
  const files = [];

  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(resolve(current, entry.name));
      } else if (entry.isFile()) {
        files.push(normalizePath(resolve(current, entry.name).slice(root.length + 1)));
      }
    }
  }

  await walk(root);
  return files.sort();
}

export function matchSuiteFiles(suite, repositoryFiles) {
  return repositoryFiles.filter((path) => matchesAnyPattern(path, suite.include));
}

export function resolvePythonExecutable(rootDirectory, platform = process.platform, environment = process.env) {
  if (environment.ATOMVERSE_PYTHON) return environment.ATOMVERSE_PYTHON;
  const relative = platform === 'win32' ? 'backend/.venv/Scripts/python.exe' : 'backend/.venv/bin/python';
  return resolve(rootDirectory, relative);
}

/**
 * Resolves the declared command tokens to executables. Suites use `{node}` and
 * `{python}` placeholders so no suite depends on a shell, a `PATH` lookup, or a
 * Windows `.cmd` shim.
 */
export function resolveCommand(suite, { rootDirectory, platform = process.platform, environment = process.env }) {
  const nodeExecutable = environment.ATOMVERSE_NODE ?? process.execPath;
  const [executable, ...args] = suite.command.map((token) => {
    if (token === '{python}') return resolvePythonExecutable(rootDirectory, platform, environment);
    if (token === '{node}') return nodeExecutable;
    return token;
  });
  return { executable, args };
}
