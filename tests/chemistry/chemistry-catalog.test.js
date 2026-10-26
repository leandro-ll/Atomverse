import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CATALOG_PATH,
  REQUIRED_ION_IDS,
  REQUIRED_REACTION_IDS,
  REQUIRED_REAGENT_IDS,
  REQUIRED_REAGENT_PAIRS,
  collectDefinitionViolations,
  findReaction,
  loadCatalog,
  loadSchema,
} from '../helpers/chemistry/catalog-definitions.mjs';

/** Validates: Requirements 1.1, 1.2, 2.3, 4.1, 5.2, 5.3 */
describe('canonical chemistry catalog definitions', () => {
  let catalog;
  let schema;

  beforeAll(async () => {
    catalog = await loadCatalog();
    schema = await loadSchema();
  });

  it('encodes the eight supported reagents with integer dissociation multiplicities', () => {
    expect(Object.keys(catalog.reagents).sort()).toEqual([...REQUIRED_REAGENT_IDS].sort());
    expect(Object.keys(catalog.ions).sort()).toEqual([...REQUIRED_ION_IDS].sort());

    const multiplicityOf = (reagentId, ionId) =>
      catalog.reagents[reagentId].ions.find((term) => term.ionId === ionId)?.multiplicity;

    expect(multiplicityOf('Pb(NO3)2', 'NO3-')).toBe(2);
    expect(multiplicityOf('Pb(NO3)2', 'Pb2+')).toBe(1);
    expect(multiplicityOf('BaCl2', 'Cl-')).toBe(2);
    expect(multiplicityOf('Na2SO4', 'Na+')).toBe(2);
    expect(multiplicityOf('Na2SO4', 'SO4_2-')).toBe(1);
    expect(multiplicityOf('AgNO3', 'NO3-')).toBe(1);

    for (const reagent of Object.values(catalog.reagents)) {
      const netCharge = reagent.ions.reduce(
        (total, term) => total + catalog.ions[term.ionId].charge * term.multiplicity,
        0,
      );
      expect(netCharge, reagent.id).toBe(0);
      for (const term of reagent.ions) {
        expect(Number.isInteger(term.multiplicity) && term.multiplicity > 0, reagent.id).toBe(true);
      }
    }

    expect(catalog.reagents.HCl.roles).toContain('strong-acid');
    expect(catalog.reagents.NaOH.roles).toContain('strong-base');
  });

  it('resolves each of the six supported pairs to one record in either reagent order', () => {
    expect(Object.keys(catalog.reactions)).toHaveLength(6);
    expect(Object.values(catalog.reactions).map((reaction) => reaction.id).sort()).toEqual(
      [...REQUIRED_REACTION_IDS].sort(),
    );

    for (const [reagentA, reagentB] of REQUIRED_REAGENT_PAIRS) {
      const forward = findReaction(catalog, reagentA, reagentB);
      const reverse = findReaction(catalog, reagentB, reagentA);
      expect(forward, `${reagentA}/${reagentB}`).not.toBeNull();
      expect(reverse).toBe(forward);
      expect(forward.reactantSet).toEqual([reagentA, reagentB].sort());
    }

    const leadIodide = findReaction(catalog, 'KI', 'Pb(NO3)2');
    expect(leadIodide.id).toBe('rxn_pbi2_precipitation');
    expect(leadIodide.molecularReactants).toEqual([
      { speciesId: 'Pb(NO3)2', coefficient: 1, phase: 'aq' },
      { speciesId: 'KI', coefficient: 2, phase: 'aq' },
    ]);
    expect(leadIodide.molecularProducts).toEqual([
      { speciesId: 'PbI2', coefficient: 1, phase: 's' },
      { speciesId: 'KNO3', coefficient: 2, phase: 'aq' },
    ]);
    expect(leadIodide.netIonicReactants).toEqual([
      { speciesId: 'Pb2+', coefficient: 1, phase: 'aq' },
      { speciesId: 'I-', coefficient: 2, phase: 'aq' },
    ]);
    expect(leadIodide.netIonicProducts).toEqual([{ speciesId: 'PbI2', coefficient: 1, phase: 's' }]);
    expect(leadIodide.spectatorIons).toEqual(['NO3-', 'K+']);

    const neutralization = findReaction(catalog, 'NaOH', 'HCl');
    expect(neutralization.category).toBe('strong_acid_base');
    expect(neutralization.netIonicProducts).toEqual([{ speciesId: 'H2O', coefficient: 1, phase: 'l' }]);
    expect(neutralization.phaseModel).toBe('homogeneous_aqueous');
    expect(neutralization.presentation.energyLabel).toBe('exothermic');
    expect(neutralization.presentation.precipitateSpeciesId).toBeNull();
  });

  it('derives presentation metadata and phase behavior from the same reaction record', () => {
    const precipitations = Object.values(catalog.reactions).filter(
      (reaction) => reaction.category === 'precipitation',
    );
    expect(precipitations).toHaveLength(5);

    for (const reaction of precipitations) {
      const precipitateId = reaction.presentation.precipitateSpeciesId;
      expect(catalog.species[precipitateId].solubility, reaction.id).toBe('insoluble');
      expect(reaction.molecularProducts.some((term) => term.speciesId === precipitateId && term.phase === 's')).toBe(true);
      expect(reaction.netIonicProducts.map((term) => term.speciesId)).toEqual([precipitateId]);
      expect(reaction.presentation.precipitateColor).toMatch(/^#[0-9a-f]{6}$/u);
      expect(reaction.presentation.appearance).toBe('cloudy');
      expect(reaction.phaseModel).toBe('aqueous_with_solid');
      expect(reaction.pH).toBeNull();
    }

    expect(catalog.model.phaseModels.homogeneous_aqueous.phases).toEqual(['aq']);
    expect(catalog.model.phaseModels.aqueous_with_solid.phases).toEqual(['aq', 's']);
    expect(catalog.model.immisciblePairs).toEqual([]);
    expect(catalog.model.unsupportedOutcomes.noModeledReaction.category).toBe('no_modeled_reaction');
    expect(catalog.model.unsupportedOutcomes.noModeledReaction.phaseModel).toBe('homogeneous_aqueous');
  });

  it('declares structural formulas only, with no handwritten display lookup', async () => {
    const rawCatalog = await readFile(CATALOG_PATH, 'utf8');

    expect(rawCatalog).not.toMatch(/formulaDisplay|equationDisplay|"equation"/u);
    expect(rawCatalog).not.toMatch(/[\u2080-\u2089]/u);

    expect(catalog.species['Pb(NO3)2'].formulaTerms).toEqual([
      { element: 'Pb', count: 1 },
      {
        group: [
          { element: 'N', count: 1 },
          { element: 'O', count: 3 },
        ],
        count: 2,
      },
    ]);
    expect(catalog.species['Pb(NO3)2'].elementCounts).toEqual({ Pb: 1, N: 2, O: 6 });
  });

  it('declares model capabilities and bounds for temperature, pressure, pH, energy, and sampling', () => {
    const { bounds, capabilities, tolerances } = catalog.model;

    expect(bounds.concentration_molL).toMatchObject({ minimum: 0.1, maximum: 2, default: 1 });
    expect(bounds.volume_mL).toMatchObject({ minimum: 10, maximum: 100, default: 50 });
    expect(bounds.temperature_C).toMatchObject({ minimum: 0, maximum: 100, default: 25 });
    expect(bounds.pressure_atm).toMatchObject({ minimum: 1, maximum: 1, default: 1 });
    for (const tolerance of Object.values(tolerances)) {
      expect(tolerance).toBeGreaterThan(0);
    }

    expect(capabilities.temperature.effect).toBe('qualitative_motion_only');
    expect(capabilities.temperature.affectsExtent).toBe(false);
    expect(capabilities.temperature.affectsRateConstant).toBe(false);
    expect(capabilities.temperature.affectsPH).toBe(false);
    expect(capabilities.temperature.motionSpeedFactor.atMaximum).toBeGreaterThan(
      capabilities.temperature.motionSpeedFactor.atMinimum,
    );

    expect(capabilities.pressure).toMatchObject({
      effect: 'none',
      fixed_atm: 1,
      selectable: false,
      acceptsAlternateValues: false,
    });

    expect(capabilities.pH.modelId).toBe('ideal_strong_monoprotic_acid_base');
    expect(capabilities.pH.pKw).toBe(14);
    expect(capabilities.pH.neutralPH).toBe(capabilities.pH.pKw / 2);
    expect(capabilities.pH.temperatureCorrected).toBe(false);
    expect(capabilities.pH.supportedReactionIds).toEqual(['rxn_h2o_neutralization']);
    expect(capabilities.pH.supportedReagentPairs).toEqual([['HCl', 'NaOH']]);
    expect(capabilities.pH.excludedSystems).toContain('salt_solution');
    expect(Object.keys(capabilities.pH.unsupportedReasons)).toContain('PH_MODEL_SALT_SOLUTION');

    expect(capabilities.energy.quantitativeEnthalpy).toBe(false);
    expect(capabilities.visualization.quantitative).toBe(false);
    expect(capabilities.visualization.affectsResult).toBe(false);
    expect(capabilities.visualization.particleBudget.default).toBeGreaterThanOrEqual(
      capabilities.visualization.particleBudget.minimum,
    );
  });

  it('declares inverse target tags with localized descriptions and no default recommendation', () => {
    const messages = catalog.messages['id-ID'];
    expect(catalog.model.capabilities.inverse.defaultRecommendation).toBeNull();
    expect(catalog.model.capabilities.inverse.supportedGoalKinds).toEqual([
      'precipitate_color',
      'precipitate_identity',
      'target_ph',
    ]);

    const tagsFromReactions = new Set(Object.values(catalog.reactions).flatMap((reaction) => reaction.targetTags));
    expect([...tagsFromReactions].sort()).toEqual(Object.keys(catalog.inverseTargets).sort());

    for (const target of Object.values(catalog.inverseTargets)) {
      expect(messages[target.descriptionKey], target.id).toBeTypeOf('string');
      expect(messages[target.descriptionKey].length, target.id).toBeGreaterThan(8);
    }

    expect(catalog.inverseTargets.precipitate_yellow.reactionIds.sort()).toEqual([
      'rxn_agi_precipitation',
      'rxn_pbi2_precipitation',
    ]);
    expect(catalog.inverseTargets.neutral_ph).toMatchObject({ kind: 'target_ph', targetPH: 7 });
  });

  it('provides localized model-boundary explanations for every declared boundary', () => {
    const messages = catalog.messages['id-ID'];

    expect(messages[catalog.model.capabilities.temperature.messageKey]).toMatch(/Suhu/u);
    expect(messages[catalog.model.capabilities.pressure.messageKey]).toMatch(/1 atm/u);
    expect(messages[catalog.model.unsupportedOutcomes.noModeledReaction.messageKey]).toMatch(/homogen/u);
    expect(messages[catalog.model.capabilities.visualization.scaleDisclosureKey]).toMatch(/sampel/u);
    for (const reason of Object.values(catalog.model.capabilities.pH.unsupportedReasons)) {
      expect(messages[reason.messageKey]).toBeTypeOf('string');
    }
  });

  it('accepts the committed catalog with no definition violation', () => {
    expect(collectDefinitionViolations(catalog)).toEqual([]);
  });

  it('rejects malformed definitions', () => {
    const mutate = (change) => {
      const copy = structuredClone(catalog);
      change(copy);
      return collectDefinitionViolations(copy).join(' | ');
    };

    expect(mutate((draft) => { draft.schemaVersion = '2'; })).toContain('schemaVersion');
    expect(mutate((draft) => { delete draft.reagents.NaOH; })).toContain('reagents must define NaOH');
    expect(mutate((draft) => { draft.reagents.BaCl2.ions[1].multiplicity = 0; })).toContain('positive integer multiplicity');
    expect(mutate((draft) => { draft.reagents.BaCl2.ions[1].multiplicity = 1.5; })).toContain('positive integer multiplicity');
    expect(mutate((draft) => { draft.reagents.BaCl2.ions[1].multiplicity = 1; })).toContain('electroneutral');
    expect(mutate((draft) => { draft.reagents.KI.ions[0].ionId = 'Rb+'; })).toContain('unknown ion');
    expect(mutate((draft) => { draft.ions['Na+'].charge = 0; })).toContain('nonzero integer charge');
    expect(mutate((draft) => { draft.ions['Cl-'].kind = 'cation'; })).toContain('must declare kind anion');
    expect(mutate((draft) => { draft.species.AgCl.elementCounts = { Xx: 1 }; })).toContain('untracked element');
    expect(mutate((draft) => { draft.reactions['AgNO3|NaCl'].molecularProducts[0].coefficient = -1; })).toContain(
      'positive integer coefficient',
    );
    expect(mutate((draft) => { draft.reactions['AgNO3|NaCl'].molecularProducts[0].speciesId = 'AgCl2'; })).toContain(
      'unknown species',
    );
    expect(mutate((draft) => { draft.reactions['AgNO3|NaCl'].molecularProducts[0].phase = 'aq'; })).toContain(
      'does not declare',
    );
    expect(mutate((draft) => { draft.reactions['AgNO3|NaCl'].spectatorIons = ['NO3-', 'I-']; })).toContain(
      'never release',
    );
    expect(mutate((draft) => { draft.reactions['AgNO3|NaCl'].spectatorIons = ['NO3-']; })).toContain(
      'must classify released ion Na+',
    );
    expect(mutate((draft) => { draft.reactions['HCl|NaOH'].pH = null; })).toContain('must declare its supported pH model');
    expect(mutate((draft) => { draft.reactions['HCl|NaOH'].phaseModel = 'aqueous_with_solid'; })).toContain(
      'homogeneous aqueous phase',
    );
    expect(mutate((draft) => { draft.reactions['BaCl2|Na2SO4'].targetTags = ['precipitate_rainbow']; })).toContain(
      'unknown inverse target tag',
    );
    expect(mutate((draft) => { draft.model.capabilities.pressure.selectable = true; })).toContain('must not be selectable');
    expect(mutate((draft) => { draft.model.bounds.pressure_atm.maximum = 2; })).toContain('fixed at 1 atm');
    expect(mutate((draft) => { draft.model.capabilities.temperature.affectsExtent = true; })).toContain('affectsExtent false');
    expect(mutate((draft) => { draft.model.capabilities.pH.neutralPH = 7.4; })).toContain('neutral point must equal pKw/2');
    expect(mutate((draft) => { draft.model.capabilities.inverse.defaultRecommendation = 'AgNO3/NaCl'; })).toContain(
      'default recommendation',
    );
    expect(mutate((draft) => { draft.model.immisciblePairs = [['HCl', 'NaOH']]; })).toContain('immisciblePairs');
    expect(mutate((draft) => { draft.model.bounds.volume_mL.minimum = 0; })).toContain('positive quantity');
    expect(mutate((draft) => { delete draft.messages['id-ID']['model.pressure.unsupported']; })).toContain(
      'localized text for model.pressure.unsupported',
    );
    expect(mutate((draft) => { draft.messages['id-ID']['model.unused.key'] = 'teks tidak terpakai'; })).toContain(
      'unreferenced key',
    );
  });

  it('rejects duplicate definitions', () => {
    const duplicatePairKey = structuredClone(catalog);
    duplicatePairKey.reactions['NaCl|AgNO3'] = structuredClone(catalog.reactions['AgNO3|NaCl']);
    const duplicatePairViolations = collectDefinitionViolations(duplicatePairKey).join(' | ');
    expect(duplicatePairViolations).toContain('duplicate normalized reagent pairs');
    expect(duplicatePairViolations).toContain('must not share a reaction id');

    const duplicateIonTerm = structuredClone(catalog);
    duplicateIonTerm.reagents.Na2SO4.ions = [
      { ionId: 'Na+', multiplicity: 1 },
      { ionId: 'Na+', multiplicity: 1 },
      { ionId: 'SO4_2-', multiplicity: 1 },
    ];
    expect(collectDefinitionViolations(duplicateIonTerm).join(' | ')).toContain('must not repeat an ion');

    const duplicateSpectator = structuredClone(catalog);
    duplicateSpectator.reactions['BaCl2|Na2SO4'].spectatorIons = ['Cl-', 'Cl-', 'Na+'];
    expect(collectDefinitionViolations(duplicateSpectator).join(' | ')).toContain('must not repeat a spectator ion');

    const duplicateDisplayOrder = structuredClone(catalog);
    duplicateDisplayOrder.reagents.KI.displayOrder = duplicateDisplayOrder.reagents.NaCl.displayOrder;
    expect(collectDefinitionViolations(duplicateDisplayOrder).join(' | ')).toContain('share a display order');

    const duplicateSpeciesFormula = structuredClone(catalog);
    duplicateSpeciesFormula.species.KNO3.formulaAscii = 'NaNO3';
    expect(collectDefinitionViolations(duplicateSpeciesFormula).join(' | ')).toContain('duplicate ASCII formulas');

    const duplicateTargetTag = structuredClone(catalog);
    duplicateTargetTag.reactions['AgNO3|KI'].targetTags = ['precipitate_yellow', 'precipitate_yellow'];
    expect(collectDefinitionViolations(duplicateTargetTag).join(' | ')).toContain('must not repeat an inverse target tag');
  });

  it('pins the schema to the same required coverage as the catalog', () => {
    expect(schema.properties.schemaVersion.const).toBe(catalog.schemaVersion);
    expect(schema.properties.reagents.required.sort()).toEqual(Object.keys(catalog.reagents).sort());
    expect(schema.properties.reactions.required.sort()).toEqual(Object.keys(catalog.reactions).sort());
    expect(schema.properties.ions.required.sort()).toEqual(Object.keys(catalog.ions).sort());
    expect(schema.properties.species.required.sort()).toEqual(Object.keys(catalog.species).sort());
    expect(schema.properties.inverseTargets.required.sort()).toEqual(Object.keys(catalog.inverseTargets).sort());
    expect(schema.$defs.reagentId.enum.sort()).toEqual([...REQUIRED_REAGENT_IDS].sort());
    expect(schema.$defs.ionId.enum.sort()).toEqual([...REQUIRED_ION_IDS].sort());
    expect(schema.$defs.positiveInteger).toEqual({ type: 'integer', minimum: 1 });
    expect(schema.properties.reactions.maxProperties).toBe(Object.keys(catalog.reactions).length);
    expect(schema.properties.reagents.maxProperties).toBe(Object.keys(catalog.reagents).length);
  });
});
