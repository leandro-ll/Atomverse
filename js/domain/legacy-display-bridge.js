/**
 * Catalog-derived display tables for the preserved page scripts.
 *
 * `js/chemistry-engine.js`, `js/visualization.js`, and `js/main.js` are still
 * classic scripts that read shared display tables by name. Those tables used to
 * be handwritten literals, which is how `AgNO` and `Pb(NO)2` reached the screen
 * and how a precipitate could disagree with its own equation.
 *
 * This module keeps the same table shapes, but every value in them is derived
 * from the canonical catalog through `chemistry-formatters.js`. It is the only
 * bridge between the catalog and the legacy page: the page owns no chemistry
 * display string of its own.
 *
 * Module scripts run after parsing and before `DOMContentLoaded`, so the tables
 * are installed before the page's first render, which happens on
 * `DOMContentLoaded`.
 *
 * Tasks 4 and 22 replace the legacy consumers with the typed evaluator and owned
 * controllers; this bridge is deleted with them.
 */

import { chemistryFormatters } from './chemistry-formatters.js';

/**
 * Localized energy word appended to an exothermic molecular equation.
 *
 * The catalog models energy qualitatively through `presentation.energyLabel`
 * and owns no short label for it, so the preserved wording is supplied here
 * rather than invented inside the formatters.
 */
export const EXOTHERMIC_ENERGY_TERM = 'Energi';

/**
 * What the preserved page says about pH for the one system the model supports.
 *
 * The legacy page calls `getReactionResult()` with two reagent names and no
 * quantities, so it has nothing to calculate a pH from: the number comes from
 * concentration, volume, and the declared pKw, and only the evaluator sees
 * those. The audited engine filled the gap with a seeded `~7.0` and a flat
 * `7.0 (Netral)` for every HCl/NaOH mixture, which is the scientifically false
 * display defect 1.1 records, so this states where the value comes from
 * instead of inventing one. Task 22 replaces this consumer with the typed
 * evaluator result, which carries the calculated pH.
 *
 * Every *unsupported* system takes its text from the catalog's own localized
 * boundary message rather than from here.
 */
export const PH_FROM_QUANTITATIVE_MODEL_TERM =
  'Nilai pH dihitung dari konsentrasi dan volume pada model kuantitatif katalog.';

/** Name of the installer the legacy chemistry script exposes. */
export const INSTALLER_NAME = 'atomverseInstallChemistryDisplay';

/**
 * Builds every display table the legacy page reads.
 *
 * - `chemicalColors`: reagent solution colors.
 * - `chemicalNames`: Unicode reagent formulas.
 * - `reagentIons`: dissociated ion tokens and their colors.
 * - `reactionRules`: net ionic reactant tokens, product species, and appearance.
 * - `reactionEquations`: balanced molecular equations keyed by both A/B orders.
 * - `reactionProductLabels`: compact product captions keyed the same way.
 * - `reactionPHLabels`: what to say about pH for each modeled pair, keyed the
 *   same way: the catalog's localized boundary message when the reaction
 *   declares no pH model, and the quantitative-model statement for the one
 *   system that does.
 * - `messages`: localized model-boundary explanations.
 */
export function buildLegacyDisplayTables(formatters = chemistryFormatters) {
  const chemicalColors = {};
  const chemicalNames = {};
  const reagentIons = {};

  for (const reagent of formatters.listReagents()) {
    chemicalColors[reagent.reagentId] = reagent.solutionColor;
    chemicalNames[reagent.reagentId] = reagent.formula;
    reagentIons[reagent.reagentId] = reagent.ions.map((ion) => ({ t: ion.formula, c: ion.color }));
  }

  const reagentIds = formatters.listReagents().map((reagent) => reagent.reagentId);
  const reactionEquations = {};
  const reactionProductLabels = {};
  const reactionPHLabels = {};
  const reactionRules = [];
  const seenReactionIds = new Set();

  for (const reagentA of reagentIds) {
    for (const reagentB of reagentIds) {
      if (reagentA === reagentB) continue;
      const display = formatters.formatReactionDisplay(reagentA, reagentB, {
        energyTerm: EXOTHERMIC_ENERGY_TERM,
      });
      if (display.status !== 'modeled') continue;

      reactionEquations[`${reagentA}-${reagentB}`] = display.molecularEquation;
      reactionProductLabels[`${reagentA}-${reagentB}`] = display.productSummary;
      reactionPHLabels[`${reagentA}-${reagentB}`] = display.pH.supported
        ? PH_FROM_QUANTITATIVE_MODEL_TERM
        : display.pH.message;
      if (seenReactionIds.has(display.reactionId)) continue;
      seenReactionIds.add(display.reactionId);
      reactionRules.push(buildReactionRule(formatters, reagentA, reagentB, display));
    }
  }

  return {
    chemicalColors,
    chemicalNames,
    reagentIons,
    reactionRules,
    reactionEquations,
    reactionProductLabels,
    reactionPHLabels,
    messages: {
      noModeledReaction: formatters.describeNoModeledReaction().message,
      // The pH text an unmatched pair shows. It is the catalog's own reason
      // message, so the page states why no number exists rather than defaulting
      // one, which is what requirement 3.6 asks of every unsupported system.
      phNoModeledReaction: formatters.describeUnsupportedPH('PH_MODEL_NO_MODELED_REACTION').message,
      visualSampleDisclosure: formatters.describeCapabilityBoundary('visualization').message,
      temperatureBoundary: formatters.describeCapabilityBoundary('temperature').message,
      pressureBoundary: formatters.describeCapabilityBoundary('pressure').message,
    },
  };
}

/**
 * Projects one reaction onto the ion-collision rule the particle view uses:
 * the two net ionic reactant tokens, the net ionic product species, and the
 * precipitate color and name when the reaction produces a solid.
 */
function buildReactionRule(formatters, reagentA, reagentB, display) {
  const reaction = formatters.findReaction(reagentA, reagentB);
  const reactantIons = reaction.netIonicReactants.map((term) => formatters.describeIon(term.speciesId));
  const cation = reactantIons.find((ion) => ion.charge > 0);
  const anion = reactantIons.find((ion) => ion.charge < 0);
  const productSpeciesId = reaction.netIonicProducts[0].speciesId;

  return {
    cation: cation.formula,
    anion: anion.formula,
    ppt: productSpeciesId,
    color: display.precipitate ? display.precipitate.color : null,
    name: formatters.formatDisplayName(productSpeciesId),
    reactionId: reaction.id,
  };
}

/**
 * Installs the derived tables into the legacy page when it exposes the
 * installer. Returns the tables so callers can assert on them, and reports
 * whether an installer was present.
 */
export function installLegacyDisplayTables(target = globalThis, formatters = chemistryFormatters) {
  const tables = buildLegacyDisplayTables(formatters);
  const install = target?.[INSTALLER_NAME];
  if (typeof install !== 'function') return { installed: false, tables };
  install(tables);
  return { installed: true, tables };
}

installLegacyDisplayTables();
