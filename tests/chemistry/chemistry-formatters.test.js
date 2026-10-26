import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  HALF_AWAY_FROM_ZERO,
  SUPPORTED_ROUNDING_MODES,
  createChemistryFormatters,
  chemistryFormatters,
  formatChargeSuperscript,
  formatFixed,
  formatFormulaTerms,
  formatSubscript,
  normalizePairKey,
  roundHalfAwayFromZero,
} from '../../js/domain/chemistry-formatters.js';
import {
  EXOTHERMIC_ENERGY_TERM,
  buildLegacyDisplayTables,
  installLegacyDisplayTables,
} from '../../js/domain/legacy-display-bridge.js';
import { loadCatalog } from '../helpers/chemistry/catalog-definitions.mjs';
import { loadDisplayFormattingFixture } from '../helpers/chemistry/catalog-fixtures.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const UNICODE_SUBSCRIPTS = /[\u2080-\u2089]/u;
const ASCII_DIGITS = /\d/u;

/** Every `<option>` of the two reagent selects, keyed by reagent id. */
function readReagentOptionLabels(html, reagentIds) {
  const labels = {};
  for (const match of html.matchAll(/<option value="([^"]+)"\s*>([^<]*)<\/option>/gu)) {
    const [, value, label] = match;
    if (!reagentIds.includes(value)) continue;
    labels[value] ??= new Set();
    labels[value].add(label);
  }
  return labels;
}

/** Validates: Requirements 1.3, 1.5, 2.2 */
describe('chemistry display formatters', () => {
  let catalog;
  let fixture;
  let formatters;

  beforeAll(async () => {
    catalog = await loadCatalog();
    fixture = await loadDisplayFormattingFixture();
    formatters = createChemistryFormatters(catalog);
  });

  it('formats the golden fixture against the committed catalog version', () => {
    expect(fixture.catalogVersion).toBe(catalog.catalogVersion);
    expect(fixture.locale).toBe(catalog.locale);
    expect(chemistryFormatters.catalogVersion).toBe(catalog.catalogVersion);
  });

  describe('Unicode formulas', () => {
    it('derives every species formula from structural terms', () => {
      expect(Object.keys(fixture.speciesFormulas).sort()).toEqual(Object.keys(catalog.species).sort());
      for (const [speciesId, expected] of Object.entries(fixture.speciesFormulas)) {
        expect(formatters.formatSpeciesFormula(speciesId), speciesId).toBe(expected);
        expect(formatters.formatFormula(speciesId), speciesId).toBe(expected);
        expect(expected, speciesId).not.toMatch(ASCII_DIGITS);
      }

      expect(formatters.formatSpeciesFormula('Pb(NO3)2')).toBe('Pb(NO\u2083)\u2082');
      expect(formatters.formatSpeciesFormula('AgNO3')).toBe('AgNO\u2083');
      expect(formatters.formatSpeciesFormula('AgNO3')).not.toBe('AgNO');
    });

    it('derives every ion formula with its charge superscript', () => {
      expect(Object.keys(fixture.ionFormulas).sort()).toEqual(Object.keys(catalog.ions).sort());
      for (const [ionId, expected] of Object.entries(fixture.ionFormulas)) {
        expect(formatters.formatIonFormula(ionId), ionId).toBe(expected);
        expect(formatters.formatFormula(ionId), ionId).toBe(expected);
        expect(expected, ionId).not.toMatch(ASCII_DIGITS);
      }

      expect(formatters.formatIonFormula('SO4_2-')).toBe('SO\u2084\u00b2\u207b');
      expect(formatters.formatIonFormula('Pb2+')).toBe('Pb\u00b2\u207a');
      expect(formatters.formatIonFormula('OH-')).toBe('OH\u207b');
      expect(formatters.describeIon('Pb2+')).toMatchObject({
        ionId: 'Pb2+',
        formula: 'Pb\u00b2\u207a',
        charge: 2,
        kind: 'cation',
      });
    });

    it('follows the structural terms rather than the ASCII formula', () => {
      const drifted = structuredClone(catalog);
      drifted.species.AgNO3.formulaTerms = [
        { element: 'Ag', count: 1 },
        { element: 'N', count: 1 },
      ];

      expect(createChemistryFormatters(drifted).formatSpeciesFormula('AgNO3')).toBe('AgN');
      expect(formatters.formatSpeciesFormula('AgNO3')).toBe('AgNO\u2083');
    });

    it('labels reagent controls with the derived formula and localized name', () => {
      for (const [reagentId, expected] of Object.entries(fixture.reagentLabels)) {
        expect(formatters.formatReagentLabel(reagentId), reagentId).toBe(expected);
      }

      const reagents = formatters.listReagents();
      expect(reagents.map((reagent) => reagent.reagentId)).toEqual(
        Object.values(catalog.reagents)
          .slice()
          .sort((left, right) => left.displayOrder - right.displayOrder)
          .map((reagent) => reagent.id),
      );
      expect(reagents[0]).toMatchObject({
        reagentId: 'AgNO3',
        formula: 'AgNO\u2083',
        displayName: 'Perak Nitrat',
        solutionColor: catalog.reagents.AgNO3.presentation.solutionColor,
      });
      expect(reagents[1].ions).toEqual([
        {
          ionId: 'Pb2+',
          multiplicity: 1,
          formula: 'Pb\u00b2\u207a',
          displayName: 'ion timbal(II)',
          color: catalog.ions['Pb2+'].presentation.color,
        },
        {
          ionId: 'NO3-',
          multiplicity: 2,
          formula: 'NO\u2083\u207b',
          displayName: 'ion nitrat',
          color: catalog.ions['NO3-'].presentation.color,
        },
      ]);
    });

    it('formats dissociation with catalog ion multiplicities', () => {
      for (const [reagentId, expected] of Object.entries(fixture.dissociationEquations)) {
        expect(formatters.formatDissociationEquation(reagentId), reagentId).toBe(expected);
      }
    });
  });

  describe('balanced equations', () => {
    it('formats the molecular equation of every supported pair in either order', () => {
      expect(fixture.reactions).toHaveLength(Object.keys(catalog.reactions).length);

      for (const expected of fixture.reactions) {
        const [reagentA, reagentB] = expected.reagents;
        expect(normalizePairKey(reagentA, reagentB), expected.pairKey).toBe(expected.pairKey);

        const forward = formatters.formatMolecularEquation(expected.pairKey);
        expect(forward, expected.pairKey).toBe(expected.molecularEquation);
        expect(formatters.formatMolecularEquation(expected.reactionId)).toBe(forward);
        expect(formatters.formatReactionDisplay(reagentA, reagentB).molecularEquation).toBe(forward);
        expect(formatters.formatReactionDisplay(reagentB, reagentA).molecularEquation).toBe(forward);
        expect(formatters.formatProductSummary(expected.pairKey), expected.pairKey).toBe(expected.productSummary);
        expect(formatters.formatReactionDisplay(reagentB, reagentA).productSummary).toBe(expected.productSummary);
        expect(forward, expected.pairKey).not.toMatch(/AgNO\(|Pb\(NO\)/u);
      }
    });

    it('formats the net ionic equation of every supported pair in either order', () => {
      for (const expected of fixture.reactions) {
        const [reagentA, reagentB] = expected.reagents;
        const forward = formatters.formatNetIonicEquation(expected.pairKey);
        expect(forward, expected.pairKey).toBe(expected.netIonicEquation);
        expect(formatters.formatReactionDisplay(reagentA, reagentB).netIonicEquation).toBe(forward);
        expect(formatters.formatReactionDisplay(reagentB, reagentA).netIonicEquation).toBe(forward);
        expect(formatters.formatSpectatorIons(expected.pairKey)).toEqual(expected.spectatorIons);
      }

      expect(formatters.formatSpectatorIonList('AgNO3|NaCl')).toBe('NO\u2083\u207b, Na\u207a');
    });

    it('appends a localized energy term only to an exothermic equation', () => {
      for (const expected of fixture.reactions) {
        const options = { energyTerm: fixture.energyTerm };
        const molecular = formatters.formatMolecularEquation(expected.pairKey, options);
        const netIonic = formatters.formatNetIonicEquation(expected.pairKey, options);

        if (expected.energyLabel === 'exothermic') {
          expect(molecular, expected.pairKey).toBe(expected.molecularEquationWithEnergy);
          expect(netIonic, expected.pairKey).toBe(expected.netIonicEquationWithEnergy);
        } else {
          expect(molecular, expected.pairKey).toBe(expected.molecularEquation);
          expect(netIonic, expected.pairKey).toBe(expected.netIonicEquation);
        }
      }
    });

    it('projects equation, product, phase, appearance, and energy from one record', () => {
      for (const expected of fixture.reactions) {
        const [reagentA, reagentB] = expected.reagents;
        const display = formatters.formatReactionDisplay(reagentA, reagentB);
        const record = catalog.reactions[expected.pairKey];

        expect(display.status).toBe('modeled');
        expect(display.reactionId).toBe(expected.reactionId);
        expect(display.category).toBe(expected.category);
        expect(display.energyLabel).toBe(expected.energyLabel);
        expect(display.appearance).toBe(record.presentation.appearance);
        expect(display.solutionColor).toBe(record.presentation.solutionColor);
        expect(display.phase.phaseModel).toBe(record.phaseModel);
        expect(display.phase.layered).toBe(false);
        expect(display.reagents).toEqual([
          formatters.formatReagentFormula(reagentA),
          formatters.formatReagentFormula(reagentB),
        ]);

        if (expected.precipitate === null) {
          expect(display.precipitate, expected.pairKey).toBeNull();
          expect(display.pH).toMatchObject({ supported: true, modelId: record.pH.modelId });
        } else {
          expect(display.precipitate).toMatchObject(expected.precipitate);
          expect(display.netIonicEquation).toContain(expected.precipitate.formula);
          expect(display.pH).toMatchObject({
            supported: false,
            reasonCode: fixture.pHUnsupportedReasonCodes[expected.pairKey],
            message: fixture.boundaryMessages[fixture.pHUnsupportedMessageKeys[record.pHUnsupportedReasonCode]],
          });
        }
      }
    });
  });

  describe('localized model boundaries', () => {
    it('reports unmatched pairs as unsupported with no equation or product', () => {
      const expected = fixture.noModeledReaction;

      for (const pair of fixture.unmodeledPairs) {
        const [reagentA, reagentB] = pair.reagents;
        expect(formatters.findReaction(reagentA, reagentB), pair.pairKey).toBeNull();

        for (const display of [
          formatters.formatReactionDisplay(reagentA, reagentB),
          formatters.formatReactionDisplay(reagentB, reagentA),
        ]) {
          expect(display.pairKey).toBe(pair.pairKey);
          expect(display.status).toBe(expected.status);
          expect(display.category).toBe(expected.category);
          expect(display.reasonCode).toBe(expected.reasonCode);
          expect(display.messageKey).toBe(expected.messageKey);
          expect(display.message).toBe(fixture.boundaryMessages[expected.messageKey]);
          expect(display.molecularEquation).toBeNull();
          expect(display.netIonicEquation).toBeNull();
          expect(display.productSummary).toBeNull();
          expect(display.precipitate).toBeNull();
          expect(display.reactionId).toBeNull();
          expect(display.spectatorIons).toEqual([]);
          expect(display.phase.phaseModel).toBe(expected.phaseModel);
          expect(display.phase.layered).toBe(expected.layered);
          expect(display.pH).toMatchObject({
            status: 'unsupported',
            reasonCode: expected.pHReasonCode,
            pH: null,
          });
        }
      }
    });

    it('explains every declared capability, phase, and unsupported boundary', () => {
      const boundaries = formatters.listModelBoundaries();

      for (const [capability, messageKey] of Object.entries(fixture.capabilityBoundaryKeys)) {
        expect(formatters.describeCapabilityBoundary(capability), capability).toEqual({
          capability,
          messageKey,
          message: fixture.boundaryMessages[messageKey],
        });
      }

      expect(boundaries.capabilities.map((entry) => entry.capability)).toEqual(
        Object.keys(fixture.capabilityBoundaryKeys).sort(),
      );
      expect(boundaries.phaseModels.map((entry) => entry.messageKey)).toEqual([
        'model.phase.aqueousWithSolid',
        'model.phase.homogeneousAqueous',
      ]);
      for (const phaseModel of boundaries.phaseModels) {
        expect(phaseModel.message).toBe(fixture.boundaryMessages[phaseModel.messageKey]);
        expect(phaseModel.layered).toBe(false);
      }

      expect(boundaries.outsideCatalogCapability).toEqual({
        ...fixture.outsideCatalogCapability,
        message: fixture.boundaryMessages[fixture.outsideCatalogCapability.messageKey],
      });

      for (const [reasonCode, messageKey] of Object.entries(fixture.pHUnsupportedMessageKeys)) {
        expect(formatters.describeUnsupportedPH(reasonCode), reasonCode).toEqual({
          status: 'unsupported',
          capability: 'pH',
          reasonCode,
          messageKey,
          message: fixture.boundaryMessages[messageKey],
          pH: null,
        });
      }
      expect(boundaries.pHUnsupportedReasons.map((entry) => entry.reasonCode)).toEqual(
        Object.keys(fixture.pHUnsupportedMessageKeys).sort(),
      );
    });

    it('resolves localized text only for declared message keys', () => {
      for (const [messageKey, message] of Object.entries(fixture.boundaryMessages)) {
        expect(formatters.resolveMessage(messageKey), messageKey).toBe(message);
      }
      expect(() => formatters.resolveMessage('model.unknown.key')).toThrow(/message key/u);
    });
  });

  describe('failure behavior', () => {
    it('throws on unknown identifiers instead of rendering a placeholder', () => {
      expect(() => formatters.formatSpeciesFormula('AgCl2')).toThrow(/unknown species/u);
      expect(() => formatters.formatIonFormula('Rb+')).toThrow(/unknown ion/u);
      expect(() => formatters.formatReagentFormula('KBr')).toThrow(/unknown reagent/u);
      expect(() => formatters.formatMolecularEquation('AgNO3|KBr')).toThrow(/unknown reaction/u);
      expect(() => formatters.findReaction('AgNO3', 'KBr')).toThrow(/unknown reagent/u);
      expect(() => formatters.describeUnsupportedPH('PH_MODEL_UNKNOWN')).toThrow(/reason code/u);
      expect(() => formatters.describeCapabilityBoundary('viscosity')).toThrow(/capability boundary/u);
      expect(() => formatters.describePhaseModel('layered_organic')).toThrow(/phase model/u);
    });

    it('rejects malformed structural terms and coefficients', () => {
      expect(() => formatFormulaTerms([])).toThrow(/non-empty/u);
      expect(() => formatFormulaTerms([{ element: 'Ag', count: 0 }])).toThrow(/positive integer/u);
      expect(() => formatFormulaTerms([{ element: 'Ag', count: 1.5 }])).toThrow(/positive integer/u);
      expect(() => formatFormulaTerms([{ count: 2 }])).toThrow(/element or a group/u);
      expect(() => formatSubscript(-1)).toThrow(/positive integer/u);
      expect(() => formatChargeSuperscript(1.5)).toThrow(/integer/u);
      expect(() => formatters.formatTerm({ speciesId: 'AgCl', coefficient: 0, phase: 's' })).toThrow(
        /positive integer/u,
      );
      expect(() => formatters.formatTerm({ speciesId: 'AgCl', coefficient: 1, phase: 'plasma' })).toThrow(
        /unknown phase/u,
      );
      expect(() => formatters.formatEquationSide([])).toThrow(/at least one term/u);
      expect(() => createChemistryFormatters(null)).toThrow(/catalog must be an object/u);
    });
  });

  describe('no parallel handwritten display lookup remains', () => {
    it('keeps every chemistry display string out of the legacy page scripts', async () => {
      const sources = await Promise.all(
        ['js/chemistry-engine.js', 'js/visualization.js'].map(async (path) => [
          path,
          await readFile(resolve(repositoryRoot, path), 'utf8'),
        ]),
      );

      for (const [path, source] of sources) {
        expect(source, path).not.toMatch(UNICODE_SUBSCRIPTS);
        expect(source, path).not.toMatch(/\u2192/u);
        for (const reagentId of Object.keys(catalog.reagents)) {
          expect(source, `${path} must not hardcode ${reagentId}`).not.toContain(`'${reagentId}'`);
        }
      }

      // The lab flow must not restate a product formula either; it reads the
      // derived caption from the result instead.
      const main = await readFile(resolve(repositoryRoot, 'js/main.js'), 'utf8');
      expect(main).not.toContain('NaCl + H\u2082O');
      expect(main).toContain('res.productLabel');
    });

    it('renders every reagent option from the derived label', async () => {
      const html = await readFile(resolve(repositoryRoot, 'index.html'), 'utf8');
      const reagentIds = Object.keys(catalog.reagents);
      const labels = readReagentOptionLabels(html, reagentIds);

      expect(Object.keys(labels).sort()).toEqual([...reagentIds].sort());
      for (const [reagentId, rendered] of Object.entries(labels)) {
        expect([...rendered], reagentId).toEqual([formatters.formatReagentLabel(reagentId)]);
      }
      expect(html).not.toMatch(/>AgNO </u);
    });

    it('derives the legacy display tables from the catalog', () => {
      const tables = buildLegacyDisplayTables(formatters);

      expect(tables.chemicalNames).toEqual(
        Object.fromEntries(
          Object.keys(fixture.reagentLabels).map((reagentId) => [
            reagentId,
            fixture.speciesFormulas[catalog.reagents[reagentId].speciesId],
          ]),
        ),
      );
      expect(tables.chemicalColors).toEqual(
        Object.fromEntries(
          Object.values(catalog.reagents).map((reagent) => [reagent.id, reagent.presentation.solutionColor]),
        ),
      );
      expect(tables.reagentIons['Na2SO4']).toEqual([
        { t: 'Na\u207a', c: catalog.ions['Na+'].presentation.color },
        { t: 'SO\u2084\u00b2\u207b', c: catalog.ions['SO4_2-'].presentation.color },
      ]);

      expect(tables.reactionRules).toHaveLength(Object.keys(catalog.reactions).length);
      expect(tables.reactionRules.map((rule) => rule.ppt).sort()).toEqual(
        ['AgCl', 'AgI', 'BaSO4', 'H2O', 'PbCl2', 'PbI2'],
      );
      expect(tables.reactionRules.find((rule) => rule.ppt === 'PbI2')).toEqual({
        cation: 'Pb\u00b2\u207a',
        anion: 'I\u207b',
        ppt: 'PbI2',
        color: catalog.reactions['KI|Pb(NO3)2'].presentation.precipitateColor,
        name: 'Timbal(II) Iodida',
        reactionId: 'rxn_pbi2_precipitation',
      });

      for (const expected of fixture.reactions) {
        const [reagentA, reagentB] = expected.reagents;
        const forward = tables.reactionEquations[`${reagentA}-${reagentB}`];
        const reverse = tables.reactionEquations[`${reagentB}-${reagentA}`];
        const withEnergy = expected.molecularEquationWithEnergy ?? expected.molecularEquation;
        expect(forward, expected.pairKey).toBe(withEnergy);
        expect(reverse, expected.pairKey).toBe(withEnergy);
        expect(tables.reactionProductLabels[`${reagentA}-${reagentB}`]).toBe(expected.productSummary);
        expect(tables.reactionProductLabels[`${reagentB}-${reagentA}`]).toBe(expected.productSummary);
      }
      expect(Object.keys(tables.reactionEquations)).toHaveLength(Object.keys(catalog.reactions).length * 2);
      expect(tables.reactionEquations['AgNO3-Pb(NO3)2']).toBeUndefined();
      expect(tables.messages.noModeledReaction).toBe(
        fixture.boundaryMessages[fixture.noModeledReaction.messageKey],
      );
      expect(EXOTHERMIC_ENERGY_TERM).toBe(fixture.energyTerm);
    });

    it('installs the derived tables into the legacy page scripts', () => {
      const chemicalNames = {};
      const chemicalColors = {};
      const reagentIons = {};
      const reactionEquations = {};
      const productLabels = {};
      const reactionRules = [{ cation: 'stale', anion: 'stale', ppt: 'stale' }];
      const messages = {};
      const page = {
        atomverseInstallChemistryDisplay(tables) {
          Object.assign(chemicalNames, tables.chemicalNames);
          Object.assign(chemicalColors, tables.chemicalColors);
          Object.assign(reagentIons, tables.reagentIons);
          Object.assign(reactionEquations, tables.reactionEquations);
          Object.assign(productLabels, tables.reactionProductLabels);
          Object.assign(messages, tables.messages);
          reactionRules.length = 0;
          reactionRules.push(...tables.reactionRules);
        },
      };

      expect(installLegacyDisplayTables(page, formatters).installed).toBe(true);
      expect(chemicalNames.AgNO3).toBe('AgNO\u2083');
      expect(chemicalColors.AgNO3).toBe(catalog.reagents.AgNO3.presentation.solutionColor);
      expect(reagentIons.AgNO3.map((ion) => ion.t)).toEqual(['Ag\u207a', 'NO\u2083\u207b']);
      expect(reactionEquations['NaCl-AgNO3']).toBe('AgNO\u2083(aq) + NaCl(aq) \u2192 AgCl(s) + NaNO\u2083(aq)');
      expect(productLabels['NaOH-HCl']).toBe('NaCl + H\u2082O');
      expect(reactionRules).toHaveLength(6);
      expect(messages.noModeledReaction).toBeTypeOf('string');

      expect(installLegacyDisplayTables({}, formatters).installed).toBe(false);
    });

    it('lets the legacy engine report catalog-derived equations and captions', async () => {
      const source = await readFile(resolve(repositoryRoot, 'js/chemistry-engine.js'), 'utf8');
      const context = createContext({ window: {} });
      context.window = context;
      runInContext(source, context);

      expect(installLegacyDisplayTables(context, formatters).installed).toBe(true);

      const resultFor = (reagentA, reagentB) => {
        context.state = { reagentA, reagentB };
        return runInContext('getReactionResult()', context);
      };

      const neutralization = resultFor('HCl', 'NaOH');
      expect(neutralization.equation).toBe(
        'HCl(aq) + NaOH(aq) \u2192 NaCl(aq) + H\u2082O(l) + Energi',
      );
      expect(neutralization.productLabel).toBe('NaCl + H\u2082O');
      expect(neutralization.energy).toBe('Eksoterm (Panas)');

      const leadIodide = resultFor('KI', 'Pb(NO3)2');
      expect(leadIodide.equation).toBe(
        'Pb(NO\u2083)\u2082(aq) + 2KI(aq) \u2192 PbI\u2082(s) + 2KNO\u2083(aq)',
      );
      expect(leadIodide.ppt).toBe('Timbal(II) Iodida');
      expect(resultFor('Pb(NO3)2', 'KI').equation).toBe(leadIodide.equation);

      const silverChloride = resultFor('NaCl', 'AgNO3');
      expect(silverChloride.equation).toBe('AgNO\u2083(aq) + NaCl(aq) \u2192 AgCl(s) + NaNO\u2083(aq)');
      expect(silverChloride.equation).not.toContain('AgNO(');

      const unmodeled = resultFor('AgNO3', 'Pb(NO3)2');
      expect(unmodeled.ppt).toBeNull();
      expect(unmodeled.productLabel).toBeNull();
      expect(unmodeled.equation).not.toContain('\u2192');
    });
  });
});

/**
 * Display precision is a projection, not a domain value.
 *
 * Every rounded number in the system is produced here, from the precision,
 * rounding mode, separator, and unit the catalog declares. The golden strings
 * in `quantityDisplay` are hand written, so neither language half can pass by
 * reproducing its own rounding default: JavaScript's `toFixed` rounds the
 * binary expansion and Python's `round` rounds half to even, and both disagree
 * with `half_away_from_zero` on the cases below.
 *
 * Validates: Requirements 3.7
 */
describe('quantity display precision', () => {
  let catalog;
  let fixture;
  let formatters;
  let display;

  beforeAll(async () => {
    catalog = await loadCatalog();
    fixture = await loadDisplayFormattingFixture();
    formatters = createChemistryFormatters(catalog);
    display = fixture.quantityDisplay;
  });

  it('drives precision, rounding mode, separator, and unit from the catalog', () => {
    expect(SUPPORTED_ROUNDING_MODES).toEqual([HALF_AWAY_FROM_ZERO]);
    expect(catalog.model.display.roundingMode).toBe(display.roundingMode);
    expect(catalog.model.display.decimalSeparator).toBe(display.decimalSeparator);
    expect(formatters.listDisplayQuantities()).toEqual(Object.keys(display.quantityPrecision).sort());

    for (const [quantity, precision] of Object.entries(display.quantityPrecision)) {
      const declared = formatters.describeDisplayQuantity(quantity);
      expect(declared.precision, quantity).toBe(precision);
      expect(declared.unit, quantity).toBe(display.quantityUnits[quantity]);
      expect(declared.roundingMode, quantity).toBe(HALF_AWAY_FROM_ZERO);
      expect(declared.decimalSeparator, quantity).toBe(display.decimalSeparator);
      expect(catalog.model.display.quantities[quantity].precision, quantity).toBe(precision);
    }

    // The quantitative pH model reports one precision, so the pH display can
    // never disagree with the capability that produced the value.
    expect(formatters.describeDisplayQuantity('pH').precision).toBe(catalog.model.capabilities.pH.displayPrecision);
    expect(() => formatters.describeDisplayQuantity('enthalpy_kJ')).toThrow(/no display precision/u);
  });

  it('reproduces every golden display string and is idempotent on its own output', () => {
    expect(display.cases.length).toBeGreaterThan(0);
    for (const { quantity, value, text, labeled } of display.cases) {
      expect(formatters.formatQuantityValue(quantity, value), `${quantity} ${value}`).toBe(text);
      expect(formatters.formatQuantity(quantity, value), `${quantity} ${value}`).toBe(labeled);
      expect(formatters.formatQuantity(quantity, value, { withUnit: false })).toBe(text);

      // Formatting an already rounded display value changes nothing, so a
      // display string is stable however many times it is re-projected.
      const rounded = formatters.roundQuantityForDisplay(quantity, value);
      expect(formatters.formatQuantityValue(quantity, rounded), `${quantity} ${value}`).toBe(text);
      expect(formatters.roundQuantityForDisplay(quantity, rounded)).toBe(rounded);
      expect(Number(text)).toBe(Math.abs(rounded));
    }
  });

  it('rounds half away from zero rather than following the language default', () => {
    expect(formatFixed(0.125, 2)).toBe('0.13');
    expect(formatFixed(0.135, 2)).toBe('0.14');
    expect(formatFixed(2.675, 2)).toBe('2.68');
    expect(formatFixed(7.005, 2)).toBe('7.01');
    expect(formatFixed(-2.675, 2)).toBe('-2.68');
    expect(formatFixed(99.95, 1)).toBe('100.0');
    expect(formatFixed(9.9999, 3)).toBe('10.000');
    expect(formatFixed(0.5, 0)).toBe('1');
    expect(formatFixed(1.5, 0)).toBe('2');
    expect(formatFixed(2.5, 0)).toBe('3');

    // `toFixed` rounds the binary expansion, which is why it is not used.
    expect((2.675).toFixed(2)).toBe('2.67');
    expect(formatFixed(2.675, 2)).not.toBe((2.675).toFixed(2));

    expect(roundHalfAwayFromZero(0.012355, 4)).toBe(0.0124);
    expect(roundHalfAwayFromZero(-0.012355, 4)).toBe(-0.0124);
    expect(formatFixed(12.3456, 2, ',')).toBe('12,35');
  });

  it('never prints a negative zero for a value that rounds away', () => {
    expect(formatFixed(-0, 4)).toBe('0.0000');
    expect(formatFixed(-1e-18, 4)).toBe('0.0000');
    expect(formatters.formatQuantity('amount_mol', -1e-18)).toBe('0.0000 mol');
    expect(formatters.formatQuantityValue('amount_mol', -1e-18)).not.toContain('-');
    expect(roundHalfAwayFromZero(-1e-18, 4)).toBe(0);
  });

  it('reports an absent pH as absent instead of fabricating a neutral value', () => {
    expect(formatters.formatPH(null)).toBeNull();
    expect(formatters.formatPH(undefined)).toBeNull();
    expect(formatters.formatPH(7)).toBe('7.00');

    const unsupported = formatters.describeUnsupportedPH('PH_MODEL_NO_MODELED_REACTION');
    expect(unsupported.pH).toBeNull();
    expect(formatters.formatPH(unsupported.pH)).toBeNull();
    expect(unsupported.message).not.toMatch(/\d/u);

    const projection = formatters.formatExperimentQuantities({
      extent_mol: 0,
      totalVolume_L: 0.1,
      reactants: [],
      pH: null,
      speciesLedger: null,
    });
    expect(projection.pH).toBeNull();
    expect(projection.speciesLedger).toBeNull();
    expect(JSON.stringify(projection)).not.toContain('7.0');
  });

  it('rejects a value or a precision that has no defined display', () => {
    expect(() => formatters.formatQuantityValue('amount_mol', Number.NaN)).toThrow(/finite number/u);
    expect(() => formatters.formatQuantityValue('amount_mol', Number.POSITIVE_INFINITY)).toThrow(/finite number/u);
    expect(() => formatters.formatQuantityValue('amount_mol', '0.5')).toThrow(/finite number/u);
    expect(() => formatters.formatQuantityValue('nitrogen_mol', 1)).toThrow(/no display precision/u);
    expect(() => formatFixed(1, -1)).toThrow(/nonnegative integer/u);
    expect(() => formatFixed(1, 1.5)).toThrow(/nonnegative integer/u);
    expect(() => formatters.formatExperimentQuantities(null)).toThrow(TypeError);
  });

  it('refuses a catalog that declares a rounding mode it does not implement', () => {
    const mutated = structuredClone(catalog);
    mutated.model.display.roundingMode = 'half_to_even';
    expect(() => createChemistryFormatters(mutated)).toThrow(/unsupported display rounding mode/u);

    const separatorless = structuredClone(catalog);
    separatorless.model.display.decimalSeparator = '';
    expect(() => createChemistryFormatters(separatorless)).toThrow(/decimal separator/u);

    const displayless = structuredClone(catalog);
    delete displayless.model.display;
    expect(() => createChemistryFormatters(displayless)).toThrow(/no model.display settings/u);

    // The precision comes from the catalog, not from a constant in this module.
    const coarse = structuredClone(catalog);
    coarse.model.display.quantities.amount_mol.precision = 1;
    expect(createChemistryFormatters(coarse).formatQuantity('amount_mol', 0.05)).toBe('0.1 mol');
  });
});
