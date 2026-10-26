/**
 * Digest record construction for the canonical chemistry artifacts.
 *
 * The digest record is the digest-addressed identity of one released catalog
 * version. It is derived purely from the committed catalog and schema, so
 * regenerating it from unchanged artifacts always produces the same bytes, and
 * any edit to a released catalog version changes the digest and is rejected as
 * a mutation of an immutable release.
 */

import {
  CANONICALIZATION,
  DIGEST_ALGORITHM,
  DIGEST_SCOPE,
  canonicalizeJson,
  digestJson,
} from './canonical-json.mjs';
import { CATALOG_RELATIVE_PATH, SCHEMA_RELATIVE_PATH } from './catalog-paths.mjs';

/**
 * Builds the digest record for a catalog/schema pair.
 *
 * The catalog digest covers every catalog field, including the `digest`
 * metadata block that declares how the digest is computed. Only the generated
 * digest value artifact itself is outside the scope, because a value cannot
 * cover itself.
 */
export function buildDigestRecord(catalog, schema) {
  return {
    algorithm: DIGEST_ALGORITHM,
    canonicalization: CANONICALIZATION,
    scope: DIGEST_SCOPE,
    schemaVersion: catalog?.schemaVersion ?? null,
    catalogVersion: catalog?.catalogVersion ?? null,
    locale: catalog?.locale ?? null,
    catalogFile: CATALOG_RELATIVE_PATH,
    catalogDigest: digestJson(catalog),
    schemaFile: SCHEMA_RELATIVE_PATH,
    schemaDigest: digestJson(schema),
  };
}

/**
 * Serializes a digest record to its committed bytes: canonical JSON plus one
 * trailing newline so the artifact is a well-formed text file.
 */
export function formatDigestRecord(record) {
  return `${canonicalizeJson(record)}\n`;
}

/**
 * Compares a committed digest record against the record rebuilt from the
 * current artifacts.
 *
 * `drift` means the committed record disagrees with the artifacts it claims to
 * describe. `mutatedRelease` means a released catalog version kept its version
 * number while its content digest changed, which release immutability forbids.
 */
export function compareDigestRecords(committed, expected) {
  if (!committed) {
    return { matches: false, drift: ['digest artifact is missing'], mutatedRelease: false };
  }

  const drift = [];
  for (const field of Object.keys(expected)) {
    if (committed[field] !== expected[field]) {
      drift.push(`${field} is ${JSON.stringify(committed[field] ?? null)} but should be ${JSON.stringify(expected[field])}`);
    }
  }
  for (const field of Object.keys(committed)) {
    if (!(field in expected)) drift.push(`${field} is not part of the digest record contract`);
  }

  const mutatedRelease =
    committed.catalogVersion === expected.catalogVersion &&
    (committed.catalogDigest !== expected.catalogDigest || committed.schemaDigest !== expected.schemaDigest);

  return { matches: drift.length === 0, drift, mutatedRelease };
}
