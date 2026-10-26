/**
 * Repository-relative locations of the canonical chemistry artifacts.
 *
 * Every catalog script resolves paths through this module so the committed
 * artifact locations are declared in exactly one place.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..');

export const CATALOG_RELATIVE_PATH = 'catalog/chemistry.catalog.json';
export const SCHEMA_RELATIVE_PATH = 'catalog/chemistry.schema.json';
export const DIGEST_RELATIVE_PATH = 'catalog/chemistry.digest.json';

export const JAVASCRIPT_BINDING_RELATIVE_PATH = 'js/generated/chemistry-catalog.js';
export const PYTHON_BINDING_RELATIVE_PATH = 'backend/app/generated/chemistry_catalog.py';

export const CATALOG_PATH = resolve(REPOSITORY_ROOT, CATALOG_RELATIVE_PATH);
export const SCHEMA_PATH = resolve(REPOSITORY_ROOT, SCHEMA_RELATIVE_PATH);
export const DIGEST_PATH = resolve(REPOSITORY_ROOT, DIGEST_RELATIVE_PATH);

export const JAVASCRIPT_BINDING_PATH = resolve(REPOSITORY_ROOT, JAVASCRIPT_BINDING_RELATIVE_PATH);
export const PYTHON_BINDING_PATH = resolve(REPOSITORY_ROOT, PYTHON_BINDING_RELATIVE_PATH);

/** Reads a UTF-8 text artifact. Returns `null` when the file is absent. */
export async function readTextArtifact(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Reads and parses a JSON artifact. Returns `null` when the file is absent. */
export async function readJsonArtifact(path) {
  const raw = await readTextArtifact(path);
  return raw === null ? null : JSON.parse(raw);
}
