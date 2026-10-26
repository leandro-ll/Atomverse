/**
 * Display formatters for the canonical chemistry catalog.
 *
 * The catalog stores chemistry *structurally*: `formulaTerms` with integer
 * counts and nested groups, equations as species terms with positive integer
 * coefficients and phases, and model boundaries as localized message keys. It
 * deliberately stores no Unicode formula and no equation string, so there is
 * exactly one place where a display value can be produced: this module.
 *
 * Every string a learner reads about a formula, an equation, or a model
 * boundary is derived here from validated catalog terms. Nothing is looked up
 * from a parallel handwritten table, which is what made malformed values such
 * as `AgNO` or `Pb(NO)2` possible before.
 *
 * The formatters are pure: no DOM, clock, random, network, provider, or mutable
 * global dependency, and no rounding of scientific quantities. They read the
 * deeply frozen generated binding by default, and accept an explicit catalog so
 * tests can format a mutated copy.
 *
 * The backend parity implementation is `backend/app/domain/chemistry_formatters.py`
 * and must produce byte-identical output for the same catalog.
 */

import { CATALOG } from '../generated/chemistry-catalog.js';

const SUBSCRIPT_DIGITS = ['\u2080', '\u2081', '\u2082', '\u2083', '\u2084', '\u2085', '\u2086', '\u2087', '\u2088', '\u2089'];
const SUPERSCRIPT_DIGITS = ['\u2070', '\u00b9', '\u00b2', '\u00b3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079'];

/** Superscript plus sign used by cation charges. */
export const SUPERSCRIPT_PLUS = '\u207a';
/** Superscript minus sign used by anion charges. */
export const SUPERSCRIPT_MINUS = '\u207b';
/** Separator between the two sides of an equation. */
export const REACTION_ARROW = '\u2192';
/** Separator between terms on one side of an equation. */
export const TERM_SEPARATOR = ' + ';

/** Phase annotation for every phase the catalog declares. */
export const PHASE_LABELS = Object.freeze({
  aq: '(aq)',
  s: '(s)',
  l: '(l)',
  g: '(g)',
});

/** Capability boundaries that expose a localized model-boundary message. */
export const CAPABILITY_BOUNDARY_KEYS = Object.freeze({
  temperature: 'messageKey',
  pressure: 'messageKey',
  energy: 'messageKey',
  inverse: 'messageKey',
  visualization: 'scaleDisclosureKey',
});

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, received ${String(value)}`);
  }
  return value;
}

function mapDigits(value, alphabet) {
  return String(value)
    .split('')
    .map((digit) => alphabet[Number(digit)])
    .join('');
}

/** Renders a positive integer count as Unicode subscript digits. */
export function formatSubscript(count) {
  return mapDigits(requirePositiveInteger(count, 'subscript count'), SUBSCRIPT_DIGITS);
}

/**
 * Renders an ion charge as a Unicode superscript magnitude and sign, omitting
 * the magnitude when it is one: `1` becomes `+`, `-2` becomes `2-`.
 */
export function formatChargeSuperscript(charge) {
  if (charge === 0 || charge === undefined || charge === null) return '';
  if (!Number.isInteger(charge)) {
    throw new RangeError(`charge must be an integer, received ${String(charge)}`);
  }
  const sign = charge > 0 ? SUPERSCRIPT_PLUS : SUPERSCRIPT_MINUS;
  const magnitude = Math.abs(charge);
  return magnitude === 1 ? sign : `${mapDigits(magnitude, SUPERSCRIPT_DIGITS)}${sign}`;
}

/**
 * Renders structural formula terms as a Unicode formula.
 *
 * A term is either an element with a count or a parenthesized group with a
 * count. Counts of one are implicit, which is what turns the structural
 * `Pb` + group(`N`,`O3`)×2 into `Pb(NO3)2`.
 */
export function formatFormulaTerms(terms) {
  if (!Array.isArray(terms) || terms.length === 0) {
    throw new TypeError('formula terms must be a non-empty array');
  }
  return terms
    .map((term) => {
      const count = requirePositiveInteger(term?.count, 'formula term count');
      const suffix = count === 1 ? '' : formatSubscript(count);
      if (Array.isArray(term.group)) return `(${formatFormulaTerms(term.group)})${suffix}`;
      if (typeof term?.element !== 'string' || term.element.length === 0) {
        throw new TypeError(`formula term must declare an element or a group, received ${JSON.stringify(term)}`);
      }
      return `${term.element}${suffix}`;
    })
    .join('');
}

/** Renders the phase annotation of an equation term. */
export function formatPhase(phase) {
  const label = PHASE_LABELS[phase];
  if (label === undefined) throw new RangeError(`unknown phase ${String(phase)}`);
  return label;
}

/** Order-independent reagent pair key: both identifiers sorted and pipe joined. */
export function normalizePairKey(reagentA, reagentB) {
  return [reagentA, reagentB].sort().join('|');
}

/**
 * The only rounding mode the display layer implements.
 *
 * It is stated explicitly rather than delegated to `toFixed`, because the
 * language defaults disagree: JavaScript's `toFixed` rounds the binary value
 * and Python's `format`/`round` round half to even, so the same quantity would
 * print differently on the two halves of the pair.
 */
export const HALF_AWAY_FROM_ZERO = 'half_away_from_zero';

/** Rounding modes a catalog may declare for display. */
export const SUPPORTED_ROUNDING_MODES = Object.freeze([HALF_AWAY_FROM_ZERO]);

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${String(value)}`);
  }
  return value;
}

function requireDisplayPrecision(precision, label) {
  if (!Number.isInteger(precision) || precision < 0) {
    throw new RangeError(`${label} must be a nonnegative integer, received ${String(precision)}`);
  }
  return precision;
}

/**
 * Shortest round-trip significant digits of a finite magnitude, plus the
 * decimal exponent of its leading digit: `magnitude = 0.digits × 10^(exponent+1)`.
 *
 * Rounding is performed on these decimal digits so that both language halves
 * round the same digit string rather than two different binary expansions.
 */
function significantDigits(magnitude) {
  const [mantissa, exponentText] = magnitude.toExponential().split('e');
  return { digits: mantissa.replace('.', ''), exponent: Number(exponentText) };
}

/** Adds one to a digit string, growing it by a leading `1` on full carry. */
function incrementDigits(digits) {
  const out = digits.split('');
  for (let index = out.length - 1; index >= 0; index -= 1) {
    if (out[index] === '9') {
      out[index] = '0';
      continue;
    }
    out[index] = String(Number(out[index]) + 1);
    return out.join('');
  }
  return `1${out.join('')}`;
}

/** Positional integer and fraction digits of `digits × 10^(exponent - …)`. */
function splitPositional(digits, exponent) {
  const pointPosition = exponent + 1;
  if (pointPosition <= 0) {
    return { integerDigits: '0', fractionDigits: '0'.repeat(-pointPosition) + digits };
  }
  if (pointPosition >= digits.length) {
    return { integerDigits: digits + '0'.repeat(pointPosition - digits.length), fractionDigits: '' };
  }
  return { integerDigits: digits.slice(0, pointPosition), fractionDigits: digits.slice(pointPosition) };
}

/**
 * Renders a finite number at a fixed number of decimal places, rounding half
 * away from zero on the decimal digits.
 *
 * A value that rounds to zero loses its sign, so an excess amount of `-1e-18`
 * prints as `0.0000` rather than as the nonsense `-0.0000`.
 */
export function formatFixed(value, precision, decimalSeparator = '.') {
  requireFiniteNumber(value, 'display value');
  requireDisplayPrecision(precision, 'display precision');

  let negative = value < 0 || Object.is(value, -0);
  const { digits, exponent } = significantDigits(Math.abs(value));
  let { integerDigits, fractionDigits } = splitPositional(digits, exponent);

  if (fractionDigits.length <= precision) {
    fractionDigits = fractionDigits.padEnd(precision, '0');
  } else {
    const kept = fractionDigits.slice(0, precision);
    if (fractionDigits[precision] >= '5') {
      const carried = incrementDigits(`${integerDigits}${kept}`);
      integerDigits = carried.slice(0, carried.length - precision);
      fractionDigits = carried.slice(carried.length - precision);
    } else {
      fractionDigits = kept;
    }
  }

  integerDigits = integerDigits.replace(/^0+(?=\d)/u, '');
  if (!/[1-9]/u.test(`${integerDigits}${fractionDigits}`)) negative = false;

  const fraction = precision > 0 ? `${decimalSeparator}${fractionDigits}` : '';
  return `${negative ? '-' : ''}${integerDigits}${fraction}`;
}

/**
 * Rounds a value half away from zero to a number of decimal places.
 *
 * The result is a *display* value. It is deliberately not produced inside the
 * evaluator: feeding it back into extent, excess, pH, or the species ledger is
 * exactly the precision leak requirement 3.7 forbids.
 */
export function roundHalfAwayFromZero(value, precision) {
  return Number(formatFixed(value, precision, '.'));
}

/**
 * Builds the formatter adapter for one catalog.
 *
 * Every method throws on an unknown identifier instead of returning a
 * placeholder, so a drifted reference fails loudly in tests rather than
 * rendering a silently wrong formula.
 */
export function createChemistryFormatters(catalog = CATALOG) {
  if (!catalog || typeof catalog !== 'object') throw new TypeError('catalog must be an object');

  const locale = catalog.locale;
  const messages = catalog.messages?.[locale] ?? {};

  const requireSpecies = (speciesId) => {
    const species = catalog.species?.[speciesId];
    if (!species) throw new RangeError(`unknown species ${String(speciesId)}`);
    return species;
  };

  const requireIon = (ionId) => {
    const ion = catalog.ions?.[ionId];
    if (!ion) throw new RangeError(`unknown ion ${String(ionId)}`);
    return ion;
  };

  const requireDefinition = (definitionId) => {
    const definition = catalog.species?.[definitionId] ?? catalog.ions?.[definitionId];
    if (!definition) throw new RangeError(`unknown species or ion ${String(definitionId)}`);
    return definition;
  };

  const requireReagent = (reagentId) => {
    const reagent = catalog.reagents?.[reagentId];
    if (!reagent) throw new RangeError(`unknown reagent ${String(reagentId)}`);
    return reagent;
  };

  /** Formats a species or ion formula, including an ion's charge. */
  const formatFormula = (definitionId) => {
    const definition = requireDefinition(definitionId);
    return `${formatFormulaTerms(definition.formulaTerms)}${formatChargeSuperscript(definition.charge)}`;
  };

  const formatSpeciesFormula = (speciesId) => formatFormulaTerms(requireSpecies(speciesId).formulaTerms);

  const formatIonFormula = (ionId) => {
    const ion = requireIon(ionId);
    return `${formatFormulaTerms(ion.formulaTerms)}${formatChargeSuperscript(ion.charge)}`;
  };

  const formatDisplayName = (definitionId) => requireDefinition(definitionId).displayName;

  /** Display facts of one ion: formula, localized name, charge, and color. */
  const describeIon = (ionId) => {
    const ion = requireIon(ionId);
    return Object.freeze({
      ionId: ion.id,
      formula: formatIonFormula(ionId),
      displayName: ion.displayName,
      charge: ion.charge,
      kind: ion.kind,
      color: ion.presentation.color,
    });
  };

  const formatReagentFormula = (reagentId) => formatSpeciesFormula(requireReagent(reagentId).speciesId);

  /** Control-label form of a reagent: `AgNO3 (Perak Nitrat)`. */
  const formatReagentLabel = (reagentId) => {
    const reagent = requireReagent(reagentId);
    return `${formatReagentFormula(reagentId)} (${formatDisplayName(reagent.speciesId)})`;
  };

  /** Every selectable reagent in catalog display order, with derived labels. */
  const listReagents = () =>
    Object.freeze(
      Object.values(catalog.reagents ?? {})
        .filter((reagent) => reagent.selectable)
        .slice()
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((reagent) =>
          Object.freeze({
            reagentId: reagent.id,
            speciesId: reagent.speciesId,
            formula: formatReagentFormula(reagent.id),
            displayName: formatDisplayName(reagent.speciesId),
            label: formatReagentLabel(reagent.id),
            phase: reagent.phase,
            solutionColor: reagent.presentation.solutionColor,
            ions: Object.freeze(
              reagent.ions.map((term) =>
                Object.freeze({
                  ionId: term.ionId,
                  multiplicity: term.multiplicity,
                  formula: formatIonFormula(term.ionId),
                  displayName: formatDisplayName(term.ionId),
                  color: requireIon(term.ionId).presentation.color,
                }),
              ),
            ),
          }),
        ),
    );

  /** Formats one equation term: `2NaCl(aq)`, coefficients of one implicit. */
  const formatTerm = (term) => {
    const coefficient = requirePositiveInteger(term?.coefficient, 'term coefficient');
    const prefix = coefficient === 1 ? '' : String(coefficient);
    return `${prefix}${formatFormula(term.speciesId)}${formatPhase(term.phase)}`;
  };

  const formatEquationSide = (terms) => {
    if (!Array.isArray(terms) || terms.length === 0) {
      throw new TypeError('an equation side must declare at least one term');
    }
    return terms.map(formatTerm).join(TERM_SEPARATOR);
  };

  /** Resolves a reaction record from a pair key, a reaction id, or the record. */
  const resolveReaction = (reference) => {
    if (reference && typeof reference === 'object') return reference;
    const byPairKey = catalog.reactions?.[reference];
    if (byPairKey) return byPairKey;
    const byId = Object.values(catalog.reactions ?? {}).find((reaction) => reaction.id === reference);
    if (byId) return byId;
    throw new RangeError(`unknown reaction ${String(reference)}`);
  };

  /** Resolves the modeled reaction for a reagent pair in either A/B order. */
  const findReaction = (reagentA, reagentB) => {
    requireReagent(reagentA);
    requireReagent(reagentB);
    return catalog.reactions?.[normalizePairKey(reagentA, reagentB)] ?? null;
  };

  /**
   * Formats an equation from its structural sides.
   *
   * `energyTerm` appends a caller-supplied localized energy word to the product
   * side of an exothermic reaction, keeping the energy label out of the
   * balanced chemistry itself.
   */
  const formatEquation = (reactants, products, { energyTerm = null, exothermic = false } = {}) => {
    const productSide =
      energyTerm && exothermic ? `${formatEquationSide(products)}${TERM_SEPARATOR}${energyTerm}` : formatEquationSide(products);
    return `${formatEquationSide(reactants)} ${REACTION_ARROW} ${productSide}`;
  };

  const formatMolecularEquation = (reference, options = {}) => {
    const reaction = resolveReaction(reference);
    return formatEquation(reaction.molecularReactants, reaction.molecularProducts, {
      ...options,
      exothermic: reaction.presentation?.energyLabel === 'exothermic',
    });
  };

  const formatNetIonicEquation = (reference, options = {}) => {
    const reaction = resolveReaction(reference);
    return formatEquation(reaction.netIonicReactants, reaction.netIonicProducts, {
      ...options,
      exothermic: reaction.presentation?.energyLabel === 'exothermic',
    });
  };

  /**
   * Product formulas of a reaction without phase annotations, for compact
   * labels such as a result caption: `NaCl + H2O`.
   */
  const formatProductSummary = (reference) => {
    const reaction = resolveReaction(reference);
    return reaction.molecularProducts
      .map((term) => {
        const coefficient = requirePositiveInteger(term.coefficient, 'term coefficient');
        const prefix = coefficient === 1 ? '' : String(coefficient);
        return `${prefix}${formatFormula(term.speciesId)}`;
      })
      .join(TERM_SEPARATOR);
  };

  /** Dissociation of an aqueous reagent, using catalog ion multiplicities. */
  const formatDissociationEquation = (reagentId) => {
    const reagent = requireReagent(reagentId);
    const reactants = [{ speciesId: reagent.speciesId, coefficient: 1, phase: reagent.phase }];
    const products = reagent.ions.map((term) => ({
      speciesId: term.ionId,
      coefficient: term.multiplicity,
      phase: reagent.phase,
    }));
    return formatEquation(reactants, products);
  };

  /** Spectator ions of a reaction as formulas, in catalog order. */
  const formatSpectatorIons = (reference) =>
    Object.freeze(resolveReaction(reference).spectatorIons.map((ionId) => formatIonFormula(ionId)));

  const formatSpectatorIonList = (reference) => formatSpectatorIons(reference).join(', ');

  /** Resolves localized text for a declared message key. */
  const resolveMessage = (messageKey) => {
    const text = messages[messageKey];
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new RangeError(`unknown ${String(locale)} message key ${String(messageKey)}`);
    }
    return text;
  };

  const describePhaseModel = (phaseModelName) => {
    const phaseModel = catalog.model?.phaseModels?.[phaseModelName];
    if (!phaseModel) {
      return Object.freeze({
        phaseModel: phaseModelName,
        phases: Object.freeze(['aq']),
        layered: false,
        messageKey: 'homogeneous_aqueous',
        message: 'Larutan homogen satu fase air.',
      });
    }
    return Object.freeze({
      phaseModel: phaseModelName,
      phases: Object.freeze([...phaseModel.phases]),
      layered: phaseModel.layered,
      messageKey: phaseModel.messageKey,
      message: resolveMessage(phaseModel.messageKey),
    });
  };

  /**
   * Machine-readable unsupported status plus its localized explanation for a
   * reagent pair with no catalog reaction. No product and no equation is
   * reported, and the mixture stays in one homogeneous aqueous phase.
   */
  const describeNoModeledReaction = () => {
    const outcome = catalog.model?.unsupportedOutcomes?.noModeledReaction ?? {
      category: 'no_modeled_reaction',
      reasonCode: 'no_modeled_reaction',
      messageKey: 'no_modeled_reaction',
      phaseModel: 'homogeneous_aqueous',
    };
    const message = catalog.presentation?.explanations?.no_modeled_reaction
      ?? (outcome.messageKey ? resolveMessage(outcome.messageKey) : 'Tidak ada reaksi teramati.');
    return Object.freeze({
      status: 'unsupported',
      category: outcome.category,
      reasonCode: outcome.reasonCode,
      messageKey: outcome.messageKey,
      message,
      phase: describePhaseModel(outcome.phaseModel),
      molecularEquation: null,
      netIonicEquation: null,
      precipitate: null,
    });
  };

  /** Unsupported pH status and localized explanation for a declared reason. */
  const describeUnsupportedPH = (reasonCode) => {
    const reason = catalog.model?.capabilities?.pH?.unsupportedReasons?.[reasonCode];
    const message = reason
      ? resolveMessage(reason.messageKey)
      : (catalog.presentation?.explanations?.unsupported ?? String(reasonCode));
    return Object.freeze({
      status: 'unsupported',
      capability: 'pH',
      reasonCode,
      messageKey: reason?.messageKey ?? reasonCode,
      message,
      pH: null,
    });
  };

  /** Unsupported status and localized explanation outside catalog capability. */
  const describeOutsideCatalogCapability = () => {
    const outcome = catalog.model?.unsupportedOutcomes?.outsideCatalogCapability ?? {
      reasonCode: 'outside_model',
      messageKey: 'unsupported',
    };
    const message = catalog.presentation?.explanations?.unsupported
      ?? resolveMessage(outcome.messageKey);
    return Object.freeze({
      status: 'unsupported',
      reasonCode: outcome.reasonCode,
      messageKey: outcome.messageKey,
      message,
    });
  };

  /** Localized boundary statement of one declared model capability. */
  const describeCapabilityBoundary = (capabilityName) => {
    const keyName = CAPABILITY_BOUNDARY_KEYS[capabilityName];
    if (!keyName) throw new RangeError(`unknown capability boundary ${String(capabilityName)}`);
    const capability = catalog.model?.capabilities?.[capabilityName];
    const messageKey = capability?.[keyName];
    const message = messageKey
      ? resolveMessage(messageKey)
      : (catalog.presentation?.explanations?.[capabilityName] ?? `Boundary for ${capabilityName}`);
    return Object.freeze({
      capability: capabilityName,
      messageKey: messageKey ?? capabilityName,
      message,
    });
  };

  /** Every localized model boundary the catalog declares, in a stable order. */
  const listModelBoundaries = () =>
    Object.freeze({
      capabilities: Object.freeze(
        Object.keys(CAPABILITY_BOUNDARY_KEYS)
          .sort()
          .map((name) => describeCapabilityBoundary(name)),
      ),
      phaseModels: Object.freeze(
        Object.keys(catalog.model?.phaseModels ?? {})
          .sort()
          .map((name) => describePhaseModel(name)),
      ),
      noModeledReaction: describeNoModeledReaction(),
      outsideCatalogCapability: describeOutsideCatalogCapability(),
      pHUnsupportedReasons: Object.freeze(
        Object.keys(catalog.model?.capabilities?.pH?.unsupportedReasons ?? {})
          .sort()
          .map((reasonCode) => describeUnsupportedPH(reasonCode)),
      ),
    });

  // -- quantity display precision ----------------------------------------
  //
  // Display precision lives here and nowhere else. The evaluator keeps every
  // scientific value unrounded, and these projections are the single place a
  // rounded number is produced, so a rounded value has no path back into
  // extent, excess, pH, the species ledger, or any later calculation.

  const displaySettings = catalog.model?.display ?? {
    roundingMode: 'half_away_from_zero',
    decimalSeparator: ',',
    quantities: {
      concentration: { precision: 2, unit: 'M' },
      volume: { precision: 1, unit: 'mL' },
      amount: { precision: 4, unit: 'mol' },
      extent: { precision: 4, unit: 'mol' },
      pH: { precision: 2, unit: null },
    },
  };
  if (!displaySettings || typeof displaySettings !== 'object') {
    throw new RangeError('catalog declares no model.display settings');
  }
  if (!SUPPORTED_ROUNDING_MODES.includes(displaySettings.roundingMode)) {
    throw new RangeError(`unsupported display rounding mode ${String(displaySettings.roundingMode)}`);
  }
  if (typeof displaySettings.decimalSeparator !== 'string' || displaySettings.decimalSeparator.length !== 1) {
    throw new RangeError(`display decimal separator must be a single character, received ${String(displaySettings.decimalSeparator)}`);
  }

  /** Declared precision, unit, rounding mode, and separator of one quantity. */
  const describeDisplayQuantity = (quantity) => {
    const declared = displaySettings.quantities?.[quantity];
    if (!declared) throw new RangeError(`catalog declares no display precision for ${String(quantity)}`);
    return Object.freeze({
      quantity,
      precision: requireDisplayPrecision(declared.precision, `display precision for ${quantity}`),
      unit: declared.unit ?? null,
      roundingMode: displaySettings.roundingMode,
      decimalSeparator: displaySettings.decimalSeparator,
    });
  };

  /** Every quantity the catalog declares a display precision for. */
  const listDisplayQuantities = () => Object.freeze(Object.keys(displaySettings.quantities ?? {}).sort());

  /** Numeric display string of one quantity, without its unit. */
  const formatQuantityValue = (quantity, value) => {
    const declared = describeDisplayQuantity(quantity);
    return formatFixed(requireFiniteNumber(value, quantity), declared.precision, declared.decimalSeparator);
  };

  /** Display string of one quantity, with its declared unit when it has one. */
  const formatQuantity = (quantity, value, { withUnit = true } = {}) => {
    const declared = describeDisplayQuantity(quantity);
    const text = formatQuantityValue(quantity, value);
    return withUnit && declared.unit ? `${text} ${declared.unit}` : text;
  };

  /**
   * Rounded display value of one quantity as a number.
   *
   * Exposed for display consumers that need a number rather than a string, such
   * as a chart tick. It must never be written back into an experiment input or
   * a later calculation.
   */
  const roundQuantityForDisplay = (quantity, value) =>
    roundHalfAwayFromZero(requireFiniteNumber(value, quantity), describeDisplayQuantity(quantity).precision);

  /**
   * Display string of a pH value, or `null` when the model reports none.
   *
   * An absent pH stays absent. No neutral `~7.0` is fabricated for a mixture
   * the ideal strong-acid/strong-base model does not cover; the localized
   * unsupported reason from `describeUnsupportedPH` is what explains it.
   */
  const formatPH = (value) => {
    if (value === null || value === undefined) return null;
    return formatQuantityValue('pH', value);
  };

  const formatOptionalQuantity = (quantity, value, options) =>
    value === null || value === undefined ? null : formatQuantity(quantity, value, options);

  /**
   * Display projection of an evaluator result's quantities.
   *
   * The result itself is not touched: this returns strings beside it, so the
   * unrounded domain values remain the only input to any later calculation.
   * `pH` and `speciesLedger` project the honest `null` the evaluator reports
   * until the pH model and the ion ledger exist.
   */
  const formatExperimentQuantities = (result) => {
    if (!result || typeof result !== 'object') throw new TypeError('experiment result must be an object');
    return Object.freeze({
      catalogVersion: result.catalogVersion ?? catalog.catalogVersion,
      extent_mol: formatQuantity('extent_mol', result.extent_mol),
      totalVolume_L: formatQuantity('volume_L', result.totalVolume_L),
      reactants: Object.freeze(
        (result.reactants ?? []).map((reactant) =>
          Object.freeze({
            reagentId: reactant.reagentId,
            speciesId: reactant.speciesId,
            concentration_molL: formatQuantity('concentration_molL', reactant.concentration_molL),
            volume_mL: formatQuantity('volume_mL', reactant.volume_mL),
            volume_L: formatQuantity('volume_L', reactant.volume_L),
            amount_mol: formatQuantity('amount_mol', reactant.amount_mol),
            consumed_mol: formatOptionalQuantity('amount_mol', reactant.consumed_mol),
            remaining_mol: formatOptionalQuantity('amount_mol', reactant.remaining_mol),
          }),
        ),
      ),
      excessSpecies: Object.freeze(
        (result.excessSpecies ?? []).map((excess) =>
          Object.freeze({
            speciesId: excess.speciesId,
            amount_mol: formatQuantity('amount_mol', excess.amount_mol),
          }),
        ),
      ),
      products: Object.freeze(
        (result.products ?? []).map((product) =>
          Object.freeze({
            speciesId: product.speciesId,
            amount_mol: formatQuantity('amount_mol', product.amount_mol),
          }),
        ),
      ),
      pH: formatPH(result.pH?.value ?? null),
      speciesLedger: result.speciesLedger ?? null,
    });
  };

  const describePrecipitate = (reaction) => {
    const speciesId = reaction.presentation?.precipitateSpeciesId;
    if (speciesId === null || speciesId === undefined) return null;
    return Object.freeze({
      speciesId,
      formula: formatSpeciesFormula(speciesId),
      displayName: formatDisplayName(speciesId),
      color: reaction.presentation.precipitateColor,
    });
  };

  const describeReactionPH = (reaction) => {
    if (reaction.pH) {
      return Object.freeze({
        supported: true,
        modelId: reaction.pH.modelId,
        modelLabel: catalog.model?.capabilities?.pH?.modelLabel ?? null,
        reasonCode: null,
        message: null,
      });
    }
    const unsupported = describeUnsupportedPH(reaction.pHUnsupportedReasonCode);
    return Object.freeze({
      supported: false,
      modelId: null,
      modelLabel: null,
      reasonCode: unsupported.reasonCode,
      message: unsupported.message,
    });
  };

  /**
   * Single display projection of a reagent pair.
   *
   * Equation, product formula, phase model, appearance, and energy label all
   * come from the one resolved reaction record, so a precipitate can never
   * disagree with the equation that produced it. Unmatched supported pairs
   * return the machine-readable unsupported status with its localized
   * model-boundary explanation and no equation.
   */
  const formatReactionDisplay = (reagentA, reagentB, options = {}) => {
    const reaction = findReaction(reagentA, reagentB);
    if (!reaction) {
      const unsupported = describeNoModeledReaction();
      return Object.freeze({
        ...unsupported,
        pairKey: normalizePairKey(reagentA, reagentB),
        reactionId: null,
        displayName: null,
        reagents: Object.freeze([formatReagentFormula(reagentA), formatReagentFormula(reagentB)]),
        spectatorIons: Object.freeze([]),
        productSummary: null,
        appearance: catalog.model.unsupportedOutcomes.noModeledReaction.presentation.appearance,
        energyLabel: catalog.model.unsupportedOutcomes.noModeledReaction.presentation.energyLabel,
        solutionColor: catalog.model.unsupportedOutcomes.noModeledReaction.presentation.solutionColor,
        pH: describeUnsupportedPH('PH_MODEL_NO_MODELED_REACTION'),
      });
    }

    return Object.freeze({
      status: 'modeled',
      category: reaction.category,
      pairKey: normalizePairKey(reagentA, reagentB),
      reactionId: reaction.id,
      displayName: reaction.displayName,
      reagents: Object.freeze([formatReagentFormula(reagentA), formatReagentFormula(reagentB)]),
      molecularEquation: formatMolecularEquation(reaction, options),
      netIonicEquation: formatNetIonicEquation(reaction, options),
      productSummary: formatProductSummary(reaction),
      spectatorIons: formatSpectatorIons(reaction),
      phase: describePhaseModel(reaction.phaseModel),
      precipitate: describePrecipitate(reaction),
      appearance: reaction.presentation.appearance,
      energyLabel: reaction.presentation.energyLabel,
      solutionColor: reaction.presentation.solutionColor,
      pH: describeReactionPH(reaction),
    });
  };

  return Object.freeze({
    catalogVersion: catalog.catalogVersion,
    locale,
    formatFormula,
    formatSpeciesFormula,
    formatIonFormula,
    formatDisplayName,
    describeIon,
    formatReagentFormula,
    formatReagentLabel,
    listReagents,
    formatTerm,
    formatEquationSide,
    formatMolecularEquation,
    formatNetIonicEquation,
    formatProductSummary,
    formatDissociationEquation,
    formatSpectatorIons,
    formatSpectatorIonList,
    findReaction,
    formatReactionDisplay,
    describeDisplayQuantity,
    listDisplayQuantities,
    formatQuantityValue,
    formatQuantity,
    roundQuantityForDisplay,
    formatPH,
    formatExperimentQuantities,
    resolveMessage,
    describePhaseModel,
    describeNoModeledReaction,
    describeUnsupportedPH,
    describeOutsideCatalogCapability,
    describeCapabilityBoundary,
    listModelBoundaries,
  });
}

/** Formatters bound to the generated catalog binding. */
export const chemistryFormatters = createChemistryFormatters();
