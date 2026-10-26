import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CANONICALIZATION,
  DIGEST_ALGORITHM,
  canonicalizeJson,
  digestJson,
} from '../../scripts/catalog/canonical-json.mjs';
import {
  buildDigestRecord,
  compareDigestRecords,
  formatDigestRecord,
} from '../../scripts/catalog/catalog-digest.mjs';
import {
  CATALOG_PATH,
  DIGEST_PATH,
  DIGEST_RELATIVE_PATH,
  SCHEMA_PATH,
  readJsonArtifact,
} from '../../scripts/catalog/catalog-paths.mjs';
import {
  collectBalanceViolations,
  collectFormulaViolations,
  collectInvariantViolations,
  collectPairKeyViolations,
  collectReferenceViolations,
  computeEquationTotals,
  flattenFormulaTerms,
  normalizePairKey,
  parseFormulaAsciiReadings,
} from '../../scripts/catalog/catalog-invariants.mjs';
import {
  SUPPORTED_SCHEMA_MAJOR,
  collectSchemaViolations,
  validateCatalogDocuments,
  validateCommittedCatalog,
} from '../../scripts/catalog/validate-catalog.mjs';
import { generateDigestArtifact } from '../../scripts/catalog/generate-digest.mjs';
import {
  loadFormulaCompositionFixture,
  loadReactionBalanceFixture,
  loadReagentPairKeyFixture,
} from '../helpers/chemistry/catalog-fixtures.mjs';

const codesOf = (violations) => violations.map((item) => item.code);

/** Stable serialization of element counts so two totals compare by value. */
const countsKey = (counts) =>
  JSON.stringify(Object.entries(counts).sort(([left], [right]) => (left < right ? -1 : 1)));

/** Deep clone that reverses object key order at every level. */
const withReversedKeys = (value) => {
  if (Array.isArray(value)) return value.map(withReversedKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((key) => [key, withReversedKeys(value[key])]),
    );
  }
  return value;
};

/** Validates: Requirements 1.2, 1.4, 28.5 */
describe('canonical chemistry catalog validation', () => {
  let catalog;
  let schema;
  let committedDigest;
  let fixtures;
  let temporaryDirectory;

  beforeAll(async () => {
    [catalog, schema, committedDigest] = await Promise.all([
      readJsonArtifact(CATALOG_PATH),
      readJsonArtifact(SCHEMA_PATH),
      readJsonArtifact(DIGEST_PATH),
    ]);
    fixtures = {
      composition: await loadFormulaCompositionFixture(),
      balance: await loadReactionBalanceFixture(),
      pairs: await loadReagentPairKeyFixture(),
    };
    temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'atomverse-catalog-'));
  });

  afterAll(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const mutate = (change) => {
    const draft = structuredClone(catalog);
    change(draft);
    return draft;
  };

  it('accepts the committed catalog, schema, and digest artifacts', async () => {
    const report = await validateCommittedCatalog();

    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.expectedDigest.catalogDigest).toBe(committedDigest.catalogDigest);
  });

  it('keeps the golden fixtures pinned to the committed catalog version', () => {
    for (const fixture of Object.values(fixtures)) {
      expect(fixture.catalogVersion).toBe(catalog.catalogVersion);
    }
  });

  describe('formula composition', () => {
    it('agrees with the golden composition of every species and ion', () => {
      const entries = [
        ...fixtures.composition.species.map((item) => ['species', item]),
        ...fixtures.composition.ions.map((item) => ['ions', item]),
      ];
      expect(entries).toHaveLength(Object.keys(catalog.species).length + Object.keys(catalog.ions).length);

      for (const [collection, expected] of entries) {
        const definition = catalog[collection][expected.id];
        expect(definition, expected.id).toBeDefined();
        expect(definition.formulaAscii, expected.id).toBe(expected.formulaAscii);
        expect(definition.elementCounts, expected.id).toEqual(expected.elementCounts);
        expect(flattenFormulaTerms(definition.formulaTerms), expected.id).toEqual(expected.elementCounts);

        const readings = parseFormulaAsciiReadings(expected.formulaAscii);
        expect(
          readings.some(
            (reading) =>
              reading.charge === expected.charge && countsKey(reading.counts) === countsKey(expected.elementCounts),
          ),
          `${expected.id} reads as ${JSON.stringify(readings)}`,
        ).toBe(true);
      }

      expect(collectFormulaViolations(catalog)).toEqual([]);
    });

    it('expands nested structural groups by their multiplicity', () => {
      expect(flattenFormulaTerms(catalog.species['Pb(NO3)2'].formulaTerms)).toEqual({ Pb: 1, N: 2, O: 6 });
      expect(parseFormulaAsciiReadings('Pb(NO3)2')).toEqual([{ counts: { Pb: 1, N: 2, O: 6 }, charge: 0 }]);
      expect(parseFormulaAsciiReadings('SO4 2-')).toEqual([{ counts: { S: 1, O: 4 }, charge: -2 }]);
    });

    it('rejects a composition that disagrees with its structural terms or ASCII formula', () => {
      expect(
        codesOf(collectFormulaViolations(mutate((draft) => { draft.species.BaCl2.elementCounts = { Ba: 1, Cl: 3 }; }))),
      ).toContain('FORMULA_COMPOSITION_MISMATCH');

      expect(
        codesOf(collectFormulaViolations(mutate((draft) => { draft.species.AgNO3.formulaAscii = 'AgNO'; }))),
      ).toContain('FORMULA_ASCII_MISMATCH');

      expect(
        codesOf(collectFormulaViolations(mutate((draft) => { draft.species['Pb(NO3)2'].formulaAscii = 'Pb(NO)2'; }))),
      ).toContain('FORMULA_ASCII_MISMATCH');

      expect(
        codesOf(collectFormulaViolations(mutate((draft) => { draft.ions['SO4_2-'].charge = -1; }))),
      ).toContain('FORMULA_ASCII_MISMATCH');

      expect(
        codesOf(collectFormulaViolations(mutate((draft) => { draft.species.H2O.formulaAscii = 'H2(O'; }))),
      ).toContain('FORMULA_ASCII_UNPARSABLE');

      expect(
        codesOf(collectFormulaViolations(mutate((draft) => { draft.species.AgI.elementCounts = { Ag: 1, Xx: 1 }; }))),
      ).toContain('ELEMENT_UNKNOWN');
    });
  });

  describe('elemental and charge balance', () => {
    it('matches the golden totals of every molecular and net ionic equation', () => {
      expect(fixtures.balance.reactions).toHaveLength(Object.keys(catalog.reactions).length);

      for (const expected of fixtures.balance.reactions) {
        const reaction = catalog.reactions[expected.pairKey];
        expect(reaction, expected.pairKey).toBeDefined();
        expect(reaction.id).toBe(expected.reactionId);

        const equations = [
          ['molecular', reaction.molecularReactants, reaction.molecularProducts, expected.molecular],
          ['netIonic', reaction.netIonicReactants, reaction.netIonicProducts, expected.netIonic],
        ];

        for (const [label, reactantTerms, productTerms, golden] of equations) {
          const reactants = computeEquationTotals(catalog, reactantTerms);
          const products = computeEquationTotals(catalog, productTerms);
          const context = `${expected.pairKey} ${label}`;

          expect(reactants.resolved && products.resolved, context).toBe(true);
          expect(reactants.counts, context).toEqual(golden.elementTotals);
          expect(products.counts, context).toEqual(golden.elementTotals);
          expect(reactants.charge, context).toBe(golden.charge);
          expect(products.charge, context).toBe(golden.charge);
        }
      }
    });

    it('matches the golden dissociation totals of every reagent', () => {
      expect(fixtures.balance.dissociation).toHaveLength(Object.keys(catalog.reagents).length);

      for (const expected of fixtures.balance.dissociation) {
        const reagent = catalog.reagents[expected.reagentId];
        expect(reagent, expected.reagentId).toBeDefined();

        const multiplicities = Object.fromEntries(reagent.ions.map((term) => [term.ionId, term.multiplicity]));
        expect(multiplicities, expected.reagentId).toEqual(expected.ions);

        const totals = computeEquationTotals(
          catalog,
          reagent.ions.map((term) => ({ speciesId: term.ionId, coefficient: term.multiplicity })),
        );
        expect(totals.counts, expected.reagentId).toEqual(expected.elementTotals);
        expect(totals.charge, expected.reagentId).toBe(expected.charge);
        expect(catalog.species[reagent.speciesId].elementCounts, expected.reagentId).toEqual(expected.elementTotals);
      }

      expect(collectBalanceViolations(catalog)).toEqual([]);
    });

    it('rejects an unbalanced equation or a non-electroneutral dissociation', () => {
      expect(
        codesOf(
          collectBalanceViolations(
            mutate((draft) => { draft.reactions['NaCl|Pb(NO3)2'].molecularReactants[1].coefficient = 1; }),
          ),
        ),
      ).toContain('ELEMENT_BALANCE_VIOLATION');

      expect(
        codesOf(
          collectBalanceViolations(
            mutate((draft) => { draft.reactions['KI|Pb(NO3)2'].netIonicReactants[1].coefficient = 1; }),
          ),
        ),
      ).toEqual(expect.arrayContaining(['ELEMENT_BALANCE_VIOLATION', 'CHARGE_BALANCE_VIOLATION']));

      expect(
        codesOf(
          collectBalanceViolations(
            mutate((draft) => { draft.reactions['HCl|NaOH'].netIonicProducts = [{ speciesId: 'OH-', coefficient: 1, phase: 'aq' }]; }),
          ),
        ),
      ).toContain('CHARGE_BALANCE_VIOLATION');

      expect(
        codesOf(collectBalanceViolations(mutate((draft) => { draft.reagents.BaCl2.ions[1].multiplicity = 1; }))),
      ).toEqual(expect.arrayContaining(['CHARGE_BALANCE_VIOLATION', 'ELEMENT_BALANCE_VIOLATION']));

      expect(
        codesOf(collectBalanceViolations(mutate((draft) => { draft.reactions['AgNO3|KI'].molecularProducts[0].coefficient = 0; }))),
      ).toContain('BALANCE_UNVERIFIABLE');
    });
  });

  describe('reference integrity', () => {
    it('resolves every reference in the committed catalog', () => {
      expect(collectReferenceViolations(catalog)).toEqual([]);
    });

    it('rejects a dangling species, ion, reagent, reaction, phase, or message reference', () => {
      expect(
        codesOf(collectReferenceViolations(mutate((draft) => { draft.reagents.KI.speciesId = 'KBr'; }))),
      ).toContain('SPECIES_UNKNOWN');

      expect(
        codesOf(collectReferenceViolations(mutate((draft) => { draft.reagents.KI.ions[0].ionId = 'Rb+'; }))),
      ).toContain('ION_UNKNOWN');

      expect(
        codesOf(collectReferenceViolations(mutate((draft) => { draft.reactions['AgNO3|NaCl'].reactantSet[1] = 'KBr'; }))),
      ).toContain('REAGENT_UNKNOWN');

      expect(
        codesOf(
          collectReferenceViolations(
            mutate((draft) => { draft.reactions['AgNO3|NaCl'].molecularProducts[0].speciesId = 'AgCl2'; }),
          ),
        ),
      ).toContain('SPECIES_UNKNOWN');

      expect(
        codesOf(
          collectReferenceViolations(mutate((draft) => { draft.reactions['AgNO3|NaCl'].molecularProducts[0].phase = 'g'; })),
        ),
      ).toContain('PHASE_UNDECLARED_FOR_SPECIES');

      expect(
        codesOf(collectReferenceViolations(mutate((draft) => { draft.reactions['BaCl2|Na2SO4'].phaseModel = 'layered'; }))),
      ).toContain('PHASE_MODEL_UNKNOWN');

      expect(
        codesOf(collectReferenceViolations(mutate((draft) => { draft.reactions['BaCl2|Na2SO4'].targetTags = ['precipitate_rainbow']; }))),
      ).toContain('INVERSE_TARGET_UNKNOWN');

      expect(
        codesOf(collectReferenceViolations(mutate((draft) => { draft.inverseTargets.neutral_ph.reactionIds = ['rxn_missing']; }))),
      ).toContain('REACTION_UNKNOWN');

      expect(
        codesOf(
          collectReferenceViolations(
            mutate((draft) => { delete draft.messages['id-ID'][draft.model.capabilities.pressure.messageKey]; }),
          ),
        ),
      ).toContain('MESSAGE_KEY_UNKNOWN');

      expect(
        codesOf(
          collectReferenceViolations(
            mutate((draft) => { draft.reactions['AgNO3|KI'].pHUnsupportedReasonCode = 'PH_MODEL_UNDECLARED'; }),
          ),
        ),
      ).toContain('PH_REASON_UNKNOWN');
    });
  });

  describe('normalized order-independent reaction keys', () => {
    it('resolves every golden reagent pair to the same record in either order', () => {
      const reagentIds = Object.keys(catalog.reagents);
      expect(fixtures.pairs.pairs).toHaveLength((reagentIds.length * (reagentIds.length - 1)) / 2);

      const modeled = fixtures.pairs.pairs.filter((pair) => pair.reactionId !== null);
      expect(modeled).toHaveLength(fixtures.pairs.modeledPairCount);
      expect(fixtures.pairs.pairs).toHaveLength(fixtures.pairs.modeledPairCount + fixtures.pairs.unmodeledPairCount);

      for (const pair of fixtures.pairs.pairs) {
        const [reagentA, reagentB] = pair.reagents;
        expect(catalog.reagents[reagentA], reagentA).toBeDefined();
        expect(catalog.reagents[reagentB], reagentB).toBeDefined();

        expect(normalizePairKey(reagentA, reagentB)).toBe(pair.pairKey);
        expect(normalizePairKey(reagentB, reagentA)).toBe(pair.pairKey);

        const forward = catalog.reactions[normalizePairKey(reagentA, reagentB)] ?? null;
        const reverse = catalog.reactions[normalizePairKey(reagentB, reagentA)] ?? null;
        expect(forward).toBe(reverse);
        expect(forward?.id ?? null, pair.pairKey).toBe(pair.reactionId);
      }
    });

    it('rejects an unnormalized or repeated pair key', () => {
      expect(
        codesOf(
          collectPairKeyViolations(
            mutate((draft) => {
              draft.reactions['NaCl|AgNO3'] = draft.reactions['AgNO3|NaCl'];
              delete draft.reactions['AgNO3|NaCl'];
            }),
          ),
        ),
      ).toContain('PAIR_KEY_NOT_NORMALIZED');

      expect(
        codesOf(
          collectPairKeyViolations(
            mutate((draft) => {
              draft.reactions['NaCl|AgNO3'] = structuredClone(draft.reactions['AgNO3|NaCl']);
            }),
          ),
        ),
      ).toEqual(expect.arrayContaining(['PAIR_KEY_DUPLICATE', 'REACTION_ID_DUPLICATE']));

      expect(
        codesOf(collectPairKeyViolations(mutate((draft) => { draft.reactions['AgNO3|NaCl'].reactantSet = ['NaCl']; }))),
      ).toContain('PAIR_KEY_MALFORMED');
    });
  });

  describe('JSON Schema contract', () => {
    it('accepts the committed catalog', () => {
      expect(collectSchemaViolations(catalog, schema)).toEqual([]);
    });

    it('rejects a non-positive coefficient, a fractional multiplicity, and an unknown field', () => {
      for (const change of [
        (draft) => { draft.reactions['AgNO3|NaCl'].molecularProducts[0].coefficient = 0; },
        (draft) => { draft.reagents.Na2SO4.ions[0].multiplicity = 1.5; },
        (draft) => { draft.ions['Na+'].charge = 0; },
        (draft) => { draft.species.AgCl.unexpectedField = true; },
        (draft) => { delete draft.reagents.NaOH; },
      ]) {
        const violations = collectSchemaViolations(mutate(change), schema);
        expect(codesOf(violations)).toContain('SCHEMA_VIOLATION');
      }
    });
  });

  describe('digest generation', () => {
    it('regenerates the committed digest artifact byte for byte', async () => {
      const digestPath = resolve(temporaryDirectory, 'byte-stable.digest.json');
      const first = await generateDigestArtifact({ digestPath });
      const firstBytes = await readFile(digestPath, 'utf8');
      const second = await generateDigestArtifact({ digestPath });
      const secondBytes = await readFile(digestPath, 'utf8');
      const committedBytes = await readFile(DIGEST_PATH, 'utf8');

      expect(first.written).toBe(true);
      expect(second.written).toBe(false);
      expect(secondBytes).toBe(firstBytes);
      expect(firstBytes).toBe(committedBytes);
      expect(firstBytes).toBe(formatDigestRecord(buildDigestRecord(catalog, schema)));
    });

    it('addresses the catalog by content under the declared algorithm and canonicalization', () => {
      expect(committedDigest.algorithm).toBe(DIGEST_ALGORITHM);
      expect(committedDigest.algorithm).toBe(catalog.digest.algorithm);
      expect(committedDigest.canonicalization).toBe(CANONICALIZATION);
      expect(committedDigest.canonicalization).toBe(catalog.digest.canonicalization);
      expect(catalog.digest.valueFile).toBe(DIGEST_RELATIVE_PATH);
      expect(committedDigest.catalogVersion).toBe(catalog.catalogVersion);
      expect(committedDigest.schemaVersion).toBe(catalog.schemaVersion);
      expect(committedDigest.catalogDigest).toBe(digestJson(catalog));
      expect(committedDigest.schemaDigest).toBe(digestJson(schema));
      expect(committedDigest.catalogDigest).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('detects drift between the digest artifact and the catalog it addresses', () => {
      const tampered = mutate((draft) => { draft.species.AgCl.displayName = 'Perak Klorida (diubah)'; });
      const report = validateCatalogDocuments({
        catalog: tampered,
        schema,
        digestRecord: committedDigest,
      });

      expect(report.ok).toBe(false);
      expect(codesOf(report.violations)).toContain('DIGEST_MISMATCH');
      expect(report.expectedDigest.catalogDigest).not.toBe(committedDigest.catalogDigest);
    });

    it('reports a missing digest artifact instead of passing silently', () => {
      const report = validateCatalogDocuments({ catalog, schema, digestRecord: null });

      expect(report.ok).toBe(false);
      expect(codesOf(report.violations)).toContain('DIGEST_ARTIFACT_MISSING');
    });

    it('treats a released catalog version as immutable', async () => {
      const mutatedRelease = { ...committedDigest, catalogDigest: `${'0'.repeat(63)}1` };
      expect(compareDigestRecords(mutatedRelease, buildDigestRecord(catalog, schema)).mutatedRelease).toBe(true);

      const report = validateCatalogDocuments({ catalog, schema, digestRecord: mutatedRelease });
      expect(codesOf(report.violations)).toEqual(
        expect.arrayContaining(['DIGEST_MISMATCH', 'RELEASE_IMMUTABILITY_VIOLATION']),
      );

      const digestPath = resolve(temporaryDirectory, 'immutable.digest.json');
      await writeFile(digestPath, formatDigestRecord(mutatedRelease), 'utf8');

      const refused = await generateDigestArtifact({ digestPath });
      expect(refused.ok).toBe(false);
      expect(refused.written).toBe(false);
      expect(refused.reason).toMatch(/immutable/u);
      expect(await readFile(digestPath, 'utf8')).toBe(formatDigestRecord(mutatedRelease));

      const rewritten = await generateDigestArtifact({ digestPath, allowRewrite: true });
      expect(rewritten.written).toBe(true);
      expect(await readFile(digestPath, 'utf8')).toBe(formatDigestRecord(buildDigestRecord(catalog, schema)));
    });

    it('is insensitive to key order but sensitive to any field change', () => {
      const reordered = withReversedKeys(catalog);
      expect(Object.keys(reordered)).not.toEqual(Object.keys(catalog));
      expect(canonicalizeJson(reordered)).toBe(canonicalizeJson(catalog));
      expect(digestJson(reordered)).toBe(digestJson(catalog));

      const changed = mutate((draft) => { draft.model.bounds.volume_mL.maximum = 99; });
      expect(digestJson(changed)).not.toBe(digestJson(catalog));
    });
  });

  describe('schema major compatibility', () => {
    it('rejects an incompatible catalog schema major version with a visible localized error', () => {
      const incompatible = mutate((draft) => { draft.schemaVersion = '2'; });
      const report = validateCatalogDocuments({ catalog: incompatible, schema, digestRecord: committedDigest });

      expect(report.ok).toBe(false);
      expect(report.fatal).toBe(true);
      expect(codesOf(report.violations)).toEqual(['SCHEMA_MAJOR_INCOMPATIBLE']);

      const [failure] = report.violations;
      expect(failure.message).toContain('"2"');
      expect(failure.localizedMessage).toContain('tidak didukung');
      expect(failure.localizedMessage).toContain('"2"');
      expect(failure.localizedMessage).toContain(`"${SUPPORTED_SCHEMA_MAJOR}"`);
      expect(failure.localizedMessage).toMatch(/Katalog ditolak/u);
    });

    it('rejects an incompatible schema contract major version', () => {
      const incompatibleSchema = structuredClone(schema);
      incompatibleSchema.properties.schemaVersion.const = '2';
      const report = validateCatalogDocuments({ catalog, schema: incompatibleSchema, digestRecord: committedDigest });

      expect(report.fatal).toBe(true);
      expect(codesOf(report.violations)).toEqual(['SCHEMA_CONTRACT_MAJOR_INCOMPATIBLE']);
      expect(report.violations[0].localizedMessage).toContain('tidak didukung');
    });

    it('rejects unsupported digest metadata rather than guessing the canonicalization', () => {
      const report = validateCatalogDocuments({
        catalog: mutate((draft) => { draft.digest.canonicalization = 'utf8-json-as-written'; }),
        schema,
        digestRecord: committedDigest,
        checkDigest: false,
      });

      expect(codesOf(report.violations)).toContain('DIGEST_METADATA_UNSUPPORTED');
    });

    it('reports every layer in one pass for a catalog with unrelated defects', () => {
      const broken = mutate((draft) => {
        draft.reactions['AgNO3|NaCl'].molecularProducts[0].coefficient = 2;
        draft.species.BaCl2.elementCounts = { Ba: 1, Cl: 3 };
        draft.inverseTargets.neutral_ph.reactionIds = ['rxn_missing'];
      });
      const codes = new Set(codesOf(collectInvariantViolations(broken)));

      expect(codes).toContain('ELEMENT_BALANCE_VIOLATION');
      expect(codes).toContain('FORMULA_COMPOSITION_MISMATCH');
      expect(codes).toContain('REACTION_UNKNOWN');
    });
  });
});
