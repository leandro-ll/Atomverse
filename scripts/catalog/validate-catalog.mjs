/**
 * Canonical chemistry catalog validation.
 *
 * Validation runs in three layers and reports every layer in one pass:
 *
 * 1. Compatibility: the catalog's schema major version, the schema contract's
 *    own declared major version, the catalog release version, and the declared
 *    digest metadata. An incompatible schema major version is rejected with a
 *    localized, visible error instead of being coerced or partially read.
 * 2. Structure: JSON Schema 2020-12 execution of `catalog/chemistry.schema.json`
 *    against the catalog.
 * 3. Science and references: formula composition agreement, elemental balance,
 *    charge balance, reference integrity, and normalized pair keys.
 *
 * The digest layer then confirms that the committed digest artifact still
 * addresses exactly these bytes, so a released catalog version cannot be
 * edited in place.
 *
 * Usage:
 *   node scripts/catalog/validate-catalog.mjs [--json] [--no-digest]
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { CANONICALIZATION, DIGEST_ALGORITHM, DIGEST_SCOPE } from './canonical-json.mjs';
import { buildDigestRecord, compareDigestRecords } from './catalog-digest.mjs';
import {
  CATALOG_PATH,
  DIGEST_PATH,
  DIGEST_RELATIVE_PATH,
  SCHEMA_PATH,
  readJsonArtifact,
} from './catalog-paths.mjs';
import { collectInvariantViolations } from './catalog-invariants.mjs';

const Ajv = AjvModule.default ?? AjvModule;

/** The only catalog schema major version this build understands. */
export const SUPPORTED_SCHEMA_MAJOR = '2.0.0';

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;

/**
 * Localized, visible rejection message for an incompatible schema major
 * version.
 *
 * The message is owned by the validator rather than the catalog message bundle
 * on purpose: an artifact that is being rejected for being incompatible cannot
 * be trusted to supply the text explaining its own rejection.
 */
export function localizedIncompatibleSchemaMessage(foundVersion) {
  return (
    `Katalog kimia memakai versi mayor skema "${String(foundVersion)}" yang tidak didukung. ` +
    `Versi yang didukung adalah "${SUPPORTED_SCHEMA_MAJOR}". ` +
    'Katalog ditolak dan tidak ada perhitungan kimia yang dijalankan dengan artefak ini.'
  );
}

function violation(code, path, message, extra = {}) {
  return { code, path, message, ...extra };
}

/**
 * Checks version and digest metadata compatibility.
 *
 * Returns `fatal: true` when the artifacts declare an incompatible schema major
 * version, in which case no further layer is allowed to interpret them.
 */
export function collectCompatibilityViolations(catalog, schema) {
  const violations = [];

  if (catalog?.schemaVersion !== SUPPORTED_SCHEMA_MAJOR) {
    violations.push(
      violation(
        'SCHEMA_MAJOR_INCOMPATIBLE',
        'schemaVersion',
        `catalog declares schema major version ${JSON.stringify(catalog?.schemaVersion ?? null)} but only ${JSON.stringify(SUPPORTED_SCHEMA_MAJOR)} is supported`,
        { localizedMessage: localizedIncompatibleSchemaMessage(catalog?.schemaVersion ?? null) },
      ),
    );
  }

  const schemaContractVersion = schema?.properties?.schemaVersion?.const;
  if (schemaContractVersion !== SUPPORTED_SCHEMA_MAJOR) {
    violations.push(
      violation(
        'SCHEMA_CONTRACT_MAJOR_INCOMPATIBLE',
        'properties.schemaVersion.const',
        `schema contract pins major version ${JSON.stringify(schemaContractVersion ?? null)} but only ${JSON.stringify(SUPPORTED_SCHEMA_MAJOR)} is supported`,
        { localizedMessage: localizedIncompatibleSchemaMessage(schemaContractVersion ?? null) },
      ),
    );
  }

  if (violations.length > 0) return { violations, fatal: true };

  if (!SEMANTIC_VERSION.test(catalog?.catalogVersion ?? '')) {
    violations.push(
      violation(
        'CATALOG_VERSION_INVALID',
        'catalogVersion',
        `catalogVersion ${JSON.stringify(catalog?.catalogVersion ?? null)} is not a semantic version`,
      ),
    );
  }

  const declaredDigest = catalog?.digest ?? {};
  const expectedDigestMetadata = {
    algorithm: DIGEST_ALGORITHM,
    canonicalization: CANONICALIZATION,
    scope: DIGEST_SCOPE,
    valueFile: DIGEST_RELATIVE_PATH,
  };
  for (const [field, expected] of Object.entries(expectedDigestMetadata)) {
    if (declaredDigest[field] !== expected) {
      violations.push(
        violation(
          'DIGEST_METADATA_UNSUPPORTED',
          `digest.${field}`,
          `digest.${field} is ${JSON.stringify(declaredDigest[field] ?? null)} but this build only generates ${JSON.stringify(expected)}`,
        ),
      );
    }
  }

  return { violations, fatal: false };
}

function createValidator(schema) {
  // Strict mode is disabled because the committed schema intentionally uses
  // keyword combinations (numeric constraints layered over `allOf` references)
  // that ajv's strict heuristics flag as ambiguous even though 2020-12 defines
  // them precisely.
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

/** Executes the JSON Schema contract against the catalog. */
export function collectSchemaViolations(catalog, schema) {
  const validate = createValidator(schema);
  if (validate(catalog)) return [];
  return (validate.errors ?? []).map((error) =>
    violation(
      'SCHEMA_VIOLATION',
      error.instancePath === '' ? '$' : error.instancePath,
      `${error.instancePath === '' ? '$' : error.instancePath} ${error.message} (${error.schemaPath})`,
    ),
  );
}

/** Compares the committed digest artifact against the artifacts it addresses. */
export function collectDigestViolations(catalog, schema, committedRecord) {
  const expected = buildDigestRecord(catalog, schema);
  const comparison = compareDigestRecords(committedRecord, expected);

  if (!committedRecord) {
    return {
      expected,
      violations: [
        violation(
          'DIGEST_ARTIFACT_MISSING',
          DIGEST_RELATIVE_PATH,
          `${DIGEST_RELATIVE_PATH} is missing. Generate it with "npm run catalog:digest".`,
        ),
      ],
    };
  }

  const violations = comparison.drift.map((reason) =>
    violation('DIGEST_MISMATCH', DIGEST_RELATIVE_PATH, `${DIGEST_RELATIVE_PATH} ${reason}`),
  );

  if (comparison.mutatedRelease) {
    violations.push(
      violation(
        'RELEASE_IMMUTABILITY_VIOLATION',
        'catalogVersion',
        `catalog version ${expected.catalogVersion} is already released with a different digest. Released catalog artifacts are immutable: bump catalogVersion instead of editing the released content.`,
      ),
    );
  }

  return { expected, violations };
}

/**
 * Validates in-memory catalog documents.
 *
 * `digestRecord` is only compared when `checkDigest` is true; pass the parsed
 * committed digest artifact, or `null` when it does not exist.
 */
export function validateCatalogDocuments({ catalog, schema, digestRecord = null, checkDigest = true }) {
  const compatibility = collectCompatibilityViolations(catalog, schema);
  if (compatibility.fatal) {
    return {
      ok: false,
      fatal: true,
      expectedDigest: null,
      violations: compatibility.violations,
    };
  }

  const violations = [
    ...compatibility.violations,
    ...collectSchemaViolations(catalog, schema),
    ...collectInvariantViolations(catalog),
  ];

  let expectedDigest = null;
  if (checkDigest) {
    const digest = collectDigestViolations(catalog, schema, digestRecord);
    expectedDigest = digest.expected;
    violations.push(...digest.violations);
  }

  return { ok: violations.length === 0, fatal: false, expectedDigest, violations };
}

/** Validates the committed catalog, schema, and digest artifacts. */
export async function validateCommittedCatalog({ checkDigest = true } = {}) {
  const [catalog, schema, digestRecord] = await Promise.all([
    readJsonArtifact(CATALOG_PATH),
    readJsonArtifact(SCHEMA_PATH),
    checkDigest ? readJsonArtifact(DIGEST_PATH) : Promise.resolve(null),
  ]);

  if (!catalog || !schema) {
    return {
      ok: false,
      fatal: true,
      expectedDigest: null,
      violations: [
        violation(
          'ARTIFACT_MISSING',
          catalog ? 'catalog/chemistry.schema.json' : 'catalog/chemistry.catalog.json',
          'the committed catalog and schema artifacts must both exist',
        ),
      ],
    };
  }

  return validateCatalogDocuments({ catalog, schema, digestRecord, checkDigest });
}

function formatReport(report) {
  if (report.ok) {
    return `[catalog] validation passed. catalog digest ${report.expectedDigest?.catalogDigest ?? '(not checked)'}\n`;
  }
  const lines = [`[catalog] validation failed with ${report.violations.length} violation(s):`];
  for (const item of report.violations) {
    lines.push(`  - ${item.code} at ${item.path}: ${item.message}`);
    if (item.localizedMessage) lines.push(`    id-ID: ${item.localizedMessage}`);
  }
  return `${lines.join('\n')}\n`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const report = await validateCommittedCatalog({ checkDigest: !process.argv.includes('--no-digest') });
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}
