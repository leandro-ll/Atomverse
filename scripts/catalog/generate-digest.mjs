/**
 * Deterministic digest generation for the canonical chemistry artifacts.
 *
 * Writing `catalog/chemistry.digest.json` is a pure function of the committed
 * catalog and schema, so regenerating from unchanged artifacts rewrites the same
 * bytes. Because a released catalog version is immutable, the generator refuses
 * to republish an existing catalog version under a new digest unless the caller
 * explicitly asks for a rewrite.
 *
 * Usage:
 *   node scripts/catalog/generate-digest.mjs            # write the digest artifact
 *   node scripts/catalog/generate-digest.mjs --check     # verify without writing
 *   node scripts/catalog/generate-digest.mjs --allow-rewrite
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDigestRecord, compareDigestRecords, formatDigestRecord } from './catalog-digest.mjs';
import {
  CATALOG_PATH,
  DIGEST_PATH,
  DIGEST_RELATIVE_PATH,
  SCHEMA_PATH,
  readJsonArtifact,
} from './catalog-paths.mjs';

/**
 * Builds the digest artifact and, unless `check` is set, writes it.
 *
 * Returns the record, its committed bytes, and the reason a write was refused.
 */
export async function generateDigestArtifact({ check = false, allowRewrite = false, digestPath = DIGEST_PATH } = {}) {
  const [catalog, schema, committed] = await Promise.all([
    readJsonArtifact(CATALOG_PATH),
    readJsonArtifact(SCHEMA_PATH),
    readJsonArtifact(digestPath),
  ]);

  if (!catalog || !schema) {
    return {
      ok: false,
      written: false,
      record: null,
      contents: null,
      reason: 'the committed catalog and schema artifacts must both exist',
    };
  }

  const record = buildDigestRecord(catalog, schema);
  const contents = formatDigestRecord(record);
  const comparison = compareDigestRecords(committed, record);

  if (comparison.matches) {
    return { ok: true, written: false, record, contents, reason: 'digest artifact is already current' };
  }

  if (comparison.mutatedRelease && !allowRewrite) {
    return {
      ok: false,
      written: false,
      record,
      contents,
      reason:
        `catalog version ${record.catalogVersion} is already released under a different digest. ` +
        'Released catalog artifacts are immutable: bump catalogVersion, or pass --allow-rewrite for an unreleased draft.',
    };
  }

  if (check) {
    return {
      ok: false,
      written: false,
      record,
      contents,
      reason: `${DIGEST_RELATIVE_PATH} is out of date: ${comparison.drift.join('; ')}`,
    };
  }

  await writeFile(digestPath, contents, 'utf8');
  return { ok: true, written: true, record, contents, reason: 'digest artifact regenerated' };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const result = await generateDigestArtifact({
    check: process.argv.includes('--check'),
    allowRewrite: process.argv.includes('--allow-rewrite'),
  });

  const label = result.ok ? '[catalog]' : '[catalog] error:';
  process.stdout.write(`${label} ${result.reason}\n`);
  if (result.record) {
    process.stdout.write(`[catalog] catalog ${result.record.catalogVersion} digest ${result.record.catalogDigest}\n`);
  }
  if (!result.ok) process.exitCode = 1;
}
