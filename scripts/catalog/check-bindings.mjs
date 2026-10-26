/**
 * Parity verification for the generated chemistry catalog bindings.
 *
 * The frontend and the backend each read chemistry data from their own
 * generated binding. That is only safe while both bindings describe the same
 * catalog release, so this check fails when:
 *
 * - a binding is missing, or its embedded manifest cannot be read;
 * - a binding's bytes differ from what the current catalog regenerates, which
 *   means it was hand-edited or left behind by an older catalog version;
 * - a binding's catalog version, schema version, locale, catalog digest, or
 *   schema digest disagrees with the committed catalog;
 * - a binding's supported definitions disagree with the catalog, by digest or
 *   field by field;
 * - the two bindings disagree with each other.
 *
 * Bindings are inspected as text. Nothing here imports the frontend module or
 * runs a Python interpreter, so the check reports on exactly the committed
 * bytes and needs no runtime from either side.
 *
 * Usage:
 *   node scripts/catalog/check-bindings.mjs [--json]
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalizeJson } from './canonical-json.mjs';
import {
  BINDING_TARGETS,
  buildBindingManifest,
  extractBindingManifest,
} from './catalog-bindings.mjs';
import {
  CATALOG_PATH,
  JAVASCRIPT_BINDING_PATH,
  PYTHON_BINDING_PATH,
  SCHEMA_PATH,
  readJsonArtifact,
  readTextArtifact,
} from './catalog-paths.mjs';

function violation(code, path, message) {
  return { code, path, message };
}

/** Contract fields compared one by one, each with its own failure code. */
const CONTRACT_FIELD_CODES = Object.freeze({
  bindingContractVersion: 'BINDING_CONTRACT_VERSION_DIVERGENCE',
  schemaVersion: 'SCHEMA_VERSION_DIVERGENCE',
  catalogVersion: 'CATALOG_VERSION_DIVERGENCE',
  locale: 'LOCALE_DIVERGENCE',
  digestAlgorithm: 'DIGEST_METADATA_DIVERGENCE',
  canonicalization: 'DIGEST_METADATA_DIVERGENCE',
  catalogFile: 'CATALOG_SOURCE_DIVERGENCE',
  catalogDigest: 'CATALOG_DIGEST_DIVERGENCE',
  schemaFile: 'SCHEMA_SOURCE_DIVERGENCE',
  schemaDigest: 'SCHEMA_DIGEST_DIVERGENCE',
  digestValueFile: 'DIGEST_METADATA_DIVERGENCE',
  definitionsDigest: 'SUPPORTED_DEFINITIONS_DIVERGENCE',
});

const describe = (value) => JSON.stringify(value ?? null);

/** Compares one binding's embedded contract against the expected contract. */
function collectContractViolations(label, path, contract, expected) {
  const violations = [];

  for (const [field, code] of Object.entries(CONTRACT_FIELD_CODES)) {
    if (contract[field] !== expected[field]) {
      violations.push(
        violation(
          code,
          path,
          `${label} embeds ${field} ${describe(contract[field])} but the committed catalog requires ${describe(expected[field])}`,
        ),
      );
    }
  }

  for (const field of Object.keys(contract)) {
    if (!(field in expected)) {
      violations.push(
        violation('BINDING_CONTRACT_FIELD_UNKNOWN', path, `${label} embeds ${field}, which is not part of the binding contract`),
      );
    }
  }

  return violations;
}

/**
 * Compares one binding's supported definitions against the expected inventory.
 *
 * The digest comparison above already detects any divergence; this pass names
 * the diverging groups so a failure report points at the definitions that moved
 * instead of only at a changed hash.
 */
function collectDefinitionViolations(label, path, definitions, expected) {
  const violations = [];
  const groups = new Set([...Object.keys(expected), ...Object.keys(definitions)]);

  for (const group of [...groups].sort()) {
    if (!(group in definitions)) {
      violations.push(
        violation('SUPPORTED_DEFINITIONS_DIVERGENCE', path, `${label} omits the supported definition group ${group}`),
      );
      continue;
    }
    if (!(group in expected)) {
      violations.push(
        violation('SUPPORTED_DEFINITIONS_DIVERGENCE', path, `${label} declares unknown supported definition group ${group}`),
      );
      continue;
    }
    if (canonicalizeJson(definitions[group]) !== canonicalizeJson(expected[group])) {
      violations.push(
        violation(
          'SUPPORTED_DEFINITIONS_DIVERGENCE',
          path,
          `${label} supported definition group ${group} does not match the committed catalog`,
        ),
      );
    }
  }

  return violations;
}

/**
 * Checks in-memory binding sources against a catalog and schema.
 *
 * `sources` maps a binding id (`javascript`, `python`) to its committed text, or
 * to `null` when the file is absent.
 */
export function checkBindingSources({ catalog, schema, sources }) {
  const expectedManifest = buildBindingManifest(catalog, schema);
  const violations = [];
  const bindings = [];

  for (const target of BINDING_TARGETS) {
    const source = sources?.[target.id] ?? null;
    const path = target.relativePath;
    const label = target.relativePath;

    if (source === null) {
      violations.push(
        violation('BINDING_MISSING', path, `${label} is missing. Generate it with "npm run catalog:generate".`),
      );
      bindings.push({ id: target.id, relativePath: path, present: false, current: false, manifest: null });
      continue;
    }

    const current = source === target.build(catalog, schema);
    if (!current) {
      violations.push(
        violation(
          'BINDING_STALE',
          path,
          `${label} does not match the bytes the committed catalog generates. Regenerate it with "npm run catalog:generate".`,
        ),
      );
    }

    const extracted = extractBindingManifest(source);
    if (!extracted.value) {
      violations.push(violation('BINDING_MANIFEST_UNREADABLE', path, `${label} ${extracted.reason}`));
      bindings.push({ id: target.id, relativePath: path, present: true, current, manifest: null });
      continue;
    }

    violations.push(...collectContractViolations(label, path, extracted.value.contract, expectedManifest.contract));
    violations.push(
      ...collectDefinitionViolations(label, path, extracted.value.supportedDefinitions, expectedManifest.supportedDefinitions),
    );

    bindings.push({ id: target.id, relativePath: path, present: true, current, manifest: extracted.value });
  }

  const readable = bindings.filter((binding) => binding.manifest !== null);
  if (readable.length === BINDING_TARGETS.length) {
    const [first, second] = readable;
    if (canonicalizeJson(first.manifest) !== canonicalizeJson(second.manifest)) {
      violations.push(
        violation(
          'BINDING_PAIR_DIVERGENCE',
          `${first.relativePath}, ${second.relativePath}`,
          `${first.relativePath} and ${second.relativePath} embed different catalog manifests, so the frontend and the backend would calculate from different definitions`,
        ),
      );
    }
  }

  return {
    ok: violations.length === 0,
    contract: expectedManifest.contract,
    bindings: bindings.map(({ manifest, ...rest }) => rest),
    violations,
  };
}

/** Checks the committed bindings against the committed catalog and schema. */
export async function checkCommittedBindings({
  javascriptPath = JAVASCRIPT_BINDING_PATH,
  pythonPath = PYTHON_BINDING_PATH,
} = {}) {
  const [catalog, schema, javascript, python] = await Promise.all([
    readJsonArtifact(CATALOG_PATH),
    readJsonArtifact(SCHEMA_PATH),
    readTextArtifact(javascriptPath),
    readTextArtifact(pythonPath),
  ]);

  if (!catalog || !schema) {
    return {
      ok: false,
      contract: null,
      bindings: [],
      violations: [
        violation('ARTIFACT_MISSING', 'catalog/', 'the committed catalog and schema artifacts must both exist'),
      ],
    };
  }

  return checkBindingSources({ catalog, schema, sources: { javascript, python } });
}

function formatReport(report) {
  if (report.ok) {
    return (
      `[catalog] binding parity passed for catalog ${report.contract.catalogVersion} ` +
      `(digest ${report.contract.catalogDigest})\n`
    );
  }
  const lines = [`[catalog] binding parity failed with ${report.violations.length} violation(s):`];
  for (const item of report.violations) lines.push(`  - ${item.code} at ${item.path}: ${item.message}`);
  return `${lines.join('\n')}\n`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const report = await checkCommittedBindings();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}
