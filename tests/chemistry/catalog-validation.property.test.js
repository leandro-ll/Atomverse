import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalizeJson, digestJson } from '../../scripts/catalog/canonical-json.mjs';
import { CATALOG_PATH, DIGEST_PATH, SCHEMA_PATH, readJsonArtifact } from '../../scripts/catalog/catalog-paths.mjs';
import {
  collectBalanceViolations,
  normalizePairKey,
} from '../../scripts/catalog/catalog-invariants.mjs';
import { collectDigestViolations } from '../../scripts/catalog/validate-catalog.mjs';

/** Every leaf path in a JSON value, as an array of keys and array indices. */
function collectLeafPaths(value, path = [], collected = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLeafPaths(item, [...path, index], collected));
    return collected;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) collectLeafPaths(value[key], [...path, key], collected);
    return collected;
  }
  collected.push(path);
  return collected;
}

function readAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function writeAtPath(value, path, replacement) {
  const parent = path.slice(0, -1).reduce((current, key) => current[key], value);
  parent[path.at(-1)] = replacement;
  return value;
}

function scaleTerms(terms, factor) {
  return terms.map((term) => ({ ...term, coefficient: term.coefficient * factor }));
}

/** Validates: Requirements 1.2, 1.4, 28.5 */
describe('catalog validation properties', () => {
  let catalog;
  let schema;
  let committedDigest;
  let leafPaths;

  beforeAll(async () => {
    [catalog, schema, committedDigest] = await Promise.all([
      readJsonArtifact(CATALOG_PATH),
      readJsonArtifact(SCHEMA_PATH),
      readJsonArtifact(DIGEST_PATH),
    ]);
    leafPaths = collectLeafPaths(catalog);
  });

  it('addresses the catalog by content: any single field change breaks the committed digest', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...leafPaths),
        fc.oneof(fc.string({ maxLength: 24 }), fc.integer({ min: -9, max: 9 }), fc.boolean(), fc.constant(null)),
        (path, replacement) => {
          const original = readAtPath(catalog, path);
          fc.pre(!Object.is(original, replacement));

          const tampered = writeAtPath(structuredClone(catalog), path, replacement);
          const digest = collectDigestViolations(tampered, schema, committedDigest);

          return (
            digestJson(tampered) !== committedDigest.catalogDigest &&
            digest.violations.some((violation) => violation.code === 'DIGEST_MISMATCH')
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('canonicalizes independently of key order, so the digest never depends on serialization order', () => {
    const shuffleKeys = (value, rotation) => {
      if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, rotation));
      if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        const offset = keys.length === 0 ? 0 : rotation % keys.length;
        const rotated = [...keys.slice(offset), ...keys.slice(0, offset)];
        return Object.fromEntries(rotated.map((key) => [key, shuffleKeys(value[key], rotation)]));
      }
      return value;
    };

    const expectedCanonical = canonicalizeJson(catalog);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (rotation) => {
        const rotated = shuffleKeys(catalog, rotation);
        return canonicalizeJson(rotated) === expectedCanonical && digestJson(rotated) === digestJson(catalog);
      }),
      { numRuns: 12 },
    );
  });

  it('resolves every reagent pair order-independently to one record', () => {
    const reagentIds = Object.keys(catalog.reagents);

    fc.assert(
      fc.property(fc.constantFrom(...reagentIds), fc.constantFrom(...reagentIds), (reagentA, reagentB) => {
        fc.pre(reagentA !== reagentB);

        const forwardKey = normalizePairKey(reagentA, reagentB);
        const reverseKey = normalizePairKey(reagentB, reagentA);
        if (forwardKey !== reverseKey) return false;

        const reaction = catalog.reactions[forwardKey] ?? null;
        if (reaction === null) return true;
        return (
          reaction === (catalog.reactions[reverseKey] ?? null) &&
          reaction.reactantSet.join('|') === forwardKey &&
          reaction.reactantSet.includes(reagentA) &&
          reaction.reactantSet.includes(reagentB)
        );
      }),
      { numRuns: 200 },
    );
  });

  it('keeps every equation balanced when both sides scale, and unbalanced when one side scales', () => {
    const pairKeys = Object.keys(catalog.reactions);

    fc.assert(
      fc.property(
        fc.constantFrom(...pairKeys),
        fc.constantFrom('molecular', 'netIonic'),
        fc.integer({ min: 2, max: 7 }),
        (pairKey, equation, factor) => {
          const reactantsField = `${equation}Reactants`;
          const productsField = `${equation}Products`;

          const scaledBoth = structuredClone(catalog);
          scaledBoth.reactions[pairKey][reactantsField] = scaleTerms(catalog.reactions[pairKey][reactantsField], factor);
          scaledBoth.reactions[pairKey][productsField] = scaleTerms(catalog.reactions[pairKey][productsField], factor);

          const scaledOneSide = structuredClone(catalog);
          scaledOneSide.reactions[pairKey][reactantsField] = scaleTerms(
            catalog.reactions[pairKey][reactantsField],
            factor,
          );

          return (
            collectBalanceViolations(scaledBoth).length === 0 &&
            collectBalanceViolations(scaledOneSide).some(
              (violation) => violation.code === 'ELEMENT_BALANCE_VIOLATION',
            )
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
