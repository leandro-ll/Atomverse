/**
 * Minimal deterministic path-glob matching shared by the release-manifest policy
 * and the CI test-suite registry.
 *
 * Supported syntax (POSIX-style relative paths only):
 *   `*`  matches any run of characters inside one path segment
 *   `?`  matches exactly one character inside one path segment
 *   `**` matches zero or more complete path segments
 */

const REGEXP_METACHARACTERS = /[\\^$.|+()[\]{}]/u;

export function normalizePath(candidatePath) {
  return String(candidatePath)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/')
    .replace(/\/+$/u, '');
}

function segmentToSource(segment) {
  let source = '';
  for (const character of segment) {
    if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += REGEXP_METACHARACTERS.test(character) ? `\\${character}` : character;
  }
  return source;
}

export function globToRegExp(pattern) {
  const segments = normalizePath(pattern).split('/');
  let source = '^';
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    if (segment === '**') {
      source += isLast ? '(?:[^/]+(?:/[^/]+)*)?' : '(?:[^/]+/)*';
      return;
    }
    source += segmentToSource(segment);
    if (!isLast) source += '/';
  });
  return new RegExp(`${source}$`, 'u');
}

export function matchesPattern(candidatePath, pattern) {
  return globToRegExp(pattern).test(normalizePath(candidatePath));
}

export function matchesAnyPattern(candidatePath, patterns) {
  const path = normalizePath(candidatePath);
  return (patterns ?? []).some((pattern) => globToRegExp(pattern).test(path));
}
