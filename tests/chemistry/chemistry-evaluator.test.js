import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EXPERIMENT_INPUT_REASON_CODES,
  InvalidExperimentQuantityError,
  MILLILITRES_PER_LITRE,
  NO_MODELED_REACTION_CATEGORY,
  VALIDATED_EXPERIMENT_FIELDS,
  calculateAmount,
  chemistryEvaluator,
  createChemistryEvaluator,
  evaluateExperiment,
  toLitres,
} from '../../js/domain/chemistry-evaluator.js';
import { createChemistryFormatters, normalizePairKey } from '../../js/domain/chemistry-formatters.js';
import { REQUIRED_REAGENT_PAIRS, loadCatalog } from '../helpers/chemistry/catalog-definitions.mjs';
import {
  loadDisplayFormattingFixture,
  loadExperimentVectorFixture,
  loadReagentPairKeyFixture,
} from '../helpers/chemistry/catalog-fixtures.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const EVALUATOR_SOURCE_PATH = resolve(repositoryRoot, 'js', 'domain', 'chemistry-evaluator.js');
const MACRO_CONTROLLER_SOURCE_PATH = resolve(repositoryRoot, 'js', 'main.js');

/** Precision used where double arithmetic makes an exact comparison brittle. */
const AMOUNT_PRECISION = 12;

/**
 * Precision for a cologarithm, which has no exact decimal form.
 *
 * The fixture states every pH to nine decimals, so eight is stricter than the
 * catalog's own declared `model.tolerances.pH` of 1e-6 while still being
 * reachable by a hand-written golden value.
 */
const PH_PRECISION = 8;

/**
 * Builds an input where each reagent carries its own quantities, so a test can
 * swap the A/B slots while keeping every solution chemically identical.
 */
function buildInput(reagentA, quantitiesA, reagentB, quantitiesB) {
  return {
    reagentA,
    concentrationA_molL: quantitiesA.concentration_molL,
    volumeA_mL: quantitiesA.volume_mL,
    reagentB,
    concentrationB_molL: quantitiesB.concentration_molL,
    volumeB_mL: quantitiesB.volume_mL,
    temperature_C: 25,
    pressure_atm: 1,
  };
}

function reactantOf(result, reagentId) {
  const reactant = result.reactants.find((candidate) => candidate.reagentId === reagentId);
  if (!reactant) throw new Error(`result declares no reactant for ${reagentId}`);
  return reactant;
}

function productOf(result, speciesId) {
  const product = result.products.find((candidate) => candidate.speciesId === speciesId);
  if (!product) throw new Error(`result declares no product for ${speciesId}`);
  return product;
}

/** Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2 */
describe('catalog-backed experiment evaluator', () => {
  let catalog;
  let evaluator;
  let formatters;
  let pairKeyFixture;
  let displayFixture;

  beforeAll(async () => {
    catalog = await loadCatalog();
    evaluator = createChemistryEvaluator(catalog);
    formatters = createChemistryFormatters(catalog);
    pairKeyFixture = await loadReagentPairKeyFixture();
    displayFixture = await loadDisplayFormattingFixture();
  });

  /** The 22 unordered reagent pairs version 1 models no reaction for. */
  const unmodeledPairs = () => pairKeyFixture.pairs.filter((pair) => pair.reactionId === null);

  it('evaluates against the committed catalog release', () => {
    expect(evaluator.catalogVersion).toBe(catalog.catalogVersion);
    expect(evaluator.modelVersion).toBe(catalog.model.modelVersion);
    expect(evaluator.amountTolerance).toBe(catalog.model.tolerances.amount_mol);
    expect(chemistryEvaluator.catalogVersion).toBe(catalog.catalogVersion);
  });

  describe('formula-unit amounts', () => {
    it('calculates every amount as concentration times volume in litres', () => {
      expect(MILLILITRES_PER_LITRE).toBe(1000);
      expect(toLitres(50)).toBe(50 / 1000);
      expect(calculateAmount(1.4, 35)).toBe(1.4 * (35 / 1000));

      const result = evaluator.evaluateExperiment(
        buildInput('AgNO3', { concentration_molL: 1.4, volume_mL: 35 }, 'NaCl', { concentration_molL: 0.3, volume_mL: 80 }),
      );

      const silver = reactantOf(result, 'AgNO3');
      expect(silver.volume_L).toBe(35 / 1000);
      expect(silver.amount_mol).toBe(1.4 * (35 / 1000));
      const chloride = reactantOf(result, 'NaCl');
      expect(chloride.amount_mol).toBe(0.3 * (80 / 1000));
      expect(result.totalVolume_L).toBeCloseTo(0.115, AMOUNT_PRECISION);
    });

    it('rejects quantities that have no defined amount of substance', () => {
      for (const field of ['concentrationA_molL', 'volumeA_mL', 'concentrationB_molL', 'volumeB_mL']) {
        for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
          const input = buildInput('AgNO3', { concentration_molL: 1, volume_mL: 50 }, 'NaCl', {
            concentration_molL: 1,
            volume_mL: 50,
          });
          input[field] = value;
          expect(() => evaluator.evaluateExperiment(input), `${field}=${String(value)}`).toThrow(
            InvalidExperimentQuantityError,
          );
        }
      }
    });
  });

  describe('reagent pair resolution', () => {
    it('resolves all six supported pairs through their normalized catalog key', () => {
      expect(REQUIRED_REAGENT_PAIRS).toHaveLength(6);
      for (const [reagentA, reagentB] of REQUIRED_REAGENT_PAIRS) {
        const pairKey = normalizePairKey(reagentA, reagentB);
        const reaction = catalog.reactions[pairKey];
        expect(evaluator.findReaction(reagentA, reagentB), pairKey).toBe(reaction);
        expect(evaluator.findReaction(reagentB, reagentA), pairKey).toBe(reaction);

        const quantities = { concentration_molL: 1, volume_mL: 50 };
        const result = evaluator.evaluateExperiment(buildInput(reagentA, quantities, reagentB, quantities));
        expect(result.pairKey, pairKey).toBe(pairKey);
        expect(result.reactionId, pairKey).toBe(reaction.id);
        expect(result.category, pairKey).toBe(reaction.category);
        expect(result.support, pairKey).toEqual({ kind: 'supported', modelVersion: catalog.model.modelVersion });
      }
    });

    it('produces the identical result for both A/B orders of every supported pair', () => {
      const quantitiesA = { concentration_molL: 1.7, volume_mL: 42 };
      const quantitiesB = { concentration_molL: 0.6, volume_mL: 93 };

      for (const [reagentA, reagentB] of REQUIRED_REAGENT_PAIRS) {
        const forward = evaluator.evaluateExperiment(buildInput(reagentA, quantitiesA, reagentB, quantitiesB));
        const reversed = evaluator.evaluateExperiment(buildInput(reagentB, quantitiesB, reagentA, quantitiesA));
        expect(reversed, normalizePairKey(reagentA, reagentB)).toEqual(forward);
      }
    });

    it('rejects unknown reagents and a single reagent mixed with itself', () => {
      const quantities = { concentration_molL: 1, volume_mL: 50 };
      expect(() => evaluator.evaluateExperiment(buildInput('H2SO4', quantities, 'NaCl', quantities))).toThrow(
        /unknown reagent/u,
      );
      expect(() => evaluator.evaluateExperiment(buildInput('NaCl', quantities, 'NaCl', quantities))).toThrow(
        /two different reagents/u,
      );
    });
  });

  /** Validates: Requirements 2.4, 2.5 */
  describe('pairs the catalog models no reaction for', () => {
    const quantitiesA = { concentration_molL: 1.2, volume_mL: 40 };
    const quantitiesB = { concentration_molL: 0.5, volume_mL: 70 };

    it('covers all twenty-two unmodeled pairs with a consistent described result', () => {
      const pairs = unmodeledPairs();
      expect(pairs).toHaveLength(pairKeyFixture.unmodeledPairCount);
      const expected = displayFixture.noModeledReaction;

      for (const { reagents, pairKey } of pairs) {
        const result = evaluator.evaluateExperiment(
          buildInput(reagents[0], quantitiesA, reagents[1], quantitiesB),
        );

        expect(result.pairKey, pairKey).toBe(pairKey);
        expect(result.category, pairKey).toBe(NO_MODELED_REACTION_CATEGORY);
        expect(result.category, pairKey).toBe(expected.category);
        expect(result.support, pairKey).toEqual({
          kind: 'unsupported',
          code: expected.reasonCode,
          messageKey: expected.messageKey,
          message: displayFixture.boundaryMessages[expected.messageKey],
        });
        expect(result.catalogVersion, pairKey).toBe(catalog.catalogVersion);
        expect(result.modelVersion, pairKey).toBe(catalog.model.modelVersion);
        expect(result.reactionId, pairKey).toBeNull();
        expect(result.displayName, pairKey).toBeNull();
        expect(result.pH, pairKey).toBeNull();
        expect(result.speciesLedger, pairKey).toBeNull();
      }
    });

    it('reports no product and no reaction equation', () => {
      const expected = displayFixture.noModeledReaction;

      for (const { reagents, pairKey } of unmodeledPairs()) {
        const result = evaluator.evaluateExperiment(
          buildInput(reagents[0], quantitiesA, reagents[1], quantitiesB),
        );

        expect(result.products, pairKey).toEqual([]);
        expect(result.productSummary, pairKey).toBeNull();
        expect(result.molecularEquation, pairKey).toBe(expected.molecularEquation);
        expect(result.netIonicEquation, pairKey).toBe(expected.netIonicEquation);
        expect(result.appearance.precipitate, pairKey).toBe(expected.precipitate);
        expect(result.spectatorIons, pairKey).toEqual([]);
        expect(result.extent_mol, pairKey).toBe(0);
        expect(result.limitingSpecies, pairKey).toEqual([]);
      }
    });

    it('leaves every formula unit of both ordinary solutions in the mixture', () => {
      for (const { reagents, pairKey } of unmodeledPairs()) {
        const result = evaluator.evaluateExperiment(
          buildInput(reagents[0], quantitiesA, reagents[1], quantitiesB),
        );

        expect(result.totalVolume_L, pairKey).toBeCloseTo(0.11, AMOUNT_PRECISION);
        expect(result.reactants, pairKey).toHaveLength(2);
        for (const reactant of result.reactants) {
          const label = `${pairKey} ${reactant.reagentId}`;
          expect(reactant.amount_mol, label).toBe(
            calculateAmount(reactant.concentration_molL, reactant.volume_mL),
          );
          expect(reactant.consumed_mol, label).toBe(0);
          expect(reactant.remaining_mol, label).toBe(reactant.amount_mol);
          expect(reactant.limiting, label).toBe(false);
          // No balanced equation exists, so no stoichiometric coefficient may
          // be claimed for either solution.
          expect(reactant.coefficient, label).toBeNull();
        }

        expect(result.excessSpecies.map((species) => species.reagentId), pairKey).toEqual(
          result.reactants.map((reactant) => reactant.reagentId),
        );
        for (const species of result.excessSpecies) {
          expect(species.role, pairKey).toBe('excess');
          expect(species.amount_mol, `${pairKey} ${species.reagentId}`).toBe(
            reactantOf(result, species.reagentId).amount_mol,
          );
        }
      }
    });

    it('keeps the mixture in one homogeneous aqueous phase with a clear appearance', () => {
      const expected = displayFixture.noModeledReaction;
      const presentation = catalog.model.unsupportedOutcomes.noModeledReaction.presentation;

      for (const { reagents, pairKey } of unmodeledPairs()) {
        const result = evaluator.evaluateExperiment(
          buildInput(reagents[0], quantitiesA, reagents[1], quantitiesB),
        );

        expect(result.phaseModel, pairKey).toEqual(formatters.describePhaseModel(expected.phaseModel));
        expect(result.phaseModel.phaseModel, pairKey).toBe(expected.phaseModel);
        expect(result.phaseModel.phases, pairKey).toEqual(['aq']);
        expect(result.phaseModel.layered, pairKey).toBe(expected.layered);
        expect(result.phaseModel.message, pairKey).toBe(
          displayFixture.boundaryMessages['model.phase.homogeneousAqueous'],
        );

        expect(result.appearance, pairKey).toEqual({
          clarity: presentation.appearance,
          color: presentation.solutionColor,
          precipitate: null,
        });
        expect(result.appearance.clarity, pairKey).toBe('clear');
        expect(result.energy.label, pairKey).toBe(presentation.energyLabel);
        expect(result.energy.exothermic, pairKey).toBe(false);
      }
    });

    it('produces the identical result for both A/B orders of a representative mixture', () => {
      for (const { reagents, pairKey } of displayFixture.unmodeledPairs) {
        const forward = evaluator.evaluateExperiment(
          buildInput(reagents[0], quantitiesA, reagents[1], quantitiesB),
        );
        const reversed = evaluator.evaluateExperiment(
          buildInput(reagents[1], quantitiesB, reagents[0], quantitiesA),
        );
        expect(reversed, pairKey).toEqual(forward);
        expect(forward.pairKey, pairKey).toBe(pairKey);
        expect(Object.isFrozen(forward), pairKey).toBe(true);
        expect(Object.isFrozen(forward.reactants[0]), pairKey).toBe(true);
      }
    });

    it('cannot represent any mixture as layered, modeled or not', () => {
      // A layer boundary would need an immiscibility model the catalog does not
      // declare, so no result of either kind may report a layered phase.
      expect(catalog.model.immisciblePairs).toEqual([]);
      for (const phaseModel of Object.values(catalog.model.phaseModels)) {
        expect(phaseModel.layered).toBe(false);
      }

      for (const { reagents, pairKey } of pairKeyFixture.pairs) {
        const result = evaluator.evaluateExperiment(
          buildInput(reagents[0], quantitiesA, reagents[1], quantitiesB),
        );
        expect(result.phaseModel.layered, pairKey).toBe(false);
        expect(result.phaseModel.phases.length, pairKey).toBeLessThanOrEqual(2);
        expect(result.phaseModel.phases, pairKey).toContain('aq');
      }
    });

    it('refuses a catalog whose no-reaction outcome declares a layered phase', () => {
      const mutated = structuredClone(catalog);
      mutated.model.phaseModels.layered_pair = {
        phases: ['aq', 'l'],
        layered: true,
        messageKey: 'model.phase.homogeneousAqueous',
      };
      mutated.model.unsupportedOutcomes.noModeledReaction.phaseModel = 'layered_pair';

      const input = buildInput('NaCl', quantitiesA, 'KI', quantitiesB);
      expect(() => evaluateExperiment(mutated, input)).toThrow(/one homogeneous phase/u);
    });

    it('keeps the macro result renderer free of any layer-boundary path', async () => {
      // The audited defect labeled every no-reaction result "Terpisah (2
      // Lapisan)" and drew separate top/bottom fills with a visible boundary.
      // The macro view must not be able to reach that state again.
      const source = await readFile(MACRO_CONTROLLER_SOURCE_PATH, 'utf8');
      expect(source).not.toMatch(/Terpisah/u);
      expect(source).not.toMatch(/Lapisan/u);
      expect(source).not.toMatch(/liquidBoundary\.setAttribute\('opacity', '1'\)/u);
      expect(source).not.toMatch(/layerName(?:Top|Bottom)\.classList\.add/u);
    });
  });

  describe('balanced extent, limiting reactants, excess, and products', () => {
    it('limits a one-to-one precipitation by the scarcer reagent', () => {
      const result = evaluator.evaluateExperiment(
        buildInput('AgNO3', { concentration_molL: 1, volume_mL: 50 }, 'NaCl', { concentration_molL: 0.4, volume_mL: 50 }),
      );

      expect(reactantOf(result, 'AgNO3').amount_mol).toBeCloseTo(0.05, AMOUNT_PRECISION);
      expect(reactantOf(result, 'NaCl').amount_mol).toBeCloseTo(0.02, AMOUNT_PRECISION);
      expect(result.extent_mol).toBeCloseTo(0.02, AMOUNT_PRECISION);
      expect(result.limitingSpecies).toEqual(['NaCl']);

      expect(reactantOf(result, 'NaCl').remaining_mol).toBe(0);
      expect(reactantOf(result, 'AgNO3').remaining_mol).toBeCloseTo(0.03, AMOUNT_PRECISION);
      expect(result.excessSpecies).toHaveLength(1);
      expect(result.excessSpecies[0]).toMatchObject({ speciesId: 'AgNO3', reagentId: 'AgNO3', role: 'excess' });
      expect(result.excessSpecies[0].amount_mol).toBeCloseTo(0.03, AMOUNT_PRECISION);

      expect(productOf(result, 'AgCl').amount_mol).toBeCloseTo(0.02, AMOUNT_PRECISION);
      expect(productOf(result, 'NaNO3').amount_mol).toBeCloseTo(0.02, AMOUNT_PRECISION);
    });

    it('divides the halide amount by its coefficient for 1:2 lead halide stoichiometry', () => {
      const equalQuantities = { concentration_molL: 1, volume_mL: 50 };
      const result = evaluator.evaluateExperiment(buildInput('Pb(NO3)2', equalQuantities, 'NaCl', equalQuantities));

      expect(reactantOf(result, 'Pb(NO3)2').coefficient).toBe(1);
      expect(reactantOf(result, 'NaCl').coefficient).toBe(2);

      // Equal amounts are not equal equivalents: two chloride formula units are
      // consumed per lead formula unit, so the halide runs out first.
      expect(result.extent_mol).toBeCloseTo(0.025, AMOUNT_PRECISION);
      expect(result.limitingSpecies).toEqual(['NaCl']);
      expect(reactantOf(result, 'NaCl').consumed_mol).toBeCloseTo(0.05, AMOUNT_PRECISION);
      expect(reactantOf(result, 'Pb(NO3)2').consumed_mol).toBeCloseTo(0.025, AMOUNT_PRECISION);
      expect(result.excessSpecies[0].speciesId).toBe('Pb(NO3)2');
      expect(result.excessSpecies[0].amount_mol).toBeCloseTo(0.025, AMOUNT_PRECISION);

      expect(productOf(result, 'PbCl2').amount_mol).toBeCloseTo(0.025, AMOUNT_PRECISION);
      expect(productOf(result, 'NaNO3').coefficient).toBe(2);
      expect(productOf(result, 'NaNO3').amount_mol).toBeCloseTo(0.05, AMOUNT_PRECISION);

      const iodide = evaluator.evaluateExperiment(buildInput('KI', equalQuantities, 'Pb(NO3)2', equalQuantities));
      expect(reactantOf(iodide, 'KI').coefficient).toBe(2);
      expect(iodide.extent_mol).toBeCloseTo(0.025, AMOUNT_PRECISION);
      expect(iodide.limitingSpecies).toEqual(['KI']);
      expect(productOf(iodide, 'PbI2').amount_mol).toBeCloseTo(0.025, AMOUNT_PRECISION);
    });

    it('names both reactants limiting and reports no excess at stoichiometric equivalence', () => {
      const quantities = { concentration_molL: 0.8, volume_mL: 60 };
      const result = evaluator.evaluateExperiment(buildInput('HCl', quantities, 'NaOH', quantities));

      expect(result.extent_mol).toBeCloseTo(0.048, AMOUNT_PRECISION);
      expect([...result.limitingSpecies].sort()).toEqual(['HCl', 'NaOH']);
      expect(result.excessSpecies).toEqual([]);
      for (const reactant of result.reactants) {
        expect(reactant.remaining_mol, reactant.reagentId).toBe(0);
        expect(reactant.limiting, reactant.reagentId).toBe(true);
      }
      expect(productOf(result, 'H2O').amount_mol).toBeCloseTo(0.048, AMOUNT_PRECISION);
      expect(productOf(result, 'NaCl').amount_mol).toBeCloseTo(0.048, AMOUNT_PRECISION);
    });

    it('never consumes beyond the available amount of any reactant', () => {
      const quantitiesA = { concentration_molL: 1.9, volume_mL: 97 };
      const quantitiesB = { concentration_molL: 0.2, volume_mL: 11 };

      for (const [reagentA, reagentB] of REQUIRED_REAGENT_PAIRS) {
        const result = evaluator.evaluateExperiment(buildInput(reagentA, quantitiesA, reagentB, quantitiesB));
        const label = result.pairKey;

        expect(result.extent_mol, label).toBeGreaterThan(0);
        expect(result.limitingSpecies.length, label).toBeGreaterThanOrEqual(1);
        for (const reactant of result.reactants) {
          expect(reactant.consumed_mol, `${label} ${reactant.reagentId}`).toBeLessThanOrEqual(
            reactant.amount_mol + evaluator.amountTolerance,
          );
          expect(reactant.remaining_mol, `${label} ${reactant.reagentId}`).toBeGreaterThanOrEqual(0);
          expect(reactant.consumed_mol + reactant.remaining_mol, `${label} ${reactant.reagentId}`).toBeCloseTo(
            reactant.amount_mol,
            AMOUNT_PRECISION,
          );
        }
        for (const product of result.products) {
          expect(product.amount_mol, `${label} ${product.speciesId}`).toBeCloseTo(
            result.extent_mol * product.coefficient,
            AMOUNT_PRECISION,
          );
        }
      }
    });
  });

  describe('projections derived from the one reaction record', () => {
    it('reports equations, phase, appearance, and energy from the resolved reaction', () => {
      for (const [reagentA, reagentB] of REQUIRED_REAGENT_PAIRS) {
        const quantities = { concentration_molL: 1, volume_mL: 50 };
        const result = evaluator.evaluateExperiment(buildInput(reagentA, quantities, reagentB, quantities));
        const reaction = catalog.reactions[result.pairKey];
        const label = result.pairKey;

        expect(result.molecularEquation, label).toBe(formatters.formatMolecularEquation(reaction));
        expect(result.netIonicEquation, label).toBe(formatters.formatNetIonicEquation(reaction));
        expect(result.productSummary, label).toBe(formatters.formatProductSummary(reaction));
        expect(result.spectatorIons, label).toEqual([...reaction.spectatorIons]);
        expect(result.displayName, label).toBe(reaction.displayName);

        expect(result.phaseModel, label).toEqual(formatters.describePhaseModel(reaction.phaseModel));
        expect(result.phaseModel.layered, label).toBe(false);

        expect(result.appearance.clarity, label).toBe(reaction.presentation.appearance);
        expect(result.appearance.color, label).toBe(reaction.presentation.solutionColor);
        expect(result.energy.label, label).toBe(reaction.presentation.energyLabel);
        expect(result.energy.quantitativeEnthalpy, label).toBe(false);
        expect(result.energy.message, label).toBe(formatters.resolveMessage(catalog.model.capabilities.energy.messageKey));
      }
    });

    it('keeps the precipitate agreeing with the equation that produced it', () => {
      const quantities = { concentration_molL: 1, volume_mL: 50 };
      const precipitation = evaluator.evaluateExperiment(buildInput('BaCl2', quantities, 'Na2SO4', quantities));

      expect(precipitation.category).toBe('precipitation');
      expect(precipitation.appearance.precipitate).toEqual({
        speciesId: 'BaSO4',
        formula: 'BaSO\u2084',
        displayName: 'Barium Sulfat',
        color: '#ffffff',
      });
      expect(precipitation.appearance.clarity).toBe('cloudy');
      expect(precipitation.phaseModel.phases).toEqual(['aq', 's']);
      expect(productOf(precipitation, 'BaSO4').phase).toBe('s');
      expect(precipitation.molecularEquation).toContain('BaSO\u2084(s)');
      expect(precipitation.netIonicEquation).toContain('BaSO\u2084(s)');
      // Stoichiometric coefficients stay ASCII; element counts are Unicode
      // subscripts, so no formula may carry an ASCII count.
      expect(precipitation.molecularEquation).toContain('2NaCl(aq)');
      expect(precipitation.molecularEquation).not.toMatch(/BaCl2|Na2SO4|BaSO4/u);
      expect(precipitation.productSummary).not.toMatch(/BaSO4/u);

      const neutralization = evaluator.evaluateExperiment(buildInput('HCl', quantities, 'NaOH', quantities));
      expect(neutralization.category).toBe('strong_acid_base');
      expect(neutralization.appearance.precipitate).toBeNull();
      expect(neutralization.appearance.clarity).toBe('clear');
      expect(neutralization.phaseModel.phases).toEqual(['aq']);
      expect(neutralization.energy.exothermic).toBe(true);
    });

    it('reports a pH for the one system the catalog models and none for the rest', () => {
      const quantities = { concentration_molL: 1, volume_mL: 50 };
      for (const [reagentA, reagentB] of REQUIRED_REAGENT_PAIRS) {
        const result = evaluator.evaluateExperiment(buildInput(reagentA, quantities, reagentB, quantities));
        const reaction = formatters.findReaction(reagentA, reagentB);

        if (reaction.pH) {
          expect(result.pH.supported, result.pairKey).toBe(true);
          expect(result.pH.modelId, result.pairKey).toBe(reaction.pH.modelId);
        } else {
          // Task 5.4 owns the reason code and localized boundary text for
          // these; until then a salt solution reports no number at all.
          expect(result.pH, result.pairKey).toBeNull();
          expect(reaction.pHUnsupportedReasonCode, result.pairKey).toBeTruthy();
        }

        // Task 6.1 owns the ion-level ledger.
        expect(result.speciesLedger, result.pairKey).toBeNull();
      }
    });
  });

  describe('purity', () => {
    it('declares no DOM, clock, random, network, or provider dependency', async () => {
      const source = await readFile(EVALUATOR_SOURCE_PATH, 'utf8');
      const forbidden = [
        /\bdocument\b/u,
        /\bwindow\b/u,
        /\bglobalThis\b/u,
        /\bnavigator\b/u,
        /Math\.random/u,
        /\bDate\b/u,
        /performance\.now/u,
        /\bfetch\(/u,
        /requestAnimationFrame/u,
        /process\.env/u,
      ];
      for (const pattern of forbidden) {
        expect(source, String(pattern)).not.toMatch(pattern);
      }
    });

    it('returns an equal deeply frozen result for repeated identical evaluations', () => {
      const randomSpy = vi.spyOn(Math, 'random');
      const nowSpy = vi.spyOn(Date, 'now');

      const input = buildInput('AgNO3', { concentration_molL: 1.3, volume_mL: 27 }, 'KI', {
        concentration_molL: 0.9,
        volume_mL: 64,
      });
      const first = evaluator.evaluateExperiment(input);
      const second = evaluator.evaluateExperiment(input);

      expect(second).toEqual(first);
      expect(randomSpy).not.toHaveBeenCalled();
      expect(nowSpy).not.toHaveBeenCalled();

      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.reactants)).toBe(true);
      expect(Object.isFrozen(first.reactants[0])).toBe(true);
      expect(Object.isFrozen(first.products[0])).toBe(true);
      expect(() => {
        first.reactants[0].amount_mol = 0;
      }).toThrow(TypeError);
    });

    it('reads the supplied catalog rather than a hardcoded table', () => {
      const mutated = structuredClone(catalog);
      mutated.reactions['AgNO3|NaCl'].molecularReactants.find((term) => term.speciesId === 'NaCl').coefficient = 2;

      const quantities = { concentration_molL: 1, volume_mL: 50 };
      const input = buildInput('AgNO3', quantities, 'NaCl', quantities);
      expect(evaluateExperiment(mutated, input).extent_mol).toBeCloseTo(0.025, AMOUNT_PRECISION);
      expect(evaluator.evaluateExperiment(input).extent_mol).toBeCloseTo(0.05, AMOUNT_PRECISION);
    });
  });
});

/**
 * Display precision never reaches the domain.
 *
 * The evaluator keeps every scientific value exactly as the arithmetic
 * produced it, and the formatter projections are the only place a rounded
 * number exists. The leak test is what makes this meaningful: a rounded value
 * fed back as an input produces a different extent, a different excess, and
 * even a different limiting reactant, so a precision leak could not hide.
 *
 * Validates: Requirements 3.7
 */
describe('unrounded domain values', () => {
  /** Rounding constructs and display calls the evaluator must not contain. */
  const ROUNDING_CONSTRUCTS = [
    /\btoFixed\b/u,
    /\btoPrecision\b/u,
    /\btoLocaleString\b/u,
    /Math\.round/u,
    /Math\.ceil/u,
    /Math\.floor/u,
    /Math\.trunc/u,
    /\bIntl\b/u,
    /\bformatFixed\b/u,
    /\bformatQuantity/u,
    /\broundHalfAwayFromZero\b/u,
    /\broundQuantityForDisplay\b/u,
    /\bdescribeDisplayQuantity\b/u,
    /\bEPSILON\b/u,
  ];

  // Deliberately unrounded quantities: every one of them loses information at
  // its declared display precision, and so does every amount derived from
  // them, so a rounded value could never pass for the exact one.
  const UNROUNDED_A = { concentration_molL: 0.123456, volume_mL: 33.26 };
  const UNROUNDED_B = { concentration_molL: 0.100505, volume_mL: 40.04 };

  let catalog;
  let evaluator;
  let formatters;

  beforeAll(async () => {
    catalog = await loadCatalog();
    evaluator = createChemistryEvaluator(catalog);
    formatters = createChemistryFormatters(catalog);
  });

  it('keeps every reported quantity equal to the exact unrounded arithmetic', () => {
    const result = evaluator.evaluateExperiment(buildInput('HCl', UNROUNDED_A, 'NaOH', UNROUNDED_B));

    const acid = reactantOf(result, 'HCl');
    const base = reactantOf(result, 'NaOH');
    const acidAmount = UNROUNDED_A.concentration_molL * (UNROUNDED_A.volume_mL / MILLILITRES_PER_LITRE);
    const baseAmount = UNROUNDED_B.concentration_molL * (UNROUNDED_B.volume_mL / MILLILITRES_PER_LITRE);

    // Strict equality, not a tolerance: the stored value is the arithmetic
    // itself, with nothing applied to it on the way out.
    expect(acid.concentration_molL).toBe(UNROUNDED_A.concentration_molL);
    expect(acid.volume_mL).toBe(UNROUNDED_A.volume_mL);
    expect(acid.volume_L).toBe(UNROUNDED_A.volume_mL / MILLILITRES_PER_LITRE);
    expect(acid.amount_mol).toBe(acidAmount);
    expect(acid.amount_mol).toBe(calculateAmount(UNROUNDED_A.concentration_molL, UNROUNDED_A.volume_mL));
    expect(base.amount_mol).toBe(baseAmount);
    expect(result.totalVolume_L).toBe(acid.volume_L + base.volume_L);

    expect(result.extent_mol).toBe(Math.min(acidAmount, baseAmount));
    expect(result.limitingSpecies).toEqual(['NaOH']);
    expect(acid.consumed_mol).toBe(result.extent_mol);
    expect(acid.remaining_mol).toBe(acidAmount - result.extent_mol);
    expect(result.excessSpecies.map((excess) => excess.amount_mol)).toEqual([acidAmount - baseAmount]);
    expect(productOf(result, 'NaCl').amount_mol).toBe(result.extent_mol);

    // The quantities are genuinely unrounded: each one still carries digits
    // beyond what its display precision would keep.
    expect(acid.amount_mol).not.toBe(formatters.roundQuantityForDisplay('amount_mol', acid.amount_mol));
    expect(acid.concentration_molL).not.toBe(formatters.roundQuantityForDisplay('concentration_molL', acid.concentration_molL));
    expect(acid.volume_mL).not.toBe(formatters.roundQuantityForDisplay('volume_mL', acid.volume_mL));
    expect(result.excessSpecies[0].amount_mol).not.toBe(
      formatters.roundQuantityForDisplay('amount_mol', result.excessSpecies[0].amount_mol),
    );
  });

  it('contains no rounding construct and never calls the display precision layer', async () => {
    const source = await readFile(EVALUATOR_SOURCE_PATH, 'utf8');
    for (const pattern of ROUNDING_CONSTRUCTS) {
      expect(source, String(pattern)).not.toMatch(pattern);
    }

    // The evaluator reuses the formatters for strings only. It imports no
    // quantity formatter, so there is no call site a precision could enter by.
    const imported = source.match(/import \{([^}]+)\} from '\.\/chemistry-formatters\.js';/u);
    expect(imported?.[1].split(',').map((name) => name.trim())).toEqual([
      'createChemistryFormatters',
      'normalizePairKey',
    ]);
    expect(Object.keys(evaluator)).not.toContain('formatQuantity');
  });

  it('would expose a precision leak: a rounded input changes extent and excess', () => {
    const unrounded = evaluator.evaluateExperiment(buildInput('HCl', UNROUNDED_A, 'NaOH', UNROUNDED_B));

    // Exactly what a leak would do: take the numbers the learner sees and let
    // them flow back into the chemistry.
    const displayed = {
      concentration_molL: formatters.roundQuantityForDisplay('concentration_molL', UNROUNDED_A.concentration_molL),
      volume_mL: formatters.roundQuantityForDisplay('volume_mL', UNROUNDED_A.volume_mL),
    };
    expect(displayed).toEqual({ concentration_molL: 0.12, volume_mL: 33.3 });

    const leaked = evaluator.evaluateExperiment(buildInput('HCl', displayed, 'NaOH', UNROUNDED_B));

    expect(leaked.extent_mol).not.toBe(unrounded.extent_mol);
    expect(Math.abs(leaked.extent_mol - unrounded.extent_mol)).toBeGreaterThan(evaluator.amountTolerance);
    expect(leaked.excessSpecies.map((excess) => excess.speciesId)).not.toEqual(
      unrounded.excessSpecies.map((excess) => excess.speciesId),
    );
    // The rounding even moves the limiting reactant, so the leak would change
    // the chemistry a learner is told, not just the last displayed digit.
    expect(leaked.limitingSpecies).toEqual(['HCl']);
    expect(unrounded.limitingSpecies).toEqual(['NaOH']);
    expect(productOf(leaked, 'NaCl').amount_mol).not.toBe(productOf(unrounded, 'NaCl').amount_mol);
  });

  it('projects display strings beside the result without changing it', () => {
    const result = evaluator.evaluateExperiment(buildInput('HCl', UNROUNDED_A, 'NaOH', UNROUNDED_B));
    const projection = formatters.formatExperimentQuantities(result);
    const acid = reactantOf(result, 'HCl');
    const base = reactantOf(result, 'NaOH');
    const projectedAcid = projection.reactants.find((reactant) => reactant.reagentId === 'HCl');

    expect(projection.catalogVersion).toBe(catalog.catalogVersion);
    expect(projectedAcid.concentration_molL).toBe('0.12 M');
    expect(projectedAcid.volume_mL).toBe('33.3 mL');
    expect(projectedAcid.amount_mol).toBe('0.0041 mol');
    expect(projection.extent_mol).toBe('0.0040 mol');
    expect(projection.totalVolume_L).toBe('0.0733 L');
    expect(projection.excessSpecies).toEqual([{ speciesId: 'HCl', amount_mol: '0.0001 mol' }]);

    // Every projected string is lossy, and the domain value behind it is not.
    expect(Number.parseFloat(projectedAcid.amount_mol)).not.toBe(acid.amount_mol);
    expect(Number.parseFloat(projection.extent_mol)).not.toBe(result.extent_mol);
    expect(acid.amount_mol).toBe(
      UNROUNDED_A.concentration_molL * (UNROUNDED_A.volume_mL / MILLILITRES_PER_LITRE),
    );

    // Re-projecting the same result is stable, and the result is still frozen.
    expect(formatters.formatExperimentQuantities(result)).toEqual(projection);
    expect(Object.isFrozen(result)).toBe(true);

    // The pH obeys the same split: the domain keeps the unrounded cologarithm
    // and the projection is the only place it becomes two decimals.
    expect(result.pH.value).toBe(
      -Math.log10((acid.amount_mol - base.amount_mol) / result.totalVolume_L),
    );
    expect(projection.pH).toBe(formatters.formatQuantity('pH', result.pH.value));
    expect(Number.parseFloat(projection.pH)).not.toBe(result.pH.value);

    // The species ledger stays the honest null the evaluator reports.
    expect(result.speciesLedger).toBeNull();
    expect(projection.speciesLedger).toBeNull();
  });
});

/**
 * Golden evaluation vectors.
 *
 * `tests/fixtures/chemistry/experiment-vectors.json` states, by hand, the whole
 * expected outcome of a concrete experiment: the corrected Unicode formulas and
 * balanced equations, the category, the limiting reactant, the extent, what was
 * consumed and what is left over, the product amounts, the spectator ions, the
 * phase model, the appearance, and the energy label. The fixture is written
 * independently of both the catalog and this evaluator, so a wrong coefficient,
 * a dropped subscript, a reversed limiting reactant, or a reintroduced layer
 * boundary cannot satisfy both the fixture and the code.
 *
 * The same file is read by `backend/tests/test_chemistry_evaluator.py`, which
 * is what makes it a parity contract rather than one language's snapshot.
 *
 * These vectors are the regression guard for the audited display defects:
 * `AgNO`, `AgNO(aq)`, and `Pb(NO)₂` cannot appear in any learner-facing string,
 * a precipitate cannot coexist with no-reaction text, and no mixture of any
 * kind can be rendered as two layers.
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 26.3
 */
describe('golden experiment vectors', () => {
  let catalog;
  let evaluator;
  let formatters;
  let fixture;

  beforeAll(async () => {
    catalog = await loadCatalog();
    evaluator = createChemistryEvaluator(catalog);
    formatters = createChemistryFormatters(catalog);
    fixture = await loadExperimentVectorFixture();
  });

  const vectors = () => fixture.vectors;
  const supportedVectors = () => fixture.vectors.filter((vector) => vector.support.kind === 'supported');
  const unsupportedVectors = () => fixture.vectors.filter((vector) => vector.support.kind === 'unsupported');

  /** Evaluates one vector with its two solutions in the given slot order. */
  function evaluateVector(vector, { reversed = false } = {}) {
    const [first, second] = reversed ? [...vector.solutions].reverse() : vector.solutions;
    return evaluator.evaluateExperiment(buildInput(first.reagentId, first, second.reagentId, second));
  }

  /** Reads a dotted path, treating a missing branch as an absent string. */
  function readPath(value, path) {
    return path.split('.').reduce((current, key) => (current == null ? current : current[key]), value);
  }

  /** Every learner-facing string one result exposes. */
  function displayStrings(result) {
    return fixture.regressionGuards.displayStringFields
      .map((path) => readPath(result, path))
      .filter((value) => typeof value === 'string');
  }

  it('is pinned to the committed catalog release', () => {
    expect(fixture.catalogVersion).toBe(catalog.catalogVersion);
    expect(fixture.modelVersion).toBe(catalog.model.modelVersion);
    expect(fixture.locale).toBe(catalog.locale);
  });

  it('covers all six supported pairs and representative no-reaction pairs', () => {
    const supportedKeys = new Set(supportedVectors().map((vector) => vector.pairKey));
    expect([...supportedKeys].sort()).toEqual(Object.keys(catalog.reactions).sort());

    // A pair whose two reagents happen to be at equivalence hides the limiting
    // reagent, so every supported pair also needs a vector where they are not.
    for (const pairKey of supportedKeys) {
      const nonEquivalent = supportedVectors().filter(
        (vector) => vector.pairKey === pairKey && !vector.stoichiometricEquivalence,
      );
      expect(nonEquivalent.length, pairKey).toBeGreaterThanOrEqual(1);
    }

    const unsupportedKeys = unsupportedVectors().map((vector) => vector.pairKey);
    expect(unsupportedKeys.length).toBeGreaterThanOrEqual(4);
    for (const pairKey of unsupportedKeys) {
      expect(catalog.reactions[pairKey], pairKey).toBeUndefined();
    }

    expect(new Set(vectors().map((vector) => vector.id)).size).toBe(vectors().length);
  });

  it('keeps every vector quantity inside the catalog control bounds', () => {
    const concentration = catalog.model.bounds.concentration_molL;
    const volume = catalog.model.bounds.volume_mL;

    for (const vector of vectors()) {
      expect(vector.solutions, vector.id).toHaveLength(2);
      for (const solution of vector.solutions) {
        const label = `${vector.id} ${solution.reagentId}`;
        expect(catalog.reagents[solution.reagentId], label).toBeDefined();
        expect(solution.concentration_molL, label).toBeGreaterThanOrEqual(concentration.minimum);
        expect(solution.concentration_molL, label).toBeLessThanOrEqual(concentration.maximum);
        expect(solution.volume_mL, label).toBeGreaterThanOrEqual(volume.minimum);
        expect(solution.volume_mL, label).toBeLessThanOrEqual(volume.maximum);
      }
      // Canonical reagent order, the same order the result reports.
      expect(vector.solutions.map((solution) => solution.reagentId), vector.id).toEqual(
        [...vector.reagents].sort(),
      );
      expect(vector.solutions.map((solution) => solution.reagentId).join('|'), vector.id).toBe(vector.pairKey);
    }
  });

  it('reproduces the stated reaction identity, category, and support status', () => {
    for (const vector of vectors()) {
      const result = evaluateVector(vector);
      const label = vector.id;

      expect(result.catalogVersion, label).toBe(fixture.catalogVersion);
      expect(result.modelVersion, label).toBe(fixture.modelVersion);
      expect(result.pairKey, label).toBe(vector.pairKey);
      expect(result.reactionId, label).toBe(vector.reactionId);
      expect(result.category, label).toBe(vector.category);
      expect(result.displayName, label).toBe(vector.displayName);
      expect(result.support.kind, label).toBe(vector.support.kind);

      if (vector.support.kind === 'supported') {
        expect(result.support, label).toEqual({ kind: 'supported', modelVersion: fixture.modelVersion });
      } else {
        expect(result.support.code, label).toBe(vector.support.code);
        expect(result.support.messageKey, label).toBe(vector.support.messageKey);
        expect(result.support.message, label).toBe(formatters.resolveMessage(vector.support.messageKey));
      }
    }
  });

  it('reproduces the stated amounts, extent, limiting reactants, and excess', () => {
    for (const vector of vectors()) {
      const result = evaluateVector(vector);

      expect(result.totalVolume_L, vector.id).toBeCloseTo(vector.totalVolume_L, AMOUNT_PRECISION);
      expect(result.extent_mol, vector.id).toBeCloseTo(vector.extent_mol, AMOUNT_PRECISION);
      expect(result.limitingSpecies, vector.id).toEqual(vector.limitingSpecies);

      for (const solution of vector.solutions) {
        const reactant = reactantOf(result, solution.reagentId);
        const label = `${vector.id} ${solution.reagentId}`;
        expect(reactant.concentration_molL, label).toBe(solution.concentration_molL);
        expect(reactant.volume_mL, label).toBe(solution.volume_mL);
        expect(reactant.coefficient, label).toBe(solution.coefficient);
        expect(reactant.amount_mol, label).toBeCloseTo(solution.amount_mol, AMOUNT_PRECISION);
        expect(reactant.consumed_mol, label).toBeCloseTo(solution.consumed_mol, AMOUNT_PRECISION);
        expect(reactant.remaining_mol, label).toBeCloseTo(solution.remaining_mol, AMOUNT_PRECISION);
        expect(reactant.limiting, label).toBe(solution.limiting);
      }

      expect(result.excessSpecies.map((species) => species.speciesId), vector.id).toEqual(
        vector.excessSpecies.map((species) => species.speciesId),
      );
      for (const [index, expected] of vector.excessSpecies.entries()) {
        const label = `${vector.id} ${expected.speciesId}`;
        expect(result.excessSpecies[index].role, label).toBe('excess');
        expect(result.excessSpecies[index].amount_mol, label).toBeCloseTo(expected.amount_mol, AMOUNT_PRECISION);
      }
    }
  });

  it('reproduces the stated products and spectator ions', () => {
    for (const vector of vectors()) {
      const result = evaluateVector(vector);

      expect(result.products.map((product) => product.speciesId), vector.id).toEqual(
        vector.products.map((product) => product.speciesId),
      );
      for (const [index, expected] of vector.products.entries()) {
        const label = `${vector.id} ${expected.speciesId}`;
        expect(result.products[index].phase, label).toBe(expected.phase);
        expect(result.products[index].coefficient, label).toBe(expected.coefficient);
        expect(result.products[index].role, label).toBe('product');
        expect(result.products[index].amount_mol, label).toBeCloseTo(expected.amount_mol, AMOUNT_PRECISION);
      }

      expect(result.spectatorIons, vector.id).toEqual(vector.spectatorIons);
    }
  });

  it('reproduces the stated equations, phase model, appearance, and energy label', () => {
    for (const vector of vectors()) {
      const result = evaluateVector(vector);
      const label = vector.id;

      expect(result.molecularEquation, label).toBe(vector.molecularEquation);
      expect(result.netIonicEquation, label).toBe(vector.netIonicEquation);
      expect(result.productSummary, label).toBe(vector.productSummary);

      expect(result.phaseModel.phaseModel, label).toBe(vector.phaseModel.name);
      expect(result.phaseModel.phases, label).toEqual(vector.phaseModel.phases);
      expect(result.phaseModel.layered, label).toBe(vector.phaseModel.layered);

      expect(result.appearance.clarity, label).toBe(vector.appearance.clarity);
      if (vector.appearance.precipitateSpeciesId === null) {
        expect(result.appearance.precipitate, label).toBeNull();
      } else {
        expect(result.appearance.precipitate.speciesId, label).toBe(vector.appearance.precipitateSpeciesId);
        expect(result.appearance.precipitate.formula, label).toBe(vector.appearance.precipitateFormula);
        expect(result.appearance.precipitate.displayName, label).toBe(vector.appearance.precipitateDisplayName);
      }

      expect(result.energy.label, label).toBe(vector.energy.label);
      expect(result.energy.exothermic, label).toBe(vector.energy.exothermic);

      // Task 6.1 owns the ion-level ledger; the vectors record that it is
      // still an honest null rather than a fabricated particle count.
      expect(result.speciesLedger, label).toBeNull();
    }
  });

  it('reproduces the stated pH, or the stated absence of one, for every vector', () => {
    for (const vector of vectors()) {
      const result = evaluateVector(vector);
      const label = vector.id;

      if (vector.pH === null) {
        // Task 5.4 owns the reason code and the localized boundary text for
        // these; nothing numeric may stand in for them meanwhile.
        expect(result.pH, label).toBeNull();
        expect(JSON.stringify(result), label).not.toMatch(/~\s*7/u);
        continue;
      }

      expect(result.pH.supported, label).toBe(true);
      expect(result.pH.equivalence, label).toBe(vector.pH.equivalence);
      expect(result.pH.side, label).toBe(vector.pH.side);
      expect(result.pH.excessIonId, label).toBe(vector.pH.excessIonId);
      expect(result.pH.excessAmount_mol, label).toBeCloseTo(vector.pH.excessAmount_mol, AMOUNT_PRECISION);
      expect(result.pH.excessConcentration_molL, label).toBeCloseTo(
        vector.pH.excessConcentration_molL,
        PH_PRECISION,
      );
      expect(result.pH.value, label).toBeCloseTo(vector.pH.value, PH_PRECISION);
      expect(formatters.formatQuantity('pH', result.pH.value), label).toBe(vector.pH.display);
    }
  });

  it('produces the identical result for both A/B orders of every vector', () => {
    for (const vector of vectors()) {
      const forward = evaluateVector(vector);
      const reversed = evaluateVector(vector, { reversed: true });
      expect(reversed, vector.id).toEqual(forward);
      expect(Object.isFrozen(forward), vector.id).toBe(true);
    }
  });

  /** Validates: Requirements 2.3 */
  it('cannot emit the audited malformed formulas in any learner-facing string', () => {
    const patterns = fixture.regressionGuards.malformedFormulaPatterns;
    expect(patterns.length).toBeGreaterThanOrEqual(4);

    // The patterns must actually be able to fire, or the guard proves nothing.
    const audited = ['AgNO(aq) + NaCl(aq)', 'AgNO + NaCl', 'Pb(NO)₂(aq) + 2KI(aq)', 'Pb(NO)2 + 2KI', 'AgNO3(aq)'];
    for (const sample of audited) {
      expect(
        patterns.some(({ pattern }) => new RegExp(pattern, 'u').test(sample)),
        sample,
      ).toBe(true);
    }

    for (const vector of vectors()) {
      // Both the evaluated result and the hand-written expectation are scanned,
      // so a malformed formula cannot be introduced by editing the fixture.
      const declared = [
        vector.molecularEquation,
        vector.netIonicEquation,
        vector.productSummary,
        vector.appearance.precipitateFormula,
        ...vector.reagentFormulas,
      ].filter((value) => typeof value === 'string');
      const strings = [...displayStrings(evaluateVector(vector)), ...declared];
      expect(strings.length, vector.id).toBeGreaterThan(0);
      for (const text of strings) {
        for (const { pattern, label } of patterns) {
          expect(new RegExp(pattern, 'u').test(text), `${vector.id} / ${label} / ${text}`).toBe(false);
        }
      }
    }
  });

  it('uses the corrected Unicode reagent formulas the vectors declare', () => {
    for (const vector of vectors()) {
      for (const [index, reagentId] of vector.solutions.map((solution) => solution.reagentId).entries()) {
        expect(formatters.formatSpeciesFormula(reagentId), `${vector.id} ${reagentId}`).toBe(
          vector.reagentFormulas[index],
        );
      }
      if (vector.molecularEquation !== null) {
        for (const formula of vector.reagentFormulas) {
          expect(vector.molecularEquation, `${vector.id} ${formula}`).toContain(formula);
        }
      }
    }
  });

  /** Validates: Requirements 2.5 */
  it('never shows a precipitate beside no-reaction text', () => {
    const { contradictoryNoReactionText, noModeledReactionMessageKey } = fixture.regressionGuards;

    for (const vector of vectors()) {
      const result = evaluateVector(vector);
      const label = vector.id;

      for (const text of displayStrings(result)) {
        expect(text, label).not.toContain(contradictoryNoReactionText);
      }

      if (result.appearance.precipitate !== null) {
        expect(result.support.kind, label).toBe('supported');
        expect(result.support.messageKey, label).toBeUndefined();
        expect(result.category, label).not.toBe(NO_MODELED_REACTION_CATEGORY);
        expect(result.molecularEquation, label).toContain(result.appearance.precipitate.formula);
        expect(result.products.some((product) => product.speciesId === result.appearance.precipitate.speciesId), label)
          .toBe(true);
        expect(result.extent_mol, label).toBeGreaterThan(0);
      }

      if (result.category === NO_MODELED_REACTION_CATEGORY) {
        expect(result.support.messageKey, label).toBe(noModeledReactionMessageKey);
        expect(result.appearance.precipitate, label).toBeNull();
        expect(result.products, label).toEqual([]);
        expect(result.molecularEquation, label).toBeNull();
        expect(result.netIonicEquation, label).toBeNull();
      }
    }
  });

  /** Validates: Requirements 2.4 */
  it('keeps every vector, reacted or not, in one unlayered mixture', () => {
    for (const vector of vectors()) {
      const result = evaluateVector(vector);
      const label = vector.id;

      expect(result.phaseModel.layered, label).toBe(false);
      expect(result.phaseModel.phases, label).toContain('aq');
      // The only second phase version 1 declares is a solid precipitate, which
      // is not a liquid layer; an ordinary mixture has no second phase at all.
      expect(result.phaseModel.phases.filter((phase) => phase !== 'aq'), label).toEqual(
        result.appearance.precipitate === null ? [] : ['s'],
      );

      for (const text of displayStrings(result)) {
        for (const layerLabel of fixture.regressionGuards.forbiddenLayerLabels) {
          expect(text, `${label} / ${layerLabel}`).not.toContain(layerLabel);
        }
      }
    }
  });

  it('exercises the 1:2 lead halide stoichiometry with equal amounts', () => {
    const leadVectors = supportedVectors().filter((vector) => vector.reagents.includes('Pb(NO3)2'));
    expect(leadVectors.length).toBeGreaterThanOrEqual(4);

    const equalAmountVectors = leadVectors.filter((vector) => {
      const [first, second] = vector.solutions;
      return (
        first.concentration_molL === second.concentration_molL && first.volume_mL === second.volume_mL
      );
    });
    expect(equalAmountVectors).toHaveLength(2);

    for (const vector of equalAmountVectors) {
      const result = evaluateVector(vector);
      const halide = vector.solutions.find((solution) => solution.reagentId !== 'Pb(NO3)2');
      const label = vector.id;

      // Equal amounts are not equal equivalents: the halide carries coefficient
      // two, so it is limiting and half the lead nitrate survives.
      expect(reactantOf(result, halide.reagentId).coefficient, label).toBe(2);
      expect(reactantOf(result, 'Pb(NO3)2').coefficient, label).toBe(1);
      expect(result.limitingSpecies, label).toEqual([halide.reagentId]);
      expect(result.extent_mol, label).toBeCloseTo(halide.amount_mol / 2, AMOUNT_PRECISION);
      expect(result.excessSpecies.map((species) => species.speciesId), label).toEqual(['Pb(NO3)2']);
      expect(result.excessSpecies[0].amount_mol, label).toBeCloseTo(halide.amount_mol / 2, AMOUNT_PRECISION);
      expect(vector.stoichiometricEquivalence, label).toBe(false);
    }
  });

  it('reports no excess and both reactants limiting at stoichiometric equivalence', () => {
    const equivalenceVectors = supportedVectors().filter((vector) => vector.stoichiometricEquivalence);
    expect(equivalenceVectors.length).toBeGreaterThanOrEqual(3);

    for (const vector of equivalenceVectors) {
      const result = evaluateVector(vector);
      expect(result.excessSpecies, vector.id).toEqual([]);
      expect(result.limitingSpecies, vector.id).toEqual(vector.solutions.map((solution) => solution.reagentId));
      for (const reactant of result.reactants) {
        expect(reactant.remaining_mol, `${vector.id} ${reactant.reagentId}`).toBe(0);
        expect(reactant.limiting, `${vector.id} ${reactant.reagentId}`).toBe(true);
      }
    }
  });

  /**
   * The four demonstrations the lab shipped with still reach their intended
   * precipitation or neutralization category, now with the corrected
   * quantitative detail the rest of this suite pins down.
   *
   * Validates: Requirements 26.3
   */
  it('preserves the four canonical demonstrations', () => {
    const preserved = fixture.preservedDemonstrations;
    expect(preserved.requirement).toBe('26.3');
    expect(preserved.vectors).toHaveLength(4);
    expect(preserved.vectors.map((entry) => [...entry.reagents].sort().join('|')).sort()).toEqual([
      'AgNO3|NaCl',
      'BaCl2|Na2SO4',
      'HCl|NaOH',
      'KI|Pb(NO3)2',
    ]);
    expect(vectors().filter((vector) => vector.preservedDemonstration)).toHaveLength(4);

    for (const entry of preserved.vectors) {
      const vector = vectors().find((candidate) => candidate.id === entry.vectorId);
      expect(vector, entry.vectorId).toBeDefined();
      expect(vector.preservedDemonstration, entry.vectorId).toBe(true);

      const result = evaluateVector(vector);
      const label = entry.vectorId;
      expect(result.support.kind, label).toBe('supported');
      expect(result.category, label).toBe(entry.category);
      expect(result.energy.label, label).toBe(entry.energyLabel);
      expect(result.extent_mol, label).toBeGreaterThan(0);
      expect(result.products.length, label).toBeGreaterThan(0);

      if (entry.precipitateSpeciesId === null) {
        expect(result.category, label).toBe('strong_acid_base');
        expect(result.appearance.precipitate, label).toBeNull();
        expect(result.energy.exothermic, label).toBe(true);
      } else {
        expect(result.category, label).toBe('precipitation');
        expect(result.appearance.precipitate.speciesId, label).toBe(entry.precipitateSpeciesId);
        expect(productOf(result, entry.precipitateSpeciesId).phase, label).toBe('s');
      }
    }
  });
});

/**
 * Validated experiment input semantics.
 *
 * The audited lab presented four controls as reaction inputs while reading
 * none of them for chemistry: molarity and volume only changed a capped
 * particle count, temperature only changed animation speed, and pressure had
 * no handler at all (defect 1.5). These tests pin down the corrected contract
 * from `experiment-vectors.json`'s hand-written `controlCapabilities` block:
 *
 * - concentration and volume feed every quantitative path, at every declared
 *   bound, including which reactant ends up limiting,
 * - temperature produces bounded qualitative motion metadata and nothing else,
 * - pressure is fixed at 1 atm, influences no calculated value, and is
 *   reported with its localized boundary statement instead of being ignored,
 * - no pH value is fabricated at any control position.
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */
describe('experiment control capabilities', () => {
  let catalog;
  let evaluator;
  let formatters;
  let capabilities;
  let phModel;

  beforeAll(async () => {
    catalog = await loadCatalog();
    evaluator = createChemistryEvaluator(catalog);
    formatters = createChemistryFormatters(catalog);
    const fixture = await loadExperimentVectorFixture();
    capabilities = fixture.controlCapabilities;
    phModel = fixture.pHModel;
  });

  /** Evaluates one fixture case at an explicit temperature. */
  function evaluateCase(testCase, { temperature_C = 25, omitPressure = false } = {}) {
    const [first, second] = testCase.solutions;
    const input = buildInput(first.reagentId, first, second.reagentId, second);
    input.temperature_C = temperature_C;
    if (omitPressure) delete input.pressure_atm;
    return evaluator.evaluateExperiment(input);
  }

  /** The result without its motion metadata, which is temperature's only output. */
  function withoutMotion(result) {
    const { motion, ...rest } = result;
    return rest;
  }

  function amountOf(entries, speciesId) {
    const entry = entries.find((candidate) => candidate.speciesId === speciesId);
    if (!entry) throw new Error(`result declares no entry for ${speciesId}`);
    return entry.amount_mol;
  }

  it('is pinned to the declared control bounds and capabilities', () => {
    const bounds = catalog.model.bounds;
    const temperature = catalog.model.capabilities.temperature;
    const pressure = catalog.model.capabilities.pressure;

    expect(capabilities.quantitativeInputs).toEqual(['concentration_molL', 'volume_mL']);
    expect(capabilities.qualitativeInputs).toEqual(['temperature_C']);
    expect(capabilities.unsupportedInputs).toEqual(['pressure_atm']);

    expect(capabilities.temperature.effect).toBe(temperature.effect);
    expect(capabilities.temperature.model).toBe(temperature.motionSpeedFactor.model);
    expect(capabilities.temperature.minimumSpeedFactor).toBe(temperature.motionSpeedFactor.atMinimum);
    expect(capabilities.temperature.maximumSpeedFactor).toBe(temperature.motionSpeedFactor.atMaximum);
    expect(capabilities.temperature.referenceTemperature_C).toBe(temperature.motionSpeedFactor.referenceTemperature_C);
    expect(capabilities.temperature.messageKey).toBe(temperature.messageKey);
    for (const claim of ['affectsExtent', 'affectsRateConstant', 'affectsPH']) {
      expect(capabilities.temperature[claim], claim).toBe(false);
      expect(temperature[claim], claim).toBe(false);
    }

    expect(capabilities.pressure.atm).toBe(pressure.fixed_atm);
    expect(capabilities.pressure.effect).toBe(pressure.effect);
    expect(capabilities.pressure.messageKey).toBe(pressure.messageKey);
    expect(bounds.pressure_atm.minimum).toBe(pressure.fixed_atm);
    expect(bounds.pressure_atm.maximum).toBe(pressure.fixed_atm);

    // The stated motion factors bracket the declared temperature range.
    const temperatures = capabilities.temperature.speedFactors.map((entry) => entry.temperature_C);
    expect(Math.min(...temperatures)).toBe(bounds.temperature_C.minimum);
    expect(Math.max(...temperatures)).toBe(bounds.temperature_C.maximum);
    expect(temperatures).toContain(bounds.temperature_C.default);
  });

  /** Validates: Requirements 5.1 */
  describe('concentration and volume', () => {
    it('exercises every declared concentration and volume bound', () => {
      const exercised = new Set(capabilities.quantityBoundaries.flatMap((testCase) => testCase.boundsExercised));
      expect([...exercised].sort()).toEqual([
        'concentration_molL.maximum',
        'concentration_molL.minimum',
        'volume_mL.maximum',
        'volume_mL.minimum',
      ]);

      const bounds = catalog.model.bounds;
      for (const testCase of capabilities.quantityBoundaries) {
        for (const solution of testCase.solutions) {
          const label = `${testCase.id} ${solution.reagentId}`;
          expect(solution.concentration_molL, label).toBeGreaterThanOrEqual(bounds.concentration_molL.minimum);
          expect(solution.concentration_molL, label).toBeLessThanOrEqual(bounds.concentration_molL.maximum);
          expect(solution.volume_mL, label).toBeGreaterThanOrEqual(bounds.volume_mL.minimum);
          expect(solution.volume_mL, label).toBeLessThanOrEqual(bounds.volume_mL.maximum);
          // The hand-stated amount is the chemistry, not a restatement of the
          // implementation's own arithmetic.
          expect(solution.amount_mol, label).toBeCloseTo(
            (solution.concentration_molL * solution.volume_mL) / MILLILITRES_PER_LITRE,
            AMOUNT_PRECISION,
          );
        }
      }
    });

    it('applies both quantities to amounts, volume, extent, limiting, excess, and products', () => {
      for (const testCase of capabilities.quantityBoundaries) {
        const result = evaluateCase(testCase);
        const label = testCase.id;

        expect(result.pairKey, label).toBe(testCase.pairKey);
        expect(result.totalVolume_L, label).toBeCloseTo(testCase.totalVolume_L, AMOUNT_PRECISION);
        expect(result.extent_mol, label).toBeCloseTo(testCase.extent_mol, AMOUNT_PRECISION);
        expect([...result.limitingSpecies].sort(), label).toEqual([...testCase.limitingSpecies].sort());

        for (const solution of testCase.solutions) {
          const reactant = reactantOf(result, solution.reagentId);
          const entry = `${label} ${solution.reagentId}`;
          expect(reactant.amount_mol, entry).toBeCloseTo(solution.amount_mol, AMOUNT_PRECISION);
          expect(reactant.amount_mol, entry).toBe(calculateAmount(solution.concentration_molL, solution.volume_mL));
          expect(reactant.consumed_mol, entry).toBeCloseTo(result.extent_mol * reactant.coefficient, AMOUNT_PRECISION);
        }

        expect(result.excessSpecies.map((excess) => excess.speciesId).sort(), label).toEqual(
          testCase.excessSpecies.map((excess) => excess.speciesId).sort(),
        );
        for (const excess of testCase.excessSpecies) {
          expect(amountOf(result.excessSpecies, excess.speciesId), `${label} ${excess.speciesId}`).toBeCloseTo(
            excess.amount_mol,
            AMOUNT_PRECISION,
          );
        }
        for (const product of testCase.products) {
          expect(amountOf(result.products, product.speciesId), `${label} ${product.speciesId}`).toBeCloseTo(
            product.amount_mol,
            AMOUNT_PRECISION,
          );
        }
      }
    });

    it('moves the limiting reactant when the two solutions swap bounds', () => {
      const [, , maximumAgainstMinimum, minimumAgainstMaximum] = capabilities.quantityBoundaries;
      const chlorideLimited = evaluateCase(maximumAgainstMinimum);
      const silverLimited = evaluateCase(minimumAgainstMaximum);

      // Identical reagents and an identical total volume: only the
      // concentration/volume assignment differs, and it decides the chemistry.
      expect(chlorideLimited.pairKey).toBe(silverLimited.pairKey);
      expect(chlorideLimited.totalVolume_L).toBeCloseTo(silverLimited.totalVolume_L, AMOUNT_PRECISION);
      expect(chlorideLimited.limitingSpecies).toEqual(['NaCl']);
      expect(silverLimited.limitingSpecies).toEqual(['AgNO3']);
      expect(chlorideLimited.excessSpecies[0].speciesId).toBe('AgNO3');
      expect(silverLimited.excessSpecies[0].speciesId).toBe('NaCl');
    });

    it('scales every derived amount with concentration and with volume', () => {
      const base = { concentration_molL: 0.5, volume_mL: 40 };
      const reference = evaluator.evaluateExperiment(buildInput('AgNO3', base, 'NaCl', base));

      const doubledConcentration = { concentration_molL: 1, volume_mL: 40 };
      const concentrated = evaluator.evaluateExperiment(
        buildInput('AgNO3', doubledConcentration, 'NaCl', doubledConcentration),
      );
      expect(concentrated.extent_mol).toBeCloseTo(reference.extent_mol * 2, AMOUNT_PRECISION);
      expect(amountOf(concentrated.products, 'AgCl')).toBeCloseTo(
        amountOf(reference.products, 'AgCl') * 2,
        AMOUNT_PRECISION,
      );
      // Concentration changes the amount without changing the mixed volume.
      expect(concentrated.totalVolume_L).toBe(reference.totalVolume_L);

      const doubledVolume = { concentration_molL: 0.5, volume_mL: 80 };
      const diluted = evaluator.evaluateExperiment(buildInput('AgNO3', doubledVolume, 'NaCl', doubledVolume));
      expect(diluted.extent_mol).toBeCloseTo(reference.extent_mol * 2, AMOUNT_PRECISION);
      expect(diluted.totalVolume_L).toBeCloseTo(reference.totalVolume_L * 2, AMOUNT_PRECISION);
    });
  });

  /** Validates: Requirements 5.2 */
  describe('temperature as bounded qualitative motion only', () => {
    it('maps every declared temperature to its stated bounded motion factor', () => {
      const declared = capabilities.temperature;
      for (const { temperature_C, speedFactor } of declared.speedFactors) {
        expect(evaluator.motionSpeedFactor(temperature_C), String(temperature_C)).toBeCloseTo(
          speedFactor,
          AMOUNT_PRECISION,
        );
        expect(evaluator.describeMotion(temperature_C).speedFactor, String(temperature_C)).toBeCloseTo(
          speedFactor,
          AMOUNT_PRECISION,
        );
      }

      const factors = declared.speedFactors.map((entry) => evaluator.motionSpeedFactor(entry.temperature_C));
      for (const [index, factor] of factors.slice(1).entries()) {
        expect(factor, `rising at index ${index + 1}`).toBeGreaterThan(factors[index]);
      }

      // The band is closed by rejection, not by clamping: a temperature
      // outside the control range yields no factor at all, so a selection can
      // never land on a boundary factor it did not ask for. Task 5.2 made this
      // a rejection; before it, both calls returned the clamped edge value.
      expect(declared.outOfRangeIsRejectedNotClamped).toBe(true);
      expect(() => evaluator.motionSpeedFactor(-40)).toThrow(InvalidExperimentQuantityError);
      expect(() => evaluator.motionSpeedFactor(500)).toThrow(InvalidExperimentQuantityError);
      expect(evaluator.describeMotion(25).referenceSpeedFactor).toBeCloseTo(
        declared.referenceSpeedFactor,
        AMOUNT_PRECISION,
      );

      // Both declared edges are still exactly the declared factors, so closing
      // the band by rejection did not move the band itself.
      expect(evaluator.motionSpeedFactor(catalog.model.bounds.temperature_C.minimum)).toBe(declared.minimumSpeedFactor);
      expect(evaluator.motionSpeedFactor(catalog.model.bounds.temperature_C.maximum)).toBe(declared.maximumSpeedFactor);
    });

    it('changes nothing in a result except its motion metadata', () => {
      const vector = capabilities.temperature.invarianceVector;
      const results = vector.temperatures_C.map((temperature_C) => evaluateCase(vector, { temperature_C }));

      for (const [index, result] of results.entries()) {
        const label = `${vector.temperatures_C[index]} C`;

        // Every quantity matches the one hand-stated outcome, at every
        // temperature, with no drift in extent, limiting reactant, or excess.
        expect(result.extent_mol, label).toBeCloseTo(vector.extent_mol, AMOUNT_PRECISION);
        expect(result.limitingSpecies, label).toEqual(vector.limitingSpecies);
        expect(result.totalVolume_L, label).toBeCloseTo(vector.totalVolume_L, AMOUNT_PRECISION);
        expect(amountOf(result.excessSpecies, 'HCl'), label).toBeCloseTo(
          vector.excessSpecies[0].amount_mol,
          AMOUNT_PRECISION,
        );

        expect(withoutMotion(result), label).toEqual(withoutMotion(results[0]));
        expect(result.motion.temperature_C, label).toBe(vector.temperatures_C[index]);
      }

      expect(vector.invariantExceptField).toBe('motion');
      // The motion blocks really do differ, so the equality above is a claim
      // about the rest of the result rather than about identical inputs.
      expect(new Set(results.map((result) => result.motion.speedFactor)).size).toBe(results.length);
    });

    it('marks the motion factor as non-quantitative with its localized boundary statement', () => {
      const declared = capabilities.temperature;
      const result = evaluateCase(capabilities.temperature.invarianceVector, { temperature_C: 100 });

      expect(result.motion.quantitative).toBe(false);
      expect(result.motion.effect).toBe(declared.effect);
      expect(result.motion.model).toBe(declared.model);
      expect(result.motion.affectsExtent).toBe(false);
      expect(result.motion.affectsRateConstant).toBe(false);
      expect(result.motion.affectsPH).toBe(false);
      expect(result.motion.messageKey).toBe(declared.messageKey);
      expect(result.motion.message).toBe(formatters.resolveMessage(declared.messageKey));
      expect(result.motion.message).toBe(formatters.describeCapabilityBoundary('temperature').message);
      expect(Object.isFrozen(result.motion)).toBe(true);
    });

    it('defaults an unsupplied temperature and rejects one with no defined position', () => {
      const vector = capabilities.temperature.invarianceVector;
      const [first, second] = vector.solutions;
      const input = buildInput(first.reagentId, first, second.reagentId, second);
      delete input.temperature_C;

      const defaulted = evaluator.evaluateExperiment(input);
      expect(defaulted.motion.temperature_C).toBe(catalog.model.bounds.temperature_C.default);
      expect(defaulted).toEqual(evaluateCase(vector, { temperature_C: catalog.model.bounds.temperature_C.default }));

      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '25']) {
        const invalid = buildInput(first.reagentId, first, second.reagentId, second);
        invalid.temperature_C = value;
        expect(() => evaluator.evaluateExperiment(invalid), String(value)).toThrow(InvalidExperimentQuantityError);
      }

      // Zero degrees is a valid selection, not a missing quantity.
      expect(evaluateCase(vector, { temperature_C: 0 }).motion.speedFactor).toBe(
        capabilities.temperature.minimumSpeedFactor,
      );
    });

    it('reads the catalog rather than a hardcoded motion band', () => {
      const widened = structuredClone(catalog);
      widened.model.capabilities.temperature.motionSpeedFactor.atMaximum = 7;
      expect(createChemistryEvaluator(widened).motionSpeedFactor(100)).toBe(7);
      expect(evaluator.motionSpeedFactor(100)).toBe(capabilities.temperature.maximumSpeedFactor);
    });

    it('refuses a catalog that claims a quantitative temperature effect', () => {
      for (const [claim, pattern] of [
        ['affectsExtent', /affectsExtent false/u],
        ['affectsRateConstant', /affectsRateConstant false/u],
        ['affectsPH', /affectsPH false/u],
      ]) {
        const mutated = structuredClone(catalog);
        mutated.model.capabilities.temperature[claim] = true;
        expect(() => createChemistryEvaluator(mutated), claim).toThrow(pattern);
      }

      const rebranded = structuredClone(catalog);
      rebranded.model.capabilities.temperature.effect = 'arrhenius_rate';
      expect(() => createChemistryEvaluator(rebranded)).toThrow(/qualitative_motion_only/u);

      const unknownModel = structuredClone(catalog);
      unknownModel.model.capabilities.temperature.motionSpeedFactor.model = 'exponential';
      expect(() => createChemistryEvaluator(unknownModel)).toThrow(/unsupported motion speed model/u);
    });
  });

  /** Validates: Requirements 5.3 */
  describe('pressure fixed at one atmosphere', () => {
    it('reports the catalog fixed state with its localized boundary statement', () => {
      const declared = capabilities.pressure;
      const result = evaluateCase(capabilities.quantityBoundaries[0]);

      expect(result.pressure.atm).toBe(declared.atm);
      expect(result.pressure.effect).toBe(declared.effect);
      expect(result.pressure.selectable).toBe(false);
      expect(result.pressure.acceptsAlternateValues).toBe(false);
      expect(result.pressure.affectsResult).toBe(false);
      expect(result.pressure.messageKey).toBe(declared.messageKey);
      expect(result.pressure.message).toBe(formatters.resolveMessage(declared.messageKey));
      expect(result.pressure.message).toBe(formatters.describeCapabilityBoundary('pressure').message);
      expect(Object.isFrozen(result.pressure)).toBe(true);
    });

    it('derives no reported value from the supplied pressure field', () => {
      expect(capabilities.pressure.omittedFieldIsEquivalent).toBe(true);

      for (const testCase of capabilities.quantityBoundaries) {
        // Omitting the control, or supplying the one fixed value, cannot change
        // a single reported value, which is what "no modeled effect" has to
        // mean. Task 5.2 rejects any other value outright, so this is the whole
        // space of accepted pressures rather than a silently ignored field.
        expect(evaluateCase(testCase, { omitPressure: true }), testCase.id).toEqual(evaluateCase(testCase));
      }

      expect(capabilities.pressure.alternateValueIsRejectedNotIgnored).toBe(true);
    });

    it('refuses a catalog that makes pressure selectable or effective', () => {
      const selectable = structuredClone(catalog);
      selectable.model.capabilities.pressure.selectable = true;
      expect(() => createChemistryEvaluator(selectable)).toThrow(/neither selectable nor accept alternate values/u);

      const alternates = structuredClone(catalog);
      alternates.model.capabilities.pressure.acceptsAlternateValues = true;
      expect(() => createChemistryEvaluator(alternates)).toThrow(/neither selectable nor accept alternate values/u);

      const effective = structuredClone(catalog);
      effective.model.capabilities.pressure.effect = 'ideal_gas';
      expect(() => createChemistryEvaluator(effective)).toThrow(/effect none/u);

      const unfixed = structuredClone(catalog);
      unfixed.model.bounds.pressure_atm.maximum = 2;
      expect(() => createChemistryEvaluator(unfixed)).toThrow(/fixed at 1 atm/u);
    });
  });

  /**
   * Out-of-range input is rejected, never clamped and never ignored.
   *
   * Clamping is the failure mode this guards against: `2.5 M` quietly becoming
   * `2 M` evaluates a different experiment than the learner set up and reports
   * it as though it were theirs, and the audited engine's ignored pressure
   * control did the mirror-image thing by presenting an input with no effect.
   * So a value just outside a bound must produce no result at all, while a
   * value exactly at a bound must stay a valid experiment, and every rejection
   * must name its field with a stable reason code and Indonesian text.
   *
   * Validates: Requirements 5.4
   */
  describe('validated input semantics', () => {
    /** Values that name no position on a control, by fixture token. */
    const UNDEFINED_VALUES = Object.freeze({
      nan: Number.NaN,
      positive_infinity: Number.POSITIVE_INFINITY,
      negative_infinity: Number.NEGATIVE_INFINITY,
      zero: 0,
      negative: -1,
      text: '1',
      boolean: true,
      missing: undefined,
    });

    /** Which solution and quantity each A/B field sets. */
    const SOLUTION_FIELDS = Object.freeze({
      concentrationA_molL: { index: 0, property: 'concentration_molL' },
      volumeA_mL: { index: 0, property: 'volume_mL' },
      concentrationB_molL: { index: 1, property: 'concentration_molL' },
      volumeB_mL: { index: 1, property: 'volume_mL' },
    });

    let validation;

    beforeAll(() => {
      validation = capabilities.inputValidation;
    });

    /** The valid baseline experiment with zero or more fields overridden. */
    function baselineInput(overrides = {}) {
      const [first, second] = validation.baseline.solutions;
      const input = buildInput(first.reagentId, first, second.reagentId, second);
      input.temperature_C = validation.baseline.temperature_C;
      input.pressure_atm = validation.baseline.pressure_atm;
      return Object.assign(input, overrides);
    }

    /** The single violation one overridden field produces. */
    function violationFor(field, value) {
      try {
        evaluator.evaluateExperiment(baselineInput({ [field]: value }));
      } catch (error) {
        expect(error, `${field}=${String(value)}`).toBeInstanceOf(InvalidExperimentQuantityError);
        expect(error.violations, `${field}=${String(value)}`).toHaveLength(1);
        return error.violations[0];
      }
      throw new Error(`${field}=${String(value)} was accepted but should have been rejected`);
    }

    /** A fixture value that triggers one reason code on one field. */
    function triggerFor(field, reasonCode) {
      const outside = validation.rejectedJustOutsideBounds.find(
        (testCase) => testCase.field === field && testCase.reasonCode === reasonCode,
      );
      if (outside) return outside.value;
      const undefinedCase = validation.rejectedUndefinedValues.find(
        (testCase) => testCase.field === field && testCase.reasonCode === reasonCode,
      );
      if (!undefinedCase) throw new Error(`no fixture case triggers ${reasonCode} on ${field}`);
      return UNDEFINED_VALUES[undefinedCase.valueToken];
    }

    it('is pinned to the declared reason codes, fields, and catalog bounds', () => {
      expect([...EXPERIMENT_INPUT_REASON_CODES]).toEqual(validation.reasonCodes);
      expect(VALIDATED_EXPERIMENT_FIELDS.map((descriptor) => ({ ...descriptor }))).toEqual(validation.fields);

      // Validation reads the catalog's declared bounds, so a regenerated
      // catalog that widens the control range widens validation with it rather
      // than being contradicted by a number written into the evaluator.
      for (const descriptor of VALIDATED_EXPERIMENT_FIELDS) {
        expect(evaluator.bounds[descriptor.field], descriptor.field).toBe(catalog.model.bounds[descriptor.bound]);
      }
    });

    it('accepts every value exactly at a declared bound and reports it unchanged', () => {
      for (const testCase of validation.acceptedAtBounds) {
        const label = `${testCase.field}=${testCase.value}`;
        const [boundName, edge] = testCase.bound.split('.');
        expect(catalog.model.bounds[boundName][edge], label).toBe(testCase.value);

        const result = evaluator.evaluateExperiment(baselineInput({ [testCase.field]: testCase.value }));
        const target = SOLUTION_FIELDS[testCase.field];
        if (target) {
          const reagentId = validation.baseline.solutions[target.index].reagentId;
          expect(reactantOf(result, reagentId)[target.property], label).toBe(testCase.value);
        } else if (testCase.field === 'temperature_C') {
          expect(result.motion.temperature_C, label).toBe(testCase.value);
        } else {
          expect(result.pressure.atm, label).toBe(testCase.value);
        }
      }
    });

    it('rejects every value just outside a declared bound with its field and reason code', () => {
      for (const testCase of validation.rejectedJustOutsideBounds) {
        const violation = violationFor(testCase.field, testCase.value);
        const label = `${testCase.field}=${testCase.value}`;

        expect(violation.field, label).toBe(testCase.field);
        expect(violation.reasonCode, label).toBe(testCase.reasonCode);
        expect(violation.limit, label).toBe(testCase.limit);
        expect(violation.value, label).toBe(testCase.value);
      }
    });

    it('rejects every value that names no position on its control', () => {
      for (const testCase of validation.rejectedUndefinedValues) {
        const value = UNDEFINED_VALUES[testCase.valueToken];
        const violation = violationFor(testCase.field, value);
        const label = `${testCase.field}=${testCase.valueToken}`;

        expect(violation.field, label).toBe(testCase.field);
        expect(violation.reasonCode, label).toBe(testCase.reasonCode);
        expect(violation.limit, label).toBeNull();
      }
    });

    it('never clamps: an out-of-range value produces no result at all', () => {
      for (const testCase of validation.rejectedJustOutsideBounds) {
        const label = `${testCase.field}=${testCase.value}`;

        // The clamped experiment is itself perfectly evaluable, which is
        // exactly why substituting it would be invisible to a learner.
        const clamped = evaluator.evaluateExperiment(baselineInput({ [testCase.field]: testCase.limit }));
        expect(clamped.pairKey, label).toBe(validation.baseline.pairKey);

        let produced = null;
        try {
          produced = evaluator.evaluateExperiment(baselineInput({ [testCase.field]: testCase.value }));
        } catch (error) {
          expect(error, label).toBeInstanceOf(InvalidExperimentQuantityError);
        }
        expect(produced, label).toBeNull();
      }
    });

    it('explains every rejection in Indonesian without leaking the rejected value', () => {
      for (const testCase of validation.localizedMessages) {
        const value = triggerFor(testCase.field, testCase.reasonCode);
        const violation = violationFor(testCase.field, value);
        const label = `${testCase.field} ${testCase.reasonCode}`;

        expect(violation.reasonCode, label).toBe(testCase.reasonCode);
        expect(violation.message, label).toBe(testCase.message);

        // Learner-facing text names the control, not the internal field, and
        // never echoes what was typed back as part of the explanation.
        expect(violation.message, label).not.toContain(testCase.field);
        expect(violation.message, label).not.toContain(String(value));
      }
    });

    it('reports every offending field in one pass rather than one at a time', () => {
      const declared = validation.multiFieldRejection;
      const overrides = Object.fromEntries(
        declared.overrides.map((override) => [override.field, override.value]),
      );

      let error = null;
      try {
        evaluator.evaluateExperiment(baselineInput(overrides));
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InvalidExperimentQuantityError);
      expect(error.fields).toEqual(declared.expected.map((item) => item.field));
      expect(error.reasonCodes).toEqual(declared.expected.map((item) => item.reasonCode));
      expect(error.localizedMessages).toHaveLength(declared.expected.length);

      // Field order follows the declared field order, so two halves of the pair
      // and two consumers of the same error read the list the same way.
      expect(error.fields).toEqual(
        VALIDATED_EXPERIMENT_FIELDS.map((descriptor) => descriptor.field).filter((field) =>
          error.fields.includes(field),
        ),
      );
      expect(error.localizedMessage).toBe(error.localizedMessages.join(' '));
      expect(error.field).toBe(error.fields[0]);
    });

    it('enforces declared range without enforcing declared step size', () => {
      // The step describes how a slider moves, not what chemistry is defined,
      // so an exactly calculated off-step quantity must stay valid.
      for (const testCase of validation.offStepValuesStayValid) {
        const bounds = evaluator.bounds[testCase.field];
        const label = `${testCase.field}=${testCase.value}`;
        expect(testCase.value % bounds.step, label).not.toBe(0);

        const accepted = evaluator.validateExperimentInput(baselineInput({ [testCase.field]: testCase.value }));
        expect(accepted[testCase.field], label).toBe(testCase.value);
      }
    });

    it('defaults only the two controls the catalog declares a default position for', () => {
      const supplied = evaluator.validateExperimentInput(baselineInput());
      const omitted = evaluator.validateExperimentInput(
        baselineInput({ temperature_C: undefined, pressure_atm: undefined }),
      );

      expect(omitted).toEqual(supplied);
      expect(omitted.temperature_C).toBe(catalog.model.bounds.temperature_C.default);
      expect(omitted.pressure_atm).toBe(catalog.model.bounds.pressure_atm.default);
    });

    it('refuses a catalog whose declared bounds cannot judge an input', () => {
      const inverted = structuredClone(catalog);
      inverted.model.bounds.concentration_molL.maximum = 0.05;
      expect(() => createChemistryEvaluator(inverted)).toThrow(/maximum at or above its minimum/u);

      const unbounded = structuredClone(catalog);
      delete unbounded.model.bounds.volume_mL;
      expect(() => createChemistryEvaluator(unbounded)).toThrow(/no model\.bounds\.volume_mL/u);

      const misplacedDefault = structuredClone(catalog);
      misplacedDefault.model.bounds.volume_mL.default = 5;
      expect(() => createChemistryEvaluator(misplacedDefault)).toThrow(/default inside its own range/u);
    });

    it('widens with the catalog rather than against it', () => {
      const widened = structuredClone(catalog);
      widened.model.bounds.concentration_molL.maximum = 4;
      const permissive = createChemistryEvaluator(widened);

      const input = baselineInput({ concentrationA_molL: 3 });
      expect(permissive.evaluateExperiment(input).reactants[0].concentration_molL).toBe(3);
      expect(() => evaluator.evaluateExperiment(input)).toThrow(InvalidExperimentQuantityError);
    });
  });

  it('fabricates no pH value at any control position', () => {
    const positions = [
      ...capabilities.quantityBoundaries.map((testCase) => evaluateCase(testCase)),
      ...capabilities.temperature.speedFactors.map((entry) =>
        evaluateCase(capabilities.temperature.invarianceVector, { temperature_C: entry.temperature_C }),
      ),
    ];

    for (const result of positions) {
      expect(result.speciesLedger, result.pairKey).toBeNull();

      // The one supported acid-base system reports a calculated pH; every
      // other pair still reports none at all. Neither case may carry the
      // audited engine's seeded "~7.0", which it produced before looking at
      // any quantity.
      if (result.pairKey === phModel.supportedPairKey) {
        expect(result.pH.supported, result.pairKey).toBe(true);
        expect(Number.isFinite(result.pH.value), result.pairKey).toBe(true);
      } else {
        expect(result.pH, result.pairKey).toBeNull();
      }
      expect(JSON.stringify(result), result.pairKey).not.toMatch(/~\s*7/u);
    }
  });
});

/**
 * The ideal strong-acid/strong-base pH model.
 *
 * Audited defect 1.1 is the reason this suite exists: the engine seeded every
 * result with a value near 7 and then reported exactly neutral for every
 * HCl/NaOH mixture, without reading concentration, volume, the limiting
 * reagent, or the excess at all. So these tests check the arithmetic itself
 * rather than only the shape of the answer:
 *
 * - the three formulas, recomputed here from the fixture's hand-stated
 *   amounts instead of from anything the evaluator produced,
 * - the neutral point, which must be both `pKw/2` and the catalog's declared
 *   `neutralPH`, reached through the declared equivalence tolerance rather
 *   than through exact float equality,
 * - monotonicity, because "more acid" has to mean "lower pH" and not merely
 *   "some other number",
 * - the side of neutral, over the whole on-step control grid,
 * - and that the pH is built from unrounded amounts, from the declared pKw
 *   rather than a literal 14, and from nothing temperature does.
 *
 * Validates: Requirements 3.3, 3.4, 3.5, 3.7
 */
describe('ideal strong acid/base pH model', () => {
  let catalog;
  let evaluator;
  let formatters;
  let fixture;
  let phModel;

  beforeAll(async () => {
    catalog = await loadCatalog();
    evaluator = createChemistryEvaluator(catalog);
    formatters = createChemistryFormatters(catalog);
    fixture = await loadExperimentVectorFixture();
    phModel = fixture.pHModel;
  });

  /** Evaluates one fixture case, optionally at an explicit temperature. */
  function evaluatePHCase(testCase, { temperature_C = 25, reversed = false } = {}) {
    const [first, second] = reversed ? [...testCase.solutions].reverse() : testCase.solutions;
    const input = buildInput(first.reagentId, first, second.reagentId, second);
    input.temperature_C = temperature_C;
    return evaluator.evaluateExperiment(input);
  }

  /** Evaluates one acid/base mixture straight from quantities. */
  function evaluateMixture(acid, base) {
    return evaluator.evaluateExperiment(
      buildInput(phModel.acidReagentId, acid, phModel.baseReagentId, base),
    );
  }

  it('is pinned to the pH capability the catalog declares', () => {
    const declared = catalog.model.capabilities.pH;

    expect(phModel.modelId).toBe(declared.modelId);
    expect(phModel.modelLabel).toBe(declared.modelLabel);
    expect(phModel.pKw).toBe(declared.pKw);
    expect(phModel.pKwSource).toBe(declared.pKwSource);
    expect(phModel.temperatureCorrected).toBe(declared.temperatureCorrected);
    expect(phModel.neutralPH).toBe(declared.neutralPH);
    expect(phModel.displayPrecision).toBe(declared.displayPrecision);
    expect(phModel.supportedReactionIds ?? [phModel.supportedReactionId]).toEqual(
      declared.supportedReactionIds,
    );
    expect(phModel.equivalenceTolerance_mol).toBe(catalog.model.tolerances.equivalence_mol);
    expect(phModel.pHTolerance).toBe(catalog.model.tolerances.pH);

    expect(evaluator.pHModel).toEqual({
      modelId: declared.modelId,
      modelLabel: declared.modelLabel,
      pKw: declared.pKw,
      pKwSource: declared.pKwSource,
      temperatureCorrected: false,
      neutralPH: declared.neutralPH,
      supportedReactionIds: declared.supportedReactionIds,
    });
    expect(evaluator.equivalenceTolerance).toBe(catalog.model.tolerances.equivalence_mol);
    expect(evaluator.pHTolerance).toBe(catalog.model.tolerances.pH);
  });

  it('calculates every stated case from the excess amount and the total mixed volume', () => {
    for (const testCase of phModel.cases) {
      const result = evaluatePHCase(testCase);
      const label = testCase.id;
      const pH = result.pH;

      // The amounts the formula runs on, stated by hand rather than read back.
      expect(pH.acidEquivalents_mol, label).toBeCloseTo(testCase.acidEquivalents_mol, AMOUNT_PRECISION);
      expect(pH.baseEquivalents_mol, label).toBeCloseTo(testCase.baseEquivalents_mol, AMOUNT_PRECISION);
      expect(pH.equivalenceDifference_mol, label).toBeCloseTo(
        testCase.equivalenceDifference_mol,
        AMOUNT_PRECISION,
      );
      expect(pH.totalVolume_L, label).toBeCloseTo(testCase.totalVolume_L, AMOUNT_PRECISION);
      expect(pH.totalVolume_L, label).toBe(result.totalVolume_L);

      expect(pH.equivalence, label).toBe(testCase.equivalence);
      expect(pH.side, label).toBe(testCase.side);
      expect(pH.excessIonId, label).toBe(testCase.excessIonId);
      expect(pH.excessAmount_mol, label).toBeCloseTo(testCase.excessAmount_mol, AMOUNT_PRECISION);
      expect(pH.excessConcentration_molL, label).toBeCloseTo(
        testCase.excessConcentration_molL,
        PH_PRECISION,
      );
      expect(pH.value, label).toBeCloseTo(testCase.pH, PH_PRECISION);

      // The three formulas, recomputed here from the fixture's own numbers.
      if (testCase.equivalence) {
        expect(pH.value, label).toBe(phModel.pKw / 2);
      } else if (testCase.side === 'acidic') {
        expect(pH.value, label).toBeCloseTo(
          -Math.log10(testCase.excessAmount_mol / testCase.totalVolume_L),
          PH_PRECISION,
        );
      } else {
        const pOH = -Math.log10(testCase.excessAmount_mol / testCase.totalVolume_L);
        expect(pOH, label).toBeCloseTo(testCase.pOH, PH_PRECISION);
        expect(pH.value, label).toBeCloseTo(phModel.pKw - pOH, PH_PRECISION);
      }

      // The excess the pH model used is the same excess the stoichiometry
      // reported, so the two halves of the result cannot disagree.
      if (testCase.excessIonId === null) {
        expect(result.excessSpecies, label).toEqual([]);
      } else {
        expect(result.excessSpecies.map((excess) => excess.speciesId), label).toEqual([
          testCase.side === 'acidic' ? phModel.acidReagentId : phModel.baseReagentId,
        ]);
        expect(result.excessSpecies[0].amount_mol, label).toBeCloseTo(
          testCase.excessAmount_mol,
          AMOUNT_PRECISION,
        );
      }

      // Display precision is the formatter's alone, and the domain value keeps
      // every digit the formula produced.
      expect(formatters.formatQuantity('pH', pH.value), label).toBe(testCase.display);
      expect(formatters.formatExperimentQuantities(result).pH, label).toBe(testCase.display);
      expect(pH.supported, label).toBe(true);
      expect(pH.reasonCode, label).toBeNull();
      expect(pH.message, label).toBeNull();
      expect(Object.isFrozen(pH), label).toBe(true);
    }
  });

  it('reports the neutral point as both pKw/2 and the declared neutral pH', () => {
    const exact = phModel.cases.find((testCase) => testCase.id === 'ph-equivalence-exact');
    const result = evaluatePHCase(exact);

    expect(result.pH.value).toBe(phModel.pKw / 2);
    expect(result.pH.value).toBe(phModel.neutralPH);
    expect(result.pH.neutralPH).toBe(phModel.neutralPH);
    expect(Math.abs(result.pH.value - phModel.neutralPH)).toBeLessThanOrEqual(phModel.pHTolerance);
    expect(formatters.formatQuantity('pH', result.pH.value)).toBe(phModel.neutralDisplay);

    // Equivalence is the limiting case of both excess branches, so neither
    // reagent is left over and the reaction consumed both completely.
    expect(result.limitingSpecies).toEqual([phModel.acidReagentId, phModel.baseReagentId].sort());
    expect(result.excessSpecies).toEqual([]);
  });

  it('decides equivalence with the declared tolerance instead of exact equality', () => {
    const near = phModel.cases.find((testCase) => testCase.id === 'ph-equivalence-within-tolerance');
    const result = evaluatePHCase(near);

    // The two equivalents are genuinely unequal as doubles, and still inside
    // the declared tolerance, which is the whole point of comparing widths.
    expect(result.pH.equivalenceDifference_mol).not.toBe(0);
    expect(Math.abs(result.pH.equivalenceDifference_mol)).toBeGreaterThan(0);
    expect(Math.abs(result.pH.equivalenceDifference_mol)).toBeLessThanOrEqual(
      phModel.equivalenceTolerance_mol,
    );
    expect(result.pH.equivalence).toBe(true);
    expect(result.pH.side).toBe('neutral');
    expect(result.pH.value).toBe(phModel.neutralPH);

    // Without the tolerance the same difference would be divided by the mixed
    // volume and reported as a basic pH for an acid-side difference, which is
    // the nonsense the tolerance exists to prevent.
    expect(near.toleranceIgnoredLandsOnWrongSide).toBe(true);
    const ignored = -Math.log10(result.pH.equivalenceDifference_mol / result.totalVolume_L);
    expect(ignored).toBeCloseTo(near.pHIfToleranceIgnored, 6);
    expect(ignored).toBeGreaterThan(phModel.neutralPH);
  });

  it('lowers the pH strictly for more acid and raises it strictly for more base', () => {
    for (const series of phModel.monotonicity.series) {
      const values = series.varied.volumes_mL.map((volume_mL) => {
        const varied = { concentration_molL: series.varied.concentration_molL, volume_mL };
        const result =
          series.varied.reagentId === phModel.acidReagentId
            ? evaluateMixture(varied, series.fixed)
            : evaluateMixture(series.fixed, varied);
        return result.pH;
      });

      for (const [index, pH] of values.entries()) {
        const label = `${series.id} #${index}`;
        expect(pH.value, label).toBeCloseTo(series.pH[index], PH_PRECISION);
        expect(pH.side, label).toBe(series.sides[index]);
      }

      // Strict, step by step: a flat stretch would mean the control stopped
      // affecting the answer, which is exactly the audited defect.
      for (let index = 1; index < values.length; index += 1) {
        const label = `${series.id} step ${index}`;
        if (series.direction === 'strictly_decreasing') {
          expect(values[index].value, label).toBeLessThan(values[index - 1].value);
        } else {
          expect(values[index].value, label).toBeGreaterThan(values[index - 1].value);
        }
      }
    }
  });

  it('places every on-step control position on the correct side of neutral', () => {
    const grid = phModel.sideOfNeutral;
    let acidic = 0;
    let basic = 0;
    let neutral = 0;

    for (const concentrationAcid of grid.grid.concentrations_molL) {
      for (const volumeAcid of grid.grid.volumes_mL) {
        for (const concentrationBase of grid.grid.concentrations_molL) {
          for (const volumeBase of grid.grid.volumes_mL) {
            const result = evaluateMixture(
              { concentration_molL: concentrationAcid, volume_mL: volumeAcid },
              { concentration_molL: concentrationBase, volume_mL: volumeBase },
            );
            const pH = result.pH;
            const label = `${concentrationAcid}M/${volumeAcid}mL vs ${concentrationBase}M/${volumeBase}mL`;

            expect(pH.side, label).toBe(
              pH.equivalence ? 'neutral' : pH.equivalenceDifference_mol > 0 ? 'acidic' : 'basic',
            );

            if (pH.equivalence) {
              neutral += 1;
              expect(pH.value, label).toBe(phModel.neutralPH);
              expect(pH.excessIonId, label).toBeNull();
              continue;
            }

            // Every on-step excess is far above the neutral concentration the
            // declared pKw implies, so the ideal model has no way to land on
            // or across the neutral point here.
            expect(pH.excessAmount_mol, label).toBeGreaterThanOrEqual(
              grid.smallestNonEquivalentExcess_mol - evaluator.amountTolerance,
            );
            expect(pH.excessConcentration_molL, label).toBeGreaterThan(grid.neutralConcentration_molL);

            if (pH.side === 'acidic') {
              acidic += 1;
              expect(pH.excessIonId, label).toBe(phModel.protonIonId);
              expect(pH.value, label).toBeLessThan(phModel.neutralPH);
              expect(pH.value, label).toBeLessThanOrEqual(grid.acidMaximumPH);
            } else {
              basic += 1;
              expect(pH.excessIonId, label).toBe(phModel.hydroxideIonId);
              expect(pH.value, label).toBeGreaterThan(phModel.neutralPH);
              expect(pH.value, label).toBeGreaterThanOrEqual(grid.baseMinimumPH);
            }
          }
        }
      }
    }

    // All three branches were actually exercised, so the loop above is a claim
    // about behavior rather than about an unreached code path.
    expect(acidic).toBeGreaterThan(0);
    expect(basic).toBeGreaterThan(0);
    expect(neutral).toBeGreaterThan(0);
  });

  it('calculates the pH from unrounded amounts, so a display-rounded input answers differently', () => {
    const proof = phModel.unroundedInputs;
    const [acid, base] = proof.solutions;

    const unrounded = evaluateMixture(acid, base);
    expect(unrounded.pH.side).toBe(proof.unrounded.side);
    expect(unrounded.pH.excessIonId).toBe(proof.unrounded.excessIonId);
    expect(unrounded.pH.value).toBeCloseTo(proof.unrounded.pH, PH_PRECISION);
    expect(formatters.formatQuantity('pH', unrounded.pH.value)).toBe(proof.unrounded.display);

    // Exactly what a precision leak would do: hand the numbers the learner
    // sees back to the chemistry.
    const displayed = {
      concentration_molL: formatters.roundQuantityForDisplay('concentration_molL', acid.concentration_molL),
      volume_mL: formatters.roundQuantityForDisplay('volume_mL', acid.volume_mL),
    };
    expect(displayed).toEqual(proof.displayRoundedAcidInput);

    const leaked = evaluateMixture(displayed, base);
    expect(leaked.pH.value).toBeCloseTo(proof.leaked.pH, PH_PRECISION);
    expect(formatters.formatQuantity('pH', leaked.pH.value)).toBe(proof.leaked.display);

    // The leak is not a last-digit difference: it moves the answer across the
    // neutral point, so a learner would be told the opposite chemistry.
    expect(leaked.pH.side).toBe(proof.leaked.side);
    expect(leaked.pH.excessIonId).toBe(proof.leaked.excessIonId);
    expect(unrounded.pH.side).not.toBe(leaked.pH.side);
    expect(Math.abs(leaked.pH.value - unrounded.pH.value)).toBeGreaterThan(phModel.pHTolerance);
    expect(unrounded.pH.value).toBeLessThan(phModel.neutralPH);
    expect(leaked.pH.value).toBeGreaterThan(phModel.neutralPH);
  });

  it('reports the same pH at every selectable temperature', () => {
    const testCase = phModel.cases.find((entry) => entry.id === 'ph-acid-excess-matching-vector');
    const bounds = catalog.model.bounds.temperature_C;

    const values = [bounds.minimum, bounds.default, 50, bounds.maximum].map(
      (temperature_C) => evaluatePHCase(testCase, { temperature_C }).pH,
    );

    for (const pH of values) {
      expect(pH).toEqual(values[0]);
      expect(pH.temperatureCorrected).toBe(false);
      expect(pH.pKwSource).toBe(catalog.model.capabilities.pH.pKwSource);
    }
    expect(catalog.model.capabilities.temperature.affectsPH).toBe(false);
  });

  it('produces the identical pH block for both A/B orders', () => {
    for (const testCase of phModel.cases) {
      const forward = evaluatePHCase(testCase);
      const reversed = evaluatePHCase(testCase, { reversed: true });
      expect(reversed.pH, testCase.id).toEqual(forward.pH);
    }
  });

  it('reads the declared pKw rather than a literal fourteen', () => {
    const shifted = structuredClone(catalog);
    shifted.model.capabilities.pH.pKw = 15;
    shifted.model.capabilities.pH.neutralPH = 7.5;
    const shiftedEvaluator = createChemistryEvaluator(shifted);

    const neutralCase = phModel.cases.find((entry) => entry.id === 'ph-equivalence-exact');
    const baseCase = phModel.cases.find((entry) => entry.id === 'ph-base-excess-matching-vector');
    const input = (testCase) => {
      const [first, second] = testCase.solutions;
      return buildInput(first.reagentId, first, second.reagentId, second);
    };

    expect(shiftedEvaluator.evaluateExperiment(input(neutralCase)).pH.value).toBe(7.5);
    expect(shiftedEvaluator.evaluateExperiment(input(baseCase)).pH.value).toBeCloseTo(
      baseCase.pH + 1,
      PH_PRECISION,
    );

    // An acid excess depends on no pKw at all, so it is unmoved.
    const acidCase = phModel.cases.find((entry) => entry.id === 'ph-acid-excess-matching-vector');
    expect(shiftedEvaluator.evaluateExperiment(input(acidCase)).pH.value).toBeCloseTo(
      acidCase.pH,
      PH_PRECISION,
    );
  });

  it('refuses a catalog whose declared pH model it does not implement', () => {
    const foreignModel = structuredClone(catalog);
    foreignModel.model.capabilities.pH.modelId = 'debye_huckel_activity_corrected';
    expect(() => createChemistryEvaluator(foreignModel)).toThrow(/unsupported pH model/u);

    const disagreeingNeutral = structuredClone(catalog);
    disagreeingNeutral.model.capabilities.pH.neutralPH = 7.4;
    expect(() => createChemistryEvaluator(disagreeingNeutral)).toThrow(/neutralPH equal to pKw\/2/u);

    const negativePKw = structuredClone(catalog);
    negativePKw.model.capabilities.pH.pKw = -14;
    expect(() => createChemistryEvaluator(negativePKw)).toThrow(/positive pKw/u);

    const corrected = structuredClone(catalog);
    corrected.model.capabilities.pH.temperatureCorrected = true;
    expect(() => createChemistryEvaluator(corrected)).toThrow(/temperatureCorrected false/u);

    const missingTolerance = structuredClone(catalog);
    delete missingTolerance.model.tolerances.equivalence_mol;
    expect(() => createChemistryEvaluator(missingTolerance)).toThrow(/tolerances\.equivalence_mol/u);

    const missingPHTolerance = structuredClone(catalog);
    missingPHTolerance.model.tolerances.pH = 0;
    expect(() => createChemistryEvaluator(missingPHTolerance)).toThrow(/tolerances\.pH/u);
  });

  it('refuses to apply the monoprotic formulas to chemistry they do not cover', () => {
    const acidCase = phModel.cases.find((entry) => entry.id === 'ph-acid-excess-matching-vector');
    const [first, second] = acidCase.solutions;
    const input = buildInput(first.reagentId, first, second.reagentId, second);

    const polyprotic = structuredClone(catalog);
    const protonTerm = polyprotic.reagents[phModel.acidReagentId].ions.find(
      (term) => term.ionId === phModel.protonIonId,
    );
    protonTerm.multiplicity = 2;
    expect(() => createChemistryEvaluator(polyprotic).evaluateExperiment(input)).toThrow(/monoprotic/u);

    const unlisted = structuredClone(catalog);
    unlisted.model.capabilities.pH.supportedReactionIds = [];
    expect(() => createChemistryEvaluator(unlisted).evaluateExperiment(input)).toThrow(
      /does not list as supported/u,
    );
  });

  it('reports no pH for any system outside the supported model', () => {
    const quantities = { concentration_molL: 1, volume_mL: 50 };

    for (const reactionId of phModel.unsupportedUntilTask54.reactionIds) {
      const reaction = Object.values(catalog.reactions).find((candidate) => candidate.id === reactionId);
      expect(reaction.pH, reactionId).toBeNull();

      const [reagentA, reagentB] = reaction.reactantSet;
      const result = evaluator.evaluateExperiment(buildInput(reagentA, quantities, reagentB, quantities));
      expect(result.pH, reactionId).toBe(phModel.unsupportedUntilTask54.pH);
      expect(formatters.formatExperimentQuantities(result).pH, reactionId).toBeNull();
    }

    // The audited engine's seeded "~7.0" may not reappear anywhere, for a
    // supported mixture or an unsupported one.
    for (const vector of fixture.vectors) {
      const [first, second] = vector.solutions;
      const result = evaluator.evaluateExperiment(
        buildInput(first.reagentId, first, second.reagentId, second),
      );
      const serialized = JSON.stringify(result);
      for (const forbidden of phModel.forbiddenFabricatedValues) {
        expect(serialized, `${vector.id} ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
