/**
 * Canonical JSON serialization and content digests for catalog artifacts.
 *
 * The canonical form is the one declared by `catalog/chemistry.catalog.json`
 * (`digest.canonicalization`): UTF-8 JSON with object keys sorted and no
 * insignificant whitespace. Serializing the same logical value always produces
 * the same bytes, so a digest over that form is stable across machines and
 * across key insertion order.
 */

import { createHash } from 'node:crypto';

/** Declared canonicalization identifier recorded in catalog and digest artifacts. */
export const CANONICALIZATION = 'utf8-json-sorted-keys-no-insignificant-whitespace';

/** Declared digest algorithm recorded in catalog and digest artifacts. */
export const DIGEST_ALGORITHM = 'sha256';

/** Declared digest scope recorded in catalog and digest artifacts. */
export const DIGEST_SCOPE = 'every catalog field except the digest value artifact itself';

/**
 * Serializes a JSON value to its canonical string form.
 *
 * Object keys are sorted by UTF-16 code unit (`Array.prototype.sort` default),
 * `undefined` members are dropped, and any value JSON cannot represent exactly
 * (non-finite numbers, functions, symbols, bigints) is rejected instead of being
 * silently coerced.
 */
export function canonicalizeJson(value, path = '$') {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'boolean') return value ? 'true' : 'false';

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite number to be canonicalized, received ${String(value)}`);
    }
    return JSON.stringify(value);
  }

  if (type === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    const items = value.map((item, index) => canonicalizeJson(item, `${path}[${index}]`));
    return `[${items.join(',')}]`;
  }

  if (type === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key], `${path}.${key}`)}`);
    return `{${members.join(',')}}`;
  }

  throw new TypeError(`${path} has non-JSON type ${type} and cannot be canonicalized`);
}

/** Lowercase hexadecimal sha256 digest of the canonical form of a JSON value. */
export function digestJson(value) {
  return createHash(DIGEST_ALGORITHM).update(canonicalizeJson(value), 'utf8').digest('hex');
}

/** True when the string is a lowercase hexadecimal sha256 digest. */
export function isDigestValue(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}
