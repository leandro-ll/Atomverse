import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RESOURCE_TAG_PATTERN = /<(script|link|img|source)\b[^>]*?\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
const REMOTE_REFERENCE_PATTERN = /^(?:https?:)?\/\//iu;
const REMOTE_CSS_PATTERN = /(?:@import\s+(?:url\()?|url\()\s*["']?(?:https?:)?\/\//iu;

export function findRemoteRuntimeAssets(html) {
  const violations = [];
  for (const match of html.matchAll(RESOURCE_TAG_PATTERN)) {
    const reference = match[3] ?? match[4] ?? match[5] ?? '';
    if (REMOTE_REFERENCE_PATTERN.test(reference)) {
      violations.push({ tag: match[1].toLowerCase(), attribute: match[2].toLowerCase(), reference });
    }
  }
  return violations;
}

export function hasRemoteCssAsset(css) {
  return REMOTE_CSS_PATTERN.test(css);
}

async function listCssFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listCssFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(path);
  }
  return files;
}

async function assertLocalReferencesExist(html, outputDirectory) {
  const missing = [];
  for (const match of html.matchAll(RESOURCE_TAG_PATTERN)) {
    const reference = match[3] ?? match[4] ?? match[5] ?? '';
    if (!reference || reference.startsWith('#') || reference.startsWith('data:') || REMOTE_REFERENCE_PATTERN.test(reference)) continue;
    const relativePath = decodeURIComponent(reference.split(/[?#]/u, 1)[0]).replace(/^\.\//u, '').replace(/^\//u, '');
    const candidate = resolve(outputDirectory, relativePath);
    const relation = relative(resolve(outputDirectory), candidate);
    if (relation.startsWith('..') || isAbsolute(relation)) {
      missing.push(`${reference} (outside output directory)`);
      continue;
    }
    try {
      if (!(await stat(candidate)).isFile()) missing.push(reference);
    } catch {
      missing.push(reference);
    }
  }
  if (missing.length > 0) throw new Error(`Built HTML references missing local assets: ${missing.join(', ')}`);
}

const FORBIDDEN_BUILD_TOKENS = ['chempy', 'sympy', 'scipy', 'catalog/seed'];

export async function findForbiddenBuildTokens(outputDirectory) {
  const violations = [];
  const textExtensions = ['.html', '.js', '.mjs', '.cjs', '.css', '.json', '.svg', '.txt', '.map'];

  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await inspect(fullPath);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
        if (textExtensions.includes(ext)) {
          const content = await readFile(fullPath, 'utf8');
          // Provenance metadata {"toolkit": {"name": "chempy"}} is part of catalog specification (Requirement 2.4).
          // Strip this exact provenance entry so library/code leak checks don't false-positive on it.
          const lower = content
            .toLowerCase()
            .replace(/toolkit\s*:\s*\{\s*name\s*:\s*[`"']chempy[`"']/gu, '')
            .replace(/"name"\s*:\s*"chempy"/gu, '');
          for (const token of FORBIDDEN_BUILD_TOKENS) {
            if (lower.includes(token) || (token === 'catalog/seed' && lower.includes('catalog\\seed'))) {
              violations.push({ file: relative(outputDirectory, fullPath), token });
            }
          }
        }
      }
    }
  }

  await inspect(outputDirectory);
  return violations;
}

export async function verifyBuild(rootDirectory) {
  const sourceHtml = await readFile(resolve(rootDirectory, 'index.html'), 'utf8');
  const outputDirectory = resolve(rootDirectory, 'dist');
  const builtHtml = await readFile(resolve(outputDirectory, 'index.html'), 'utf8');
  const violations = [
    ...findRemoteRuntimeAssets(sourceHtml).map((item) => `source:${item.reference}`),
    ...findRemoteRuntimeAssets(builtHtml).map((item) => `build:${item.reference}`),
  ];

  for (const cssPath of await listCssFiles(outputDirectory)) {
    if (hasRemoteCssAsset(await readFile(cssPath, 'utf8'))) violations.push(`build-css:${cssPath}`);
  }

  if (violations.length > 0) throw new Error(`Remote runtime assets are not allowed: ${violations.join(', ')}`);
  await assertLocalReferencesExist(builtHtml, outputDirectory);

  const forbiddenViolations = await findForbiddenBuildTokens(outputDirectory);
  if (forbiddenViolations.length > 0) {
    const details = forbiddenViolations
      .map((item) => `${item.file} contains forbidden token "${item.token}"`)
      .join(', ');
    throw new Error(`Built assets contain forbidden chemistry build tokens: ${details}`);
  }

  return { sourceChecked: true, buildChecked: true, remoteRuntimeAssets: 0, buildTokensChecked: true };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const result = await verifyBuild(rootDirectory);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
