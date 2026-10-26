/**
 * Catalog definition checks shared by the chemistry catalog tests.
 *
 * These checks cover the *definition* layer of the canonical catalog: required
 * version 1 coverage, stable identifiers, reference integrity, positive integer
 * coefficients and dissociation multiplicities, declared model capabilities and
 * bounds, inverse target agreement, localized message integrity, and duplicate
 * or malformed definitions.
 *
 * Elemental and charge balance, digest generation, and JSON Schema execution are
 * deliberately out of scope here; catalog validation scripts own them.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');

export const CATALOG_PATH = resolve(repositoryRoot, 'catalog', 'chemistry.catalog.json');
export const SCHEMA_PATH = resolve(repositoryRoot, 'catalog', 'chemistry.schema.json');

export const REQUIRED_REAGENT_IDS = Object.freeze([
  'AgNO3',
  'Pb(NO3)2',
  'BaCl2',
  'NaCl',
  'KI',
  'Na2SO4',
  'HCl',
  'NaOH',
]);

export const REQUIRED_ION_IDS = Object.freeze([
  'Ag+',
  'Pb2+',
  'Ba2+',
  'Na+',
  'K+',
  'H+',
  'NO3-',
  'Cl-',
  'I-',
  'SO4_2-',
  'OH-',
]);

export const REQUIRED_REACTION_IDS = Object.freeze([
  'rxn_agcl_precipitation',
  'rxn_agi_precipitation',
  'rxn_pbcl2_precipitation',
  'rxn_pbi2_precipitation',
  'rxn_baso4_precipitation',
  'rxn_h2o_neutralization',
]);

export const REQUIRED_REAGENT_PAIRS = Object.freeze([
  ['AgNO3', 'NaCl'],
  ['AgNO3', 'KI'],
  ['Pb(NO3)2', 'NaCl'],
  ['Pb(NO3)2', 'KI'],
  ['BaCl2', 'Na2SO4'],
  ['HCl', 'NaOH'],
]);

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/u;
const LOCALE = 'id-ID';

export async function loadCatalog(path = CATALOG_PATH) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadSchema(path = SCHEMA_PATH) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Order-independent lookup key for a reagent pair. */
export function normalizePairKey(reagentA, reagentB) {
  return [reagentA, reagentB].sort().join('|');
}

/** Resolves a reaction for a reagent pair in either A/B order. */
export function findReaction(catalog, reagentA, reagentB) {
  return catalog.reactions[normalizePairKey(reagentA, reagentB)] ?? null;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function checkFormulaTerms(terms, label, elements, violations, depth = 0) {
  if (!Array.isArray(terms) || terms.length === 0) {
    violations.push(`${label} must declare at least one structural formula term`);
    return;
  }
  if (depth > 2) {
    violations.push(`${label} nests structural formula terms deeper than the catalog allows`);
    return;
  }
  for (const term of terms) {
    if (!isPositiveInteger(term?.count)) {
      violations.push(`${label} must declare a positive integer count for every structural term`);
      continue;
    }
    if (Array.isArray(term.group)) {
      checkFormulaTerms(term.group, `${label} group`, elements, violations, depth + 1);
      continue;
    }
    if (!elements.includes(term?.element)) {
      violations.push(`${label} references unknown element ${String(term?.element)}`);
    }
  }
}

function checkElementCounts(counts, label, elements, violations) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    violations.push(`${label} must declare element counts`);
    return;
  }
  for (const [element, count] of entries) {
    if (!elements.includes(element)) violations.push(`${label} references untracked element ${element}`);
    if (!isPositiveInteger(count)) violations.push(`${label} must declare a positive integer count for ${element}`);
  }
}

function checkVersions(catalog, violations) {
  if (catalog?.schemaVersion !== '1') violations.push('schemaVersion must be the supported major version "1"');
  if (!SEMANTIC_VERSION.test(catalog?.catalogVersion ?? '')) violations.push('catalogVersion must be a semantic version');
  if (catalog?.locale !== LOCALE) violations.push(`locale must be ${LOCALE}`);
  if (catalog?.digest?.algorithm !== 'sha256') violations.push('digest.algorithm must be sha256');
  if (!catalog?.digest?.valueFile) violations.push('digest.valueFile must name the generated digest artifact');
  if (!Array.isArray(catalog?.elements) || catalog.elements.length === 0) {
    violations.push('elements must list every tracked element');
  } else if (hasDuplicates(catalog.elements)) {
    violations.push('elements must not repeat an element symbol');
  }
}

function checkSpecies(catalog, violations) {
  const elements = catalog.elements ?? [];
  const formulas = [];

  for (const [key, species] of Object.entries(catalog.species ?? {})) {
    const label = `species ${key}`;
    if (species.id !== key) violations.push(`${label} must use its own id as its key`);
    if (!species.formulaAscii) violations.push(`${label} must declare formulaAscii`);
    formulas.push(species.formulaAscii);
    checkFormulaTerms(species.formulaTerms, label, elements, violations);
    checkElementCounts(species.elementCounts, label, elements, violations);
    if (!Array.isArray(species.phases) || species.phases.length === 0) {
      violations.push(`${label} must declare at least one phase`);
    } else if (hasDuplicates(species.phases)) {
      violations.push(`${label} must not repeat a phase`);
    }
    if (!species.displayName) violations.push(`${label} must declare a localized display name`);
  }

  if (hasDuplicates(formulas)) violations.push('species must not declare duplicate ASCII formulas');
}

function checkIons(catalog, violations) {
  const elements = catalog.elements ?? [];
  const ionIds = Object.keys(catalog.ions ?? {});

  for (const required of REQUIRED_ION_IDS) {
    if (!ionIds.includes(required)) violations.push(`ions must define ${required}`);
  }

  for (const [key, ion] of Object.entries(catalog.ions ?? {})) {
    const label = `ion ${key}`;
    if (ion.id !== key) violations.push(`${label} must use its own id as its key`);
    if (!Number.isInteger(ion.charge) || ion.charge === 0) {
      violations.push(`${label} must declare a nonzero integer charge`);
    } else {
      const expectedKind = ion.charge > 0 ? 'cation' : 'anion';
      if (ion.kind !== expectedKind) violations.push(`${label} must declare kind ${expectedKind} for charge ${ion.charge}`);
    }
    checkFormulaTerms(ion.formulaTerms, label, elements, violations);
    checkElementCounts(ion.elementCounts, label, elements, violations);
    if (!/^#[0-9a-f]{6}$/u.test(ion.presentation?.color ?? '')) {
      violations.push(`${label} must declare a six-digit lowercase hex presentation color`);
    }
    if (!ion.displayName) violations.push(`${label} must declare a localized display name`);
  }
}

function checkReagents(catalog, violations) {
  const reagentIds = Object.keys(catalog.reagents ?? {});
  const speciesIds = [];
  const displayOrders = [];

  for (const required of REQUIRED_REAGENT_IDS) {
    if (!reagentIds.includes(required)) violations.push(`reagents must define ${required}`);
  }
  for (const id of reagentIds) {
    if (!REQUIRED_REAGENT_IDS.includes(id)) violations.push(`reagents must not define unsupported reagent ${id}`);
  }

  for (const [key, reagent] of Object.entries(catalog.reagents ?? {})) {
    const label = `reagent ${key}`;
    if (reagent.id !== key) violations.push(`${label} must use its own id as its key`);
    if (reagent.selectable !== true) violations.push(`${label} must be selectable in version 1`);
    if (reagent.phase !== 'aq') violations.push(`${label} must be an aqueous solution in version 1`);
    if (!catalog.species?.[reagent.speciesId]) {
      violations.push(`${label} references unknown species ${String(reagent.speciesId)}`);
    } else if (!catalog.species[reagent.speciesId].phases?.includes('aq')) {
      violations.push(`${label} references species ${reagent.speciesId} that is not aqueous`);
    }
    speciesIds.push(reagent.speciesId);
    displayOrders.push(reagent.displayOrder);
    if (!Array.isArray(reagent.roles) || reagent.roles.length === 0) {
      violations.push(`${label} must declare at least one role`);
    }
    if (!/^#[0-9a-f]{6}$/u.test(reagent.presentation?.solutionColor ?? '')) {
      violations.push(`${label} must declare a six-digit lowercase hex solution color`);
    }

    const terms = Array.isArray(reagent.ions) ? reagent.ions : [];
    if (terms.length < 2) {
      violations.push(`${label} must dissociate into at least two ions`);
      continue;
    }
    if (hasDuplicates(terms.map((term) => term.ionId))) {
      violations.push(`${label} must not repeat an ion in its dissociation terms`);
    }

    let netCharge = 0;
    for (const term of terms) {
      const ion = catalog.ions?.[term.ionId];
      if (!ion) {
        violations.push(`${label} references unknown ion ${String(term.ionId)}`);
        continue;
      }
      if (!isPositiveInteger(term.multiplicity)) {
        violations.push(`${label} must declare a positive integer multiplicity for ${term.ionId}`);
        continue;
      }
      netCharge += ion.charge * term.multiplicity;
    }
    if (netCharge !== 0) {
      violations.push(`${label} dissociation terms must be electroneutral but sum to ${netCharge}`);
    }
  }

  if (hasDuplicates(speciesIds)) violations.push('reagents must not share a species definition');
  if (hasDuplicates(displayOrders)) violations.push('reagents must not share a display order');
}

function checkReactionTerms(catalog, terms, label, violations) {
  if (!Array.isArray(terms) || terms.length === 0) {
    violations.push(`${label} must declare at least one term`);
    return;
  }
  if (hasDuplicates(terms.map((term) => term.speciesId))) {
    violations.push(`${label} must not repeat a species`);
  }
  for (const term of terms) {
    const definition = catalog.species?.[term.speciesId] ?? catalog.ions?.[term.speciesId];
    if (!definition) {
      violations.push(`${label} references unknown species ${String(term.speciesId)}`);
      continue;
    }
    if (!isPositiveInteger(term.coefficient)) {
      violations.push(`${label} must declare a positive integer coefficient for ${term.speciesId}`);
    }
    if (!definition.phases?.includes(term.phase)) {
      violations.push(`${label} uses phase ${String(term.phase)} that ${term.speciesId} does not declare`);
    }
  }
}

function checkReactions(catalog, violations) {
  const reactionKeys = Object.keys(catalog.reactions ?? {});
  const reactionIds = [];
  const normalizedSets = [];

  for (const [reagentA, reagentB] of REQUIRED_REAGENT_PAIRS) {
    const key = normalizePairKey(reagentA, reagentB);
    if (!reactionKeys.includes(key)) violations.push(`reactions must define the supported pair ${key}`);
  }

  for (const [key, reaction] of Object.entries(catalog.reactions ?? {})) {
    const label = `reaction ${key}`;
    reactionIds.push(reaction.id);

    const reactantSet = Array.isArray(reaction.reactantSet) ? reaction.reactantSet : [];
    if (reactantSet.length !== 2) {
      violations.push(`${label} must declare exactly two reagents`);
    } else {
      const normalized = normalizePairKey(reactantSet[0], reactantSet[1]);
      normalizedSets.push(normalized);
      if (normalized !== key) violations.push(`${label} must be keyed by its normalized reagent pair ${normalized}`);
      for (const reagentId of reactantSet) {
        if (!catalog.reagents?.[reagentId]) violations.push(`${label} references unknown reagent ${String(reagentId)}`);
      }
    }

    if (!['precipitation', 'strong_acid_base'].includes(reaction.category)) {
      violations.push(`${label} must declare a supported category`);
    }
    if (!reaction.displayName) violations.push(`${label} must declare a localized display name`);
    if (!catalog.model?.phaseModels?.[reaction.phaseModel]) {
      violations.push(`${label} references unknown phase model ${String(reaction.phaseModel)}`);
    }

    checkReactionTerms(catalog, reaction.molecularReactants, `${label} molecular reactants`, violations);
    checkReactionTerms(catalog, reaction.molecularProducts, `${label} molecular products`, violations);
    checkReactionTerms(catalog, reaction.netIonicReactants, `${label} net ionic reactants`, violations);
    checkReactionTerms(catalog, reaction.netIonicProducts, `${label} net ionic products`, violations);

    const releasedIons = new Set(
      reactantSet.flatMap((reagentId) => (catalog.reagents?.[reagentId]?.ions ?? []).map((term) => term.ionId)),
    );
    const netIonicIons = new Set((reaction.netIonicReactants ?? []).map((term) => term.speciesId));
    const spectators = Array.isArray(reaction.spectatorIons) ? reaction.spectatorIons : [];
    if (hasDuplicates(spectators)) violations.push(`${label} must not repeat a spectator ion`);
    for (const ionId of spectators) {
      if (!catalog.ions?.[ionId]) violations.push(`${label} references unknown spectator ion ${String(ionId)}`);
      if (!releasedIons.has(ionId)) violations.push(`${label} declares spectator ${ionId} that its reagents never release`);
      if (netIonicIons.has(ionId)) violations.push(`${label} declares spectator ${ionId} that the net ionic equation consumes`);
    }
    for (const ionId of releasedIons) {
      if (!netIonicIons.has(ionId) && !spectators.includes(ionId)) {
        violations.push(`${label} must classify released ion ${ionId} as a reactant or a spectator`);
      }
    }

    const presentation = reaction.presentation ?? {};
    if (!/^#[0-9a-f]{6}$/u.test(presentation.solutionColor ?? '')) {
      violations.push(`${label} must declare a six-digit lowercase hex solution color`);
    }
    if (!['clear', 'cloudy'].includes(presentation.appearance)) {
      violations.push(`${label} must declare a supported appearance`);
    }
    if (!catalog.model?.capabilities?.energy?.labels?.includes(presentation.energyLabel)) {
      violations.push(`${label} must declare a supported energy label`);
    }

    if (reaction.category === 'precipitation') {
      const precipitateId = presentation.precipitateSpeciesId;
      const precipitate = catalog.species?.[precipitateId];
      if (!precipitate) {
        violations.push(`${label} must name a precipitate species`);
      } else {
        if (precipitate.solubility !== 'insoluble') violations.push(`${label} precipitate ${precipitateId} must be insoluble`);
        const solidProduct = (reaction.molecularProducts ?? []).some(
          (term) => term.speciesId === precipitateId && term.phase === 's',
        );
        const netIonicProduct = (reaction.netIonicProducts ?? []).some((term) => term.speciesId === precipitateId);
        if (!solidProduct) violations.push(`${label} must produce ${precipitateId} as a solid in its molecular equation`);
        if (!netIonicProduct) violations.push(`${label} must produce ${precipitateId} in its net ionic equation`);
      }
      if (!/^#[0-9a-f]{6}$/u.test(presentation.precipitateColor ?? '')) {
        violations.push(`${label} must declare a precipitate color`);
      }
      if (reaction.phaseModel !== 'aqueous_with_solid') {
        violations.push(`${label} must use the aqueous_with_solid phase model`);
      }
      if (reaction.pH !== null) violations.push(`${label} must not claim a quantitative pH model`);
      if (!catalog.model?.capabilities?.pH?.unsupportedReasons?.[reaction.pHUnsupportedReasonCode]) {
        violations.push(`${label} must declare a known pH unsupported reason code`);
      }
    }

    if (reaction.category === 'strong_acid_base') {
      if (reaction.phaseModel !== 'homogeneous_aqueous') {
        violations.push(`${label} must stay in one homogeneous aqueous phase`);
      }
      if (presentation.precipitateSpeciesId !== null || presentation.precipitateColor !== null) {
        violations.push(`${label} must not declare a precipitate`);
      }
      const pH = reaction.pH;
      if (!pH) {
        violations.push(`${label} must declare its supported pH model`);
      } else {
        if (pH.modelId !== catalog.model?.capabilities?.pH?.modelId) {
          violations.push(`${label} must reference the declared pH model id`);
        }
        if (!reactantSet.includes(pH.acidReagentId)) violations.push(`${label} pH model must reference its own acid reagent`);
        if (!reactantSet.includes(pH.baseReagentId)) violations.push(`${label} pH model must reference its own base reagent`);
        if (!catalog.reagents?.[pH.acidReagentId]?.roles?.includes('strong-acid')) {
          violations.push(`${label} pH model must use a strong-acid reagent`);
        }
        if (!catalog.reagents?.[pH.baseReagentId]?.roles?.includes('strong-base')) {
          violations.push(`${label} pH model must use a strong-base reagent`);
        }
        if (!catalog.ions?.[pH.protonIonId] || !catalog.ions?.[pH.hydroxideIonId]) {
          violations.push(`${label} pH model must reference known proton and hydroxide ions`);
        }
      }
      if (reaction.pHUnsupportedReasonCode !== null) {
        violations.push(`${label} must not declare a pH unsupported reason while pH is supported`);
      }
    }

    const tags = Array.isArray(reaction.targetTags) ? reaction.targetTags : [];
    if (tags.length === 0) violations.push(`${label} must declare at least one inverse target tag`);
    if (hasDuplicates(tags)) violations.push(`${label} must not repeat an inverse target tag`);
    for (const tag of tags) {
      const target = catalog.inverseTargets?.[tag];
      if (!target) {
        violations.push(`${label} references unknown inverse target tag ${tag}`);
        continue;
      }
      if (!target.reactionIds?.includes(reaction.id)) {
        violations.push(`inverse target ${tag} must list reaction ${reaction.id} that declares it`);
      }
    }
  }

  for (const required of REQUIRED_REACTION_IDS) {
    if (!reactionIds.includes(required)) violations.push(`reactions must define ${required}`);
  }
  if (hasDuplicates(reactionIds)) violations.push('reactions must not share a reaction id');
  if (hasDuplicates(normalizedSets)) violations.push('reactions must not define duplicate normalized reagent pairs');
}

function checkInverseTargets(catalog, violations) {
  const reactionsById = new Map(Object.values(catalog.reactions ?? {}).map((reaction) => [reaction.id, reaction]));
  const supportedKinds = catalog.model?.capabilities?.inverse?.supportedGoalKinds ?? [];

  for (const [key, target] of Object.entries(catalog.inverseTargets ?? {})) {
    const label = `inverse target ${key}`;
    if (target.id !== key) violations.push(`${label} must use its own id as its key`);
    if (!supportedKinds.includes(target.kind)) violations.push(`${label} must declare a supported goal kind`);
    if (!target.descriptionKey) violations.push(`${label} must declare a localized description key`);

    const reactionIds = Array.isArray(target.reactionIds) ? target.reactionIds : [];
    if (reactionIds.length === 0) violations.push(`${label} must reference at least one reaction`);
    if (hasDuplicates(reactionIds)) violations.push(`${label} must not repeat a reaction`);
    for (const reactionId of reactionIds) {
      const reaction = reactionsById.get(reactionId);
      if (!reaction) {
        violations.push(`${label} references unknown reaction ${reactionId}`);
        continue;
      }
      if (!reaction.targetTags?.includes(key)) violations.push(`${label} references reaction ${reactionId} that does not declare it`);
    }

    if (target.kind === 'precipitate_identity') {
      if (!catalog.species?.[target.speciesId]) violations.push(`${label} must name a known precipitate species`);
      if (!target.colorName) violations.push(`${label} must name the observed precipitate color`);
      if (target.targetPH !== null) violations.push(`${label} must not declare a target pH`);
    }
    if (target.kind === 'precipitate_color') {
      if (!target.colorName) violations.push(`${label} must name the observed precipitate color`);
      if (target.speciesId !== null) violations.push(`${label} must not bind a single precipitate species`);
      if (target.targetPH !== null) violations.push(`${label} must not declare a target pH`);
    }
    if (target.kind === 'target_ph') {
      if (typeof target.targetPH !== 'number' || !Number.isFinite(target.targetPH)) {
        violations.push(`${label} must declare a finite target pH`);
      }
      if (target.speciesId !== null) violations.push(`${label} must not bind a precipitate species`);
    }
  }
}

/**
 * Every calculated quantity the catalog must declare a display precision for.
 *
 * Declaring the precision in the catalog is what keeps rounding confined to the
 * formatter projections: the evaluator has no precision to apply, and the two
 * formatter implementations read the same declared digits.
 */
export const REQUIRED_DISPLAY_QUANTITIES = Object.freeze([
  'amount_mol',
  'concentration_molL',
  'extent_mol',
  'pH',
  'volume_L',
  'volume_mL',
]);

function checkDisplay(catalog, violations) {
  const display = catalog.model?.display;
  if (!display) {
    violations.push('model.display must declare the display precision of every calculated quantity');
    return;
  }

  if (display.roundingMode !== 'half_away_from_zero') {
    violations.push('model.display must declare the half_away_from_zero rounding mode shared by both formatters');
  }
  if (display.decimalSeparator !== '.') {
    violations.push('model.display must declare the "." decimal separator both formatters emit');
  }

  const quantities = display.quantities ?? {};
  for (const name of REQUIRED_DISPLAY_QUANTITIES) {
    const quantity = quantities[name];
    if (!quantity) {
      violations.push(`model.display.quantities must declare ${name}`);
      continue;
    }
    if (!Number.isInteger(quantity.precision) || quantity.precision < 0) {
      violations.push(`model.display.quantities.${name} must declare a nonnegative integer precision`);
    }
    if (!(quantity.unit === null || (typeof quantity.unit === 'string' && quantity.unit.length > 0))) {
      violations.push(`model.display.quantities.${name} must declare a unit label or an explicit null`);
    }
  }
  for (const name of Object.keys(quantities)) {
    if (!REQUIRED_DISPLAY_QUANTITIES.includes(name)) {
      violations.push(`model.display.quantities declares unsupported quantity ${name}`);
    }
  }

  // Two declarations of the same number would let a display projection and the
  // pH capability drift apart, so they are pinned to each other.
  const capabilityPrecision = catalog.model?.capabilities?.pH?.displayPrecision;
  if (quantities.pH && quantities.pH.precision !== capabilityPrecision) {
    violations.push('model.display.quantities.pH precision must equal model.capabilities.pH.displayPrecision');
  }
}

function checkModel(catalog, violations) {
  const model = catalog.model ?? {};
  const capabilities = model.capabilities ?? {};

  if (!SEMANTIC_VERSION.test(model.modelVersion ?? '')) violations.push('model.modelVersion must be a semantic version');
  for (const category of ['precipitation', 'strong_acid_base', 'no_modeled_reaction']) {
    if (!model.categories?.includes(category)) violations.push(`model.categories must declare ${category}`);
  }

  for (const [name, value] of Object.entries(model.tolerances ?? {})) {
    if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      violations.push(`model.tolerances.${name} must be a finite positive number`);
    }
  }
  for (const name of ['amount_mol', 'charge', 'elementCount', 'equivalence_mol', 'pH']) {
    if (model.tolerances?.[name] === undefined) violations.push(`model.tolerances must declare ${name}`);
  }

  for (const name of ['concentration_molL', 'volume_mL', 'temperature_C', 'pressure_atm']) {
    const bound = model.bounds?.[name];
    if (!bound) {
      violations.push(`model.bounds must declare ${name}`);
      continue;
    }
    if (![bound.minimum, bound.maximum, bound.default].every((value) => Number.isFinite(value))) {
      violations.push(`model.bounds.${name} must declare finite minimum, maximum, and default values`);
      continue;
    }
    if (bound.minimum > bound.maximum) violations.push(`model.bounds.${name} minimum must not exceed its maximum`);
    if (bound.default < bound.minimum || bound.default > bound.maximum) {
      violations.push(`model.bounds.${name} default must stay inside its range`);
    }
  }
  for (const name of ['concentration_molL', 'volume_mL']) {
    if (!(model.bounds?.[name]?.minimum > 0)) violations.push(`model.bounds.${name} must require a positive quantity`);
  }

  checkDisplay(catalog, violations);

  const temperature = capabilities.temperature ?? {};
  if (temperature.effect !== 'qualitative_motion_only') {
    violations.push('model temperature capability must stay qualitative in version 1');
  }
  for (const flag of ['affectsExtent', 'affectsRateConstant', 'affectsPH']) {
    if (temperature[flag] !== false) violations.push(`model temperature capability must declare ${flag} false`);
  }
  const motion = temperature.motionSpeedFactor ?? {};
  if (!(motion.atMinimum > 0) || !(motion.atMaximum > motion.atMinimum)) {
    violations.push('model temperature motion factor must be a bounded increasing range');
  }

  const pressure = capabilities.pressure ?? {};
  if (pressure.effect !== 'none') violations.push('model pressure capability must declare no modeled effect');
  if (pressure.fixed_atm !== 1) violations.push('model pressure capability must fix pressure at 1 atm');
  if (pressure.selectable !== false) violations.push('model pressure capability must not be selectable');
  if (pressure.acceptsAlternateValues !== false) {
    violations.push('model pressure capability must not accept alternate pressure values');
  }
  if (model.bounds?.pressure_atm?.minimum !== 1 || model.bounds?.pressure_atm?.maximum !== 1) {
    violations.push('model.bounds.pressure_atm must be fixed at 1 atm');
  }

  const pH = capabilities.pH ?? {};
  if (!(pH.pKw > 0)) violations.push('model pH capability must declare a positive pKw');
  if (pH.neutralPH !== pH.pKw / 2) violations.push('model pH neutral point must equal pKw/2 under the declared ideal model');
  if (pH.temperatureCorrected !== false || pH.pKwSource !== 'standard_temperature_25C') {
    violations.push('model pH capability must state that version 1 uses the documented standard-temperature pKw');
  }
  if (!Number.isInteger(pH.displayPrecision) || pH.displayPrecision < 0) {
    violations.push('model pH capability must declare a nonnegative display precision');
  }
  const reactionIds = new Set(Object.values(catalog.reactions ?? {}).map((reaction) => reaction.id));
  for (const reactionId of pH.supportedReactionIds ?? []) {
    if (!reactionIds.has(reactionId)) violations.push(`model pH capability references unknown reaction ${reactionId}`);
  }
  const supportedByReaction = Object.values(catalog.reactions ?? {})
    .filter((reaction) => reaction.pH !== null)
    .map((reaction) => reaction.id)
    .sort();
  if (supportedByReaction.join(',') !== [...(pH.supportedReactionIds ?? [])].sort().join(',')) {
    violations.push('model pH supported reactions must match the reactions that declare a pH model');
  }
  for (const pair of pH.supportedReagentPairs ?? []) {
    const key = normalizePairKey(pair[0], pair[1]);
    const reaction = catalog.reactions?.[key];
    if (!reaction) violations.push(`model pH capability references unsupported reagent pair ${key}`);
    else if (reaction.pH === null) violations.push(`model pH capability references pair ${key} without a pH model`);
  }
  for (const [code, reason] of Object.entries(pH.unsupportedReasons ?? {})) {
    if (!reason?.messageKey) violations.push(`model pH unsupported reason ${code} must declare a message key`);
  }

  if (capabilities.energy?.quantitativeEnthalpy !== false) {
    violations.push('model energy capability must stay qualitative');
  }
  const visualization = capabilities.visualization ?? {};
  if (visualization.quantitative !== false) violations.push('model visualization capability must be non-quantitative');
  if (visualization.affectsResult !== false) violations.push('model visualization capability must not affect results');
  const budget = visualization.particleBudget ?? {};
  if (!isPositiveInteger(budget.minimum) || !isPositiveInteger(budget.default) || !isPositiveInteger(budget.maximum)) {
    violations.push('model visualization particle budget must use positive integers');
  } else if (budget.minimum > budget.default || budget.default > budget.maximum) {
    violations.push('model visualization particle budget default must stay inside its range');
  }

  const inverse = capabilities.inverse ?? {};
  if (inverse.defaultRecommendation !== null) {
    violations.push('model inverse capability must not declare a default recommendation');
  }
  if (!isPositiveInteger(inverse.maximumCandidates)) {
    violations.push('model inverse capability must bound its candidate count');
  }

  for (const [name, phaseModel] of Object.entries(model.phaseModels ?? {})) {
    if (phaseModel.layered !== false) violations.push(`model phase model ${name} must not declare a layer boundary`);
    if (!Array.isArray(phaseModel.phases) || phaseModel.phases.length === 0) {
      violations.push(`model phase model ${name} must declare its phases`);
    }
  }
  if (!Array.isArray(model.immisciblePairs) || model.immisciblePairs.length !== 0) {
    violations.push('model.immisciblePairs must stay empty until an immiscibility model is declared');
  }

  const noReaction = model.unsupportedOutcomes?.noModeledReaction ?? {};
  if (noReaction.category !== 'no_modeled_reaction') {
    violations.push('model unsupported outcome must declare the no_modeled_reaction category');
  }
  if (noReaction.phaseModel !== 'homogeneous_aqueous') {
    violations.push('model unsupported outcome must keep unmatched pairs in one homogeneous aqueous phase');
  }
  if (noReaction.presentation?.precipitateSpeciesId !== null) {
    violations.push('model unsupported outcome must not declare a precipitate');
  }
  if (!model.unsupportedOutcomes?.outsideCatalogCapability?.reasonCode) {
    violations.push('model unsupported outcome must declare an outside-capability reason code');
  }
}

function collectMessageKeys(value, keys) {
  if (Array.isArray(value)) {
    for (const item of value) collectMessageKeys(item, keys);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) {
      if ((name === 'messageKey' || name === 'descriptionKey' || name === 'scaleDisclosureKey') && typeof item === 'string') {
        keys.add(item);
      } else {
        collectMessageKeys(item, keys);
      }
    }
  }
}

function checkMessages(catalog, violations) {
  const messages = catalog.messages?.[LOCALE];
  if (!messages || typeof messages !== 'object') {
    violations.push(`messages must provide the ${LOCALE} bundle`);
    return;
  }

  const referenced = new Set();
  collectMessageKeys({ ...catalog, messages: undefined }, referenced);

  for (const key of referenced) {
    const text = messages[key];
    if (typeof text !== 'string' || text.trim().length === 0) {
      violations.push(`messages.${LOCALE} must provide localized text for ${key}`);
    }
  }
  for (const key of Object.keys(messages)) {
    if (!referenced.has(key)) violations.push(`messages.${LOCALE} declares unreferenced key ${key}`);
  }
}

/**
 * Collects every definition-level violation. An empty array means the catalog
 * covers the required version 1 definitions with no malformed, dangling, or
 * duplicate entry.
 */
export function collectDefinitionViolations(catalog) {
  const violations = [];
  if (!catalog || typeof catalog !== 'object') return ['catalog must be an object'];

  checkVersions(catalog, violations);
  checkSpecies(catalog, violations);
  checkIons(catalog, violations);
  checkReagents(catalog, violations);
  checkReactions(catalog, violations);
  checkInverseTargets(catalog, violations);
  checkModel(catalog, violations);
  checkMessages(catalog, violations);

  return violations;
}
