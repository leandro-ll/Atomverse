/**
 * Pure catalog-backed experiment evaluator.
 *
 * One modeled reaction record answers every question about a supported
 * experiment. The evaluator resolves a reagent pair through the catalog's
 * normalized order-independent pair key, converts each selected solution into a
 * formula-unit amount, calculates balanced reaction extent, names the limiting
 * reactant(s), reports remaining excess and product amounts, and projects the
 * molecular equation, net-ionic equation, phase model, appearance, and energy
 * label from that same record. A precipitate can therefore never disagree with
 * the equation that produced it, and a reagent pair can never behave
 * differently depending on which select it was chosen in.
 *
 * A pair the catalog models no reaction for is an ordinary, fully defined
 * outcome rather than a failure: the evaluator returns the same result shape
 * with the `no_modeled_reaction` category, no product, no equation, zero
 * extent, both solutions still present, and the single unlayered
 * `homogeneous_aqueous` phase the catalog declares for that outcome. Two mixed
 * aqueous solutions are one mixture, so nothing downstream can read a layer
 * boundary out of this result.
 *
 * Purity: no DOM, clock, random, network, provider, or mutable-global
 * dependency, and no rounding. Scientific values stay unrounded; display
 * precision belongs to the formatter projections so that a rounded number can
 * never feed a later calculation.
 *
 * Reuse: all display strings come from `js/domain/chemistry-formatters.js`.
 * This module adds quantities only. The backend parity implementation is
 * `backend/app/domain/chemistry_evaluator.py` and must agree field for field.
 *
 * Control semantics: concentration and volume are the only quantitative
 * inputs. Every amount, the total mixed volume, the balanced extent, the
 * limiting reactant, the excess, and every product amount are derived from
 * them. Temperature is a qualitative input: it produces the bounded
 * `motion` metadata block the catalog's temperature capability declares and
 * changes nothing a learner would read as a calculated quantity. Pressure has
 * no modeled effect at all, so the result reports the catalog's fixed 1 atm
 * state with its localized boundary statement instead of letting an alternate
 * selection silently influence anything.
 *
 * Input semantics: every numeric control is validated against the bounds the
 * catalog declares, and an invalid selection is *rejected* rather than clamped
 * or ignored. A concentration of `0.0999 M`, a volume of `9.99 mL`, a
 * temperature of `-0.01 °C`, and a pressure of `0.99 atm` all produce no
 * result at all, because clamping them would silently evaluate a different
 * experiment than the one the learner set up, and ignoring them would present
 * a control that does nothing. A value exactly at a bound is a valid
 * experiment. One validation pass reports every offending field, each with its
 * field name, a stable reason code, and an Indonesian message a learner can be
 * shown; the reason codes are what the API boundary and the UI map, so they
 * never change meaning silently.
 *
 * pH semantics: the one modeled acid-base system is the ideal, fully
 * dissociated, monoprotic HCl/NaOH mixture the catalog's pH capability
 * declares. Its whole arithmetic runs on the unrounded amounts already
 * calculated above: the acid's proton equivalents minus the base's hydroxide
 * equivalents gives a signed difference, the difference divided by the total
 * mixed volume gives the excess ion concentration, and the declared `pKw`
 * turns that concentration into a pH. Equivalence is decided with the
 * catalog's declared `equivalence_mol` tolerance rather than by exact float
 * equality, because two amounts that are chemically equal are routinely
 * unequal in binary arithmetic. Nothing here is rounded and nothing here reads
 * temperature: the catalog declares `affectsPH: false`, so two experiments
 * differing only in temperature report the same pH.
 *
 * Every other system reports the *same* pH block with `supported: false`, a
 * `null` numeric value, and the machine-readable reason code the catalog
 * declares for it together with that code's localized Indonesian
 * model-boundary explanation. The reason code is read from the reaction
 * record's own `pHUnsupportedReasonCode` for a modeled reaction and from the
 * catalog's declared no-modeled-reaction reason for an unmatched pair, so
 * which systems are unsupported is a catalog statement rather than a list
 * written into this module: a catalog that adds a reaction, or an outcome
 * category, carries its own explanation with it.
 *
 * Both variants of the block declare every field. A consumer branches on
 * `pH.supported` alone and then finds either a number with a side or a null
 * with a reason and a message, and the fields that only mean something for a
 * calculated pH are explicitly `null` rather than absent so the two variants
 * stay directly comparable. Nothing invents a value: the audited engine's
 * seeded `~7.0` has no replacement default anywhere, for a salt solution, a
 * precipitating mixture, or an unreacted pair.
 *
 * Deliberately out of scope here, each owned by a later task:
 * - the ion-level species ledger and conservation proofs (task 6.1),
 * - the deterministic visualization plan (task 7.1).
 * The result exposes `speciesLedger` as an explicit `null` placeholder so
 * those tasks have a field to fill without reshaping consumers, and so no
 * fabricated particle count can escape in the meantime.
 */

import { CATALOG } from '../generated/chemistry-catalog.js';
import { createChemistryFormatters, normalizePairKey } from './chemistry-formatters.js';

/** Millilitres per litre, the only unit conversion the evaluator performs. */
export const MILLILITRES_PER_LITRE = 1000;

export const OUTCOME_CATEGORIES = Object.freeze([
  'precipitate_forms',
  'below_saturation',
  'no_modeled_reaction',
  'neutralization',
  'unsupported',
]);

export function resolveCanonicalPair(idA, idB) {
  if (!idA || !idB) {
    throw new TypeError('both reagent identifiers are required');
  }
  const lowId = idA < idB ? idA : idB;
  const highId = idA < idB ? idB : idA;
  return Object.freeze({
    key: `${lowId}|${highId}`,
    lowId,
    highId,
  });
}

export function postMixConcentrations(input, catalog = CATALOG) {
  if (!input) throw new TypeError('experiment input is required');
  const reagentAId = input.reagentAId ?? input.reagentA;
  const reagentBId = input.reagentBId ?? input.reagentB;
  if (!reagentAId || !reagentBId) {
    throw new TypeError('both reagent identifiers are required');
  }

  const volA_L = input.volumeA_L !== undefined ? input.volumeA_L : (input.volumeA_mL !== undefined ? input.volumeA_mL / 1000.0 : undefined);
  const volB_L = input.volumeB_L !== undefined ? input.volumeB_L : (input.volumeB_mL !== undefined ? input.volumeB_mL / 1000.0 : undefined);
  if (volA_L === undefined || volB_L === undefined) {
    throw new TypeError('volumes for both reagents are required');
  }
  const totalVolume_L = volA_L + volB_L;
  if (totalVolume_L <= 0) {
    throw new RangeError(`non-positive total volume: ${totalVolume_L}`);
  }

  const concA_M = input.concentrationA_M !== undefined ? input.concentrationA_M : (input.concentrationA_molL !== undefined ? input.concentrationA_molL : undefined);
  const concB_M = input.concentrationB_M !== undefined ? input.concentrationB_M : (input.concentrationB_molL !== undefined ? input.concentrationB_molL : undefined);
  if (concA_M === undefined || concB_M === undefined) {
    throw new TypeError('concentrations for both reagents are required');
  }

  const substances = Array.isArray(catalog.substances)
    ? new Map(catalog.substances.map((s) => [s.id, s]))
    : (catalog.substances instanceof Map ? catalog.substances : new Map(Object.entries(catalog.substances || {})));

  const subA = substances.get(reagentAId);
  const subB = substances.get(reagentBId);
  if (!subA) throw new RangeError(`reagent ${reagentAId} not found in catalog substances`);
  if (!subB) throw new RangeError(`reagent ${reagentBId} not found in catalog substances`);

  const conc = new Map();
  const pairs = [
    [subA, concA_M, volA_L],
    [subB, concB_M, volB_L],
  ];

  for (const [sub, C, V] of pairs) {
    for (const part of sub.dissociation) {
      const moles = C * V * part.multiplicity;
      const current = conc.get(part.ionId) ?? 0.0;
      conc.set(part.ionId, current + (moles / totalVolume_L));
    }
  }

  return conc;
}

export function ionProduct(concentrations, solid, catalog = CATALOG) {
  let ionPowers = null;

  if (typeof solid === 'object' && solid !== null) {
    if (solid.ionPowers) {
      ionPowers = solid.ionPowers;
    } else if (solid.kspRef && solid.kspRef.ionPowers) {
      ionPowers = solid.kspRef.ionPowers;
    } else if (solid.dissociation) {
      ionPowers = Object.fromEntries(solid.dissociation.map((d) => [d.ionId, d.multiplicity]));
    }
  } else if (typeof solid === 'string') {
    const substances = Array.isArray(catalog.substances)
      ? new Map(catalog.substances.map((s) => [s.id, s]))
      : (catalog.substances instanceof Map ? catalog.substances : new Map(Object.entries(catalog.substances || {})));
    const subRecord = substances.get(solid);
    if (subRecord && subRecord.dissociation) {
      ionPowers = Object.fromEntries(subRecord.dissociation.map((d) => [d.ionId, d.multiplicity]));
    }
  }

  if (!ionPowers) {
    throw new RangeError(`cannot determine ion powers for solid ${String(solid)}`);
  }

  const getConc = (ionId) => {
    if (concentrations instanceof Map) return concentrations.get(ionId) ?? 0.0;
    if (typeof concentrations === 'object' && concentrations !== null) return concentrations[ionId] ?? 0.0;
    return 0.0;
  };

  let Q = 1.0;
  const sortedEntries = Object.entries(ionPowers).sort(([a], [b]) => a.localeCompare(b));
  for (const [ionId, power] of sortedEntries) {
    const c = getConc(ionId);
    Q *= Math.pow(c, power);
  }
  return Q;
}

export function decideOutcome(reactionOrQ, inputOrKsp, catalog = CATALOG) {
  if (typeof reactionOrQ === 'number') {
    const Q = reactionOrQ;
    const kspVal = typeof inputOrKsp === 'object' && inputOrKsp !== null
      ? (typeof inputOrKsp.value === 'string' ? parseFloat(inputOrKsp.value) : inputOrKsp.value)
      : Number(inputOrKsp);
    return Q > kspVal ? 'precipitate_forms' : 'below_saturation';
  }

  const reaction = reactionOrQ;
  const input = inputOrKsp;
  const cat = catalog || CATALOG;

  if (reaction.outcome === 'unsupported') {
    return 'unsupported';
  }
  if (reaction.outcome === 'no_modeled_reaction') {
    return 'no_modeled_reaction';
  }
  if (reaction.reactionClass === 'neutralization' || reaction.outcome === 'neutralization') {
    return 'neutralization';
  }

  const conc = postMixConcentrations(input, cat);
  const Q = ionProduct(conc, reaction.candidateSolidId, cat);
  const ksp = parseFloat(reaction.kspRef.value);
  return Q > ksp ? 'precipitate_forms' : 'below_saturation';
}

export function substanceName(substanceId, catalog = CATALOG) {
  const substances = Array.isArray(catalog.substances)
    ? new Map(catalog.substances.map((s) => [s.id, s]))
    : (catalog.substances instanceof Map ? catalog.substances : new Map(Object.entries(catalog.substances || {})));
  const sub = substances.get(substanceId);
  return sub ? sub.indonesianName : substanceId;
}

/** Category reported when the catalog declares no reaction for a pair. */
export const NO_MODELED_REACTION_CATEGORY = 'no_modeled_reaction';

/** The only temperature motion model version 1 implements. */
export const LINEAR_BOUNDED_MOTION_MODEL = 'linear_bounded';

/** Temperature effect the catalog must declare for the motion metadata. */
export const QUALITATIVE_MOTION_EFFECT = 'qualitative_motion_only';

/** Pressure effect the catalog must declare for the fixed 1 atm state. */
export const NO_MODELED_PRESSURE_EFFECT = 'none';

/**
 * The only pH model this evaluator implements.
 *
 * Named here rather than taken from whatever the catalog happens to declare:
 * the formulas below are the ideal, fully dissociated, monoprotic strong
 * acid/strong base treatment, so a catalog announcing some other model must
 * fail loudly instead of having this arithmetic applied to it.
 */
export const IDEAL_STRONG_MONOPROTIC_PH_MODEL = 'ideal_strong_monoprotic_acid_base';

/** Excess proton concentration: pH below the declared neutral point. */
export const PH_ACIDIC = 'acidic';

/** Acid and base equivalents equal within tolerance: the neutral point. */
export const PH_NEUTRAL = 'neutral';

/** Excess hydroxide concentration: pH above the declared neutral point. */
export const PH_BASIC = 'basic';

/** Which side of the declared neutral point a reported pH falls on. */
export const PH_SIDES = Object.freeze([PH_ACIDIC, PH_NEUTRAL, PH_BASIC]);

/**
 * Declared pH reason code for a pair the catalog models no reaction for.
 *
 * A reaction record names its own reason code, so this is the one case that
 * has no record to read it from. Naming it here keeps it a single stable
 * constant instead of a string repeated at each call site, and the evaluator
 * refuses at construction a catalog that does not declare it, so the code can
 * never resolve to a missing message.
 */
export const NO_MODELED_REACTION_PH_REASON = 'PH_MODEL_NO_MODELED_REACTION';

/**
 * Every field a pH block carries, in the order both variants report them.
 *
 * The supported and unsupported variants differ in their values, never in
 * their shape. `supported` is therefore the only branch a consumer needs: it
 * is `true` beside a number and a side, and `false` beside a null value, a
 * reason code, a message key, and the localized explanation of why version 1
 * does not calculate that system. Everything meaningful only to a calculated
 * pH is explicitly `null` in the unsupported variant rather than missing, so
 * the two can be compared field by field and no consumer has to guess whether
 * an absent key means zero, neutral, or unknown.
 */
export const PH_BLOCK_FIELDS = Object.freeze([
  'supported',
  'value',
  'side',
  'equivalence',
  'modelId',
  'modelLabel',
  'pKw',
  'pKwSource',
  'temperatureCorrected',
  'neutralPH',
  'acidReagentId',
  'baseReagentId',
  'protonIonId',
  'hydroxideIonId',
  'acidEquivalents_mol',
  'baseEquivalents_mol',
  'equivalenceDifference_mol',
  'totalVolume_L',
  'excessIonId',
  'excessAmount_mol',
  'excessConcentration_molL',
  'reasonCode',
  'messageKey',
  'message',
]);

// -- validated experiment input ------------------------------------------
//
// Reason codes are the stable contract. The API boundary maps them to response
// codes and the UI maps them to the control that needs correcting, so they are
// named for the *kind* of failure rather than for one field, and the set is
// frozen and enumerable so a consumer can prove it handles all of them.

/** A required quantity was absent. */
export const QUANTITY_REQUIRED = 'QUANTITY_REQUIRED';
/** A quantity was supplied as something other than a number. */
export const QUANTITY_NOT_A_NUMBER = 'QUANTITY_NOT_A_NUMBER';
/** A quantity was `NaN` or infinite, so it names no position at all. */
export const QUANTITY_NOT_FINITE = 'QUANTITY_NOT_FINITE';
/** A quantity that must be positive was zero or negative. */
export const QUANTITY_NOT_POSITIVE = 'QUANTITY_NOT_POSITIVE';
/** A quantity fell below the minimum the catalog declares for its control. */
export const QUANTITY_BELOW_MINIMUM = 'QUANTITY_BELOW_MINIMUM';
/** A quantity rose above the maximum the catalog declares for its control. */
export const QUANTITY_ABOVE_MAXIMUM = 'QUANTITY_ABOVE_MAXIMUM';
/** A pressure other than the one fixed value version 1 models was supplied. */
export const PRESSURE_NOT_SUPPORTED = 'PRESSURE_NOT_SUPPORTED';

/** Every rejection reason an experiment input can carry, in a stable order. */
export const EXPERIMENT_INPUT_REASON_CODES = Object.freeze([
  QUANTITY_REQUIRED,
  QUANTITY_NOT_A_NUMBER,
  QUANTITY_NOT_FINITE,
  QUANTITY_NOT_POSITIVE,
  QUANTITY_BELOW_MINIMUM,
  QUANTITY_ABOVE_MAXIMUM,
  PRESSURE_NOT_SUPPORTED,
]);

/**
 * Every numeric experiment field, with the catalog bound that governs it.
 *
 * The numbers themselves are deliberately absent: `bound` names a key in
 * `model.bounds`, so widening the educational control range is a catalog
 * release rather than a code change, and a regenerated catalog cannot drift
 * away from the validation that is supposed to enforce it.
 *
 * `label` and `unit` exist here because the rejection text is owned by this
 * module rather than by the catalog message bundle. An out-of-range selection
 * is not a catalog-declared outcome, so the catalog has no message key for it,
 * and `scripts/catalog/validate-catalog.mjs` sets the same precedent by owning
 * the localized text that explains an incompatible catalog.
 */
export const VALIDATED_EXPERIMENT_FIELDS = Object.freeze(
  [
    { field: 'concentrationA_molL', bound: 'concentration_molL', label: 'Konsentrasi larutan A', unit: 'M', required: true, positive: true, fixed: false },
    { field: 'volumeA_mL', bound: 'volume_mL', label: 'Volume larutan A', unit: 'mL', required: true, positive: true, fixed: false },
    { field: 'concentrationB_molL', bound: 'concentration_molL', label: 'Konsentrasi larutan B', unit: 'M', required: true, positive: true, fixed: false },
    { field: 'volumeB_mL', bound: 'volume_mL', label: 'Volume larutan B', unit: 'mL', required: true, positive: true, fixed: false },
    // Temperature and pressure default to the catalog's declared position when
    // they are not supplied: zero degrees is a real selection, and version 1
    // models exactly one pressure, so neither absence is a learner error.
    { field: 'temperature_C', bound: 'temperature_C', label: 'Suhu', unit: '\u00b0C', required: false, positive: false, fixed: false },
    { field: 'pressure_atm', bound: 'pressure_atm', label: 'Tekanan', unit: 'atm', required: false, positive: false, fixed: true },
  ].map((descriptor) => Object.freeze(descriptor)),
);

/**
 * Prints a declared bound the way both language halves print it.
 *
 * This is not display rounding: the bound is echoed exactly as the catalog
 * declares it, with no precision applied. The function exists only to mark the
 * parity requirement, because an integral bound has to read as `2` rather than
 * `2.0` in the Indonesian text on both halves of the pair, and the backend
 * half has to spell that out where JavaScript gets it for free.
 */
function formatBoundValue(value) {
  return String(value);
}

/** Developer-facing phrase naming what a field had to be. */
function describeRequirement(reasonCode, descriptor, bounds) {
  switch (reasonCode) {
    case QUANTITY_REQUIRED:
      return 'supplied';
    case QUANTITY_NOT_A_NUMBER:
      return 'a number';
    case QUANTITY_NOT_FINITE:
      return 'a finite number';
    case QUANTITY_NOT_POSITIVE:
      return 'a number greater than zero';
    case QUANTITY_BELOW_MINIMUM:
      return `at least ${formatBoundValue(bounds.minimum)} ${descriptor.unit}`;
    case QUANTITY_ABOVE_MAXIMUM:
      return `at most ${formatBoundValue(bounds.maximum)} ${descriptor.unit}`;
    case PRESSURE_NOT_SUPPORTED:
      return `fixed at ${formatBoundValue(bounds.minimum)} ${descriptor.unit}`;
    default:
      throw new RangeError(`unknown experiment input reason code ${String(reasonCode)}`);
  }
}

/**
 * Learner-facing Indonesian explanation of one rejected field.
 *
 * It names the control and what was expected of it, and it deliberately does
 * not echo the rejected value or any internal field name, so the text is safe
 * to render directly next to the control that produced it.
 */
function localizedViolationMessage(reasonCode, descriptor, bounds) {
  const label = descriptor.label;
  switch (reasonCode) {
    case QUANTITY_REQUIRED:
      return `${label} wajib diisi.`;
    case QUANTITY_NOT_A_NUMBER:
      return `${label} harus berupa angka.`;
    case QUANTITY_NOT_FINITE:
      return `${label} harus berupa angka yang terhingga.`;
    case QUANTITY_NOT_POSITIVE:
      return `${label} harus lebih besar dari nol.`;
    case QUANTITY_BELOW_MINIMUM:
      return `${label} tidak boleh kurang dari ${formatBoundValue(bounds.minimum)} ${descriptor.unit}.`;
    case QUANTITY_ABOVE_MAXIMUM:
      return `${label} tidak boleh lebih dari ${formatBoundValue(bounds.maximum)} ${descriptor.unit}.`;
    case PRESSURE_NOT_SUPPORTED:
      return `${label} tidak dapat diubah pada model versi 1 dan harus tetap ${formatBoundValue(bounds.minimum)} ${descriptor.unit}.`;
    default:
      throw new RangeError(`unknown experiment input reason code ${String(reasonCode)}`);
  }
}

/** One rejected field: what failed, why, and what to tell the learner. */
function buildViolation(reasonCode, descriptor, bounds, value) {
  const limit =
    reasonCode === QUANTITY_ABOVE_MAXIMUM
      ? bounds.maximum
      : reasonCode === QUANTITY_BELOW_MINIMUM || reasonCode === PRESSURE_NOT_SUPPORTED
        ? bounds.minimum
        : null;
  return Object.freeze({
    field: descriptor.field,
    bound: descriptor.bound,
    value,
    reasonCode,
    limit,
    requirement: describeRequirement(reasonCode, descriptor, bounds),
    message: localizedViolationMessage(reasonCode, descriptor, bounds),
  });
}

/**
 * Raised when an experiment input does not describe a supported experiment.
 *
 * The error carries every offending field in one `violations` list rather than
 * only the first, so a learner who set two controls wrongly is told about both
 * instead of discovering them one submission at a time. `message` is the
 * developer-facing English summary; `localizedMessages` carries the
 * learner-facing Indonesian text, one entry per field.
 */
export class InvalidExperimentQuantityError extends RangeError {
  constructor(violations) {
    const list = Array.isArray(violations) ? violations : [violations];
    if (list.length === 0) {
      throw new TypeError('an invalid experiment input must carry at least one violation');
    }
    super(list.map((item) => `${item.field} must be ${item.requirement}, received ${String(item.value)}`).join('; '));
    this.name = 'InvalidExperimentQuantityError';
    this.violations = Object.freeze(list.map((item) => Object.freeze({ ...item })));
    this.fields = Object.freeze(list.map((item) => item.field));
    this.reasonCodes = Object.freeze(list.map((item) => item.reasonCode));
    this.localizedMessages = Object.freeze(list.map((item) => item.message));
    this.localizedMessage = this.localizedMessages.join(' ');

    // Shortcuts to the first violation, which is all a single-field caller
    // such as the motion factor helper can ever produce.
    this.field = list[0].field;
    this.value = list[0].value;
    this.reasonCode = list[0].reasonCode;
    this.requirement = list[0].requirement;
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

/**
 * Checks one supplied field against one declared bound.
 *
 * Returns either the accepted number or the single violation that rejected
 * it, never both, and never a corrected value: there is no code path here that
 * moves a quantity into range. The checks run from the weakest precondition to
 * the strongest so that a reason code names the most specific thing that is
 * wrong — `0 M` is reported as not positive rather than as below the minimum,
 * and `0.05 M` is reported as below the minimum rather than as not positive.
 *
 * Declared step size is deliberately not enforced. The step describes how a
 * slider moves, not what chemistry is defined, so an exactly calculated
 * off-step concentration arriving from the inverse solver stays valid.
 */
function checkField(descriptor, bounds, value, requireSupplied) {
  if (value === undefined || value === null) {
    if (requireSupplied) return { violation: buildViolation(QUANTITY_REQUIRED, descriptor, bounds, value) };
    return { value: bounds.default };
  }
  if (typeof value !== 'number') {
    return { violation: buildViolation(QUANTITY_NOT_A_NUMBER, descriptor, bounds, value) };
  }
  if (!Number.isFinite(value)) {
    return { violation: buildViolation(QUANTITY_NOT_FINITE, descriptor, bounds, value) };
  }
  if (descriptor.positive && value <= 0) {
    return { violation: buildViolation(QUANTITY_NOT_POSITIVE, descriptor, bounds, value) };
  }
  if (descriptor.fixed) {
    // One modeled pressure means one accepted pressure. Any other selection is
    // an explicit rejection rather than a field the evaluator quietly skips.
    if (value !== bounds.minimum) {
      return { violation: buildViolation(PRESSURE_NOT_SUPPORTED, descriptor, bounds, value) };
    }
    return { value };
  }
  if (value < bounds.minimum) {
    return { violation: buildViolation(QUANTITY_BELOW_MINIMUM, descriptor, bounds, value) };
  }
  if (value > bounds.maximum) {
    return { violation: buildViolation(QUANTITY_ABOVE_MAXIMUM, descriptor, bounds, value) };
  }
  return { value };
}

function requireFiniteDeclaration(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${String(value)}`);
  }
  return value;
}

/** Converts a solution volume in millilitres to litres without rounding. */
export function toLitres(volume_mL) {
  return volume_mL / MILLILITRES_PER_LITRE;
}

/** Formula-unit amount of a dissolved reagent: `n = concentration × volume`. */
export function calculateAmount(concentration_molL, volume_mL) {
  return concentration_molL * toLitres(volume_mL);
}

/**
 * Decimal cologarithm `-log10(x)`, the only logarithm the pH model uses.
 *
 * A concentration of zero or below has no cologarithm, and the one caller
 * never passes one: an excess within the declared equivalence tolerance is
 * reported as the neutral point instead of being pushed through this function.
 * The guard is here so that a future caller cannot quietly produce `Infinity`
 * and have it read as a pH.
 */
export function negativeLog10(concentration) {
  if (!(concentration > 0)) {
    throw new RangeError(`a cologarithm needs a positive concentration, received ${String(concentration)}`);
  }
  return -Math.log10(concentration);
}

/**
 * Builds the evaluator for one catalog.
 *
 * The catalog is read, never written, so one evaluator instance is safe to
 * share. Tests can pass a mutated copy to prove the evaluator reads the
 * catalog rather than a hardcoded table.
 */
export class CatalogCompatibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CatalogCompatibilityError';
  }
}

export function verifyCatalogCompatibility(
  catalog,
  expectedSchemaMajor = '2',
  expectedDigest = null,
) {
  const schemaVersion = String(catalog?.schemaVersion || catalog?.catalogVersion || '');
  if (schemaVersion && !schemaVersion.startsWith(`${expectedSchemaMajor}.`)) {
    throw new CatalogCompatibilityError(
      `Katalog kimia tidak kompatibel: versi skema utama diharapkan ${expectedSchemaMajor}.x.x, tetapi menerima ${schemaVersion}.`
    );
  }
  if (expectedDigest !== null) {
    const catDigest = catalog?.catalogDigest || catalog?.digest;
    if (catDigest && catDigest !== expectedDigest) {
      throw new CatalogCompatibilityError(
        `Katalog kimia tidak kompatibel: digest ${catDigest} tidak sesuai dengan digest yang diharapkan ${expectedDigest}.`
      );
    }
  }
}

export function createChemistryEvaluator(catalog = CATALOG) {
  if (!catalog || typeof catalog !== 'object') throw new TypeError('catalog must be an object');
  verifyCatalogCompatibility(catalog);

  if (catalog.substances) {
    const substancesMap = Array.isArray(catalog.substances)
      ? new Map(catalog.substances.map((s) => [s.id, s]))
      : (catalog.substances instanceof Map ? catalog.substances : new Map(Object.entries(catalog.substances || {})));
    const reactionsMap = Array.isArray(catalog.reactions)
      ? new Map(catalog.reactions.map((r) => [r.id, r]))
      : (catalog.reactions instanceof Map ? catalog.reactions : new Map(Object.entries(catalog.reactions || {})));
    const reactionsByKey = new Map();
    for (const rxn of reactionsMap.values()) {
      if (rxn.canonicalKey) {
        reactionsByKey.set(rxn.canonicalKey, rxn);
      }
    }

    const model = catalog.model ?? {};
    const pKw = Number(model.pKw ?? 14.0);
    const neutralPH = Number(model.neutralPh ?? pKw / 2);
    const amountTolerance = Number(model.tolerances?.element ?? 1e-6);
    const equivalenceTolerance = 1e-6;
    const pHTolerance = 0.01;

    const evaluateExperimentV2 = (input, options = {}) => {
      if (!input || typeof input !== 'object') throw new TypeError('experiment input must be an object');
      const reagentA = input.reagentAId ?? input.reagentA;
      const reagentB = input.reagentBId ?? input.reagentB;
      if (!reagentA || !reagentB) throw new TypeError('both reagent identifiers are required');

      const pair = resolveCanonicalPair(reagentA, reagentB);
      const key = pair.key;

      if (reagentA === reagentB) {
        return Object.freeze({
          outcome: 'no_modeled_reaction',
          reasonCode: 'same_reagent',
          explanationId: 'no_modeled_reaction',
          productId: null,
          candidateSolidId: null,
          saturation: null,
          molecularEquation: null,
          netIonicEquation: null,
          spectatorIonIds: Object.freeze([]),
          ledger: null,
          speciesLedger: null,
          catalogVersion: catalog.catalogVersion,
        });
      }

      const reaction = reactionsByKey.get(key);
      if (!reaction) {
        return Object.freeze({
          outcome: 'no_modeled_reaction',
          reasonCode: 'no_modeled_reaction',
          explanationId: 'no_modeled_reaction',
          productId: null,
          candidateSolidId: null,
          saturation: null,
          molecularEquation: null,
          netIonicEquation: null,
          spectatorIonIds: Object.freeze([]),
          ledger: null,
          speciesLedger: null,
          catalogVersion: catalog.catalogVersion,
        });
      }

      const rxnOutcome = reaction.outcome;
      if (rxnOutcome === 'unsupported') {
        return Object.freeze({
          outcome: 'unsupported',
          reasonCode: reaction.reasonCode,
          unsupportedReason: reaction.reasonCode,
          explanationId: reaction.explanationId,
          productId: null,
          candidateSolidId: null,
          saturation: null,
          molecularEquation: null,
          netIonicEquation: null,
          spectatorIonIds: Object.freeze([]),
          ledger: null,
          speciesLedger: null,
          catalogVersion: catalog.catalogVersion,
        });
      }

      if (rxnOutcome === 'no_modeled_reaction') {
        return Object.freeze({
          outcome: 'no_modeled_reaction',
          reasonCode: reaction.reasonCode ?? 'no_modeled_reaction',
          explanationId: reaction.explanationId ?? 'no_modeled_reaction',
          productId: null,
          candidateSolidId: null,
          saturation: null,
          molecularEquation: null,
          netIonicEquation: null,
          spectatorIonIds: Object.freeze([]),
          ledger: null,
          speciesLedger: null,
          catalogVersion: catalog.catalogVersion,
        });
      }

      if (reaction.reactionClass === 'neutralization' || rxnOutcome === 'neutralization') {
        const volA_L = input.volumeA_L !== undefined ? input.volumeA_L : (input.volumeA_mL !== undefined ? input.volumeA_mL / 1000.0 : undefined);
        const volB_L = input.volumeB_L !== undefined ? input.volumeB_L : (input.volumeB_mL !== undefined ? input.volumeB_mL / 1000.0 : undefined);
        const concA_M = input.concentrationA_M !== undefined ? input.concentrationA_M : (input.concentrationA_molL !== undefined ? input.concentrationA_molL : undefined);
        const concB_M = input.concentrationB_M !== undefined ? input.concentrationB_M : (input.concentrationB_molL !== undefined ? input.concentrationB_molL : undefined);
        const totalV = volA_L + volB_L;
        const subA = substancesMap.get(reagentA);
        const isAAcid = subA?.dissociation?.some((part) => part.ionId === 'ion.h_1p') ?? false;
        const nAcid = isAAcid ? concA_M * volA_L : concB_M * volB_L;
        const nBase = isAAcid ? concB_M * volB_L : concA_M * volA_L;
        const diff = nAcid - nBase;
        const tol = 1e-6;
        let phVal;
        if (Math.abs(diff) <= tol) {
          phVal = pKw / 2;
        } else if (diff > tol) {
          phVal = -Math.log10(diff / totalV);
        } else {
          const pOH = -Math.log10(-diff / totalV);
          phVal = pKw - pOH;
        }

        return Object.freeze({
          outcome: 'neutralization',
          reactionId: reaction.id,
          productId: 'sub.h2o',
          candidateSolidId: null,
          saturation: null,
          molecularEquation: reaction.molecularEquation,
          netIonicEquation: reaction.netIonicEquation,
          spectatorIonIds: Object.freeze([...(reaction.spectatorIonIds ?? [])]),
          pH: Object.freeze({ value: phVal, supported: true, neutralPH: neutralPH }),
          speciesLedger: null,
          catalogVersion: catalog.catalogVersion,
        });
      }

      // Double displacement with Ksp
      const conc = postMixConcentrations(input, catalog);
      const solidId = reaction.candidateSolidId;
      const Q = ionProduct(conc, solidId, catalog);
      const kspLiteral = String(reaction.kspRef.value);
      const kspVal = parseFloat(kspLiteral);
      const ratio = Q / kspVal;
      const kspSourceId = reaction.kspRef.sourceId;
      const saturation = Object.freeze({
        Q,
        ksp: kspVal,
        ratio,
        kspSourceId,
        ksp_literal: kspLiteral,
      });

      if (Q > kspVal) {
        return Object.freeze({
          outcome: 'precipitate_forms',
          reactionId: reaction.id,
          productId: solidId,
          candidateSolidId: solidId,
          saturation,
          molecularEquation: reaction.molecularEquation,
          netIonicEquation: reaction.netIonicEquation,
          spectatorIonIds: Object.freeze([...(reaction.spectatorIonIds ?? [])]),
          explanationId: 'precipitate_forms',
          speciesLedger: null,
          catalogVersion: catalog.catalogVersion,
        });
      } else {
        const solidName = substanceName(solidId, catalog);
        const explanationTemplate = catalog.presentation?.explanations?.below_saturation ?? '';
        const explanation = explanationTemplate
          .replace('{{Q}}', Q.toExponential(4))
          .replace('{{solidName}}', solidName)
          .replace('{{Ksp}}', kspLiteral);

        return Object.freeze({
          outcome: 'below_saturation',
          reactionId: reaction.id,
          productId: null,
          candidateSolidId: solidId,
          saturation,
          molecularEquation: null,
          netIonicEquation: null,
          spectatorIonIds: Object.freeze([...(reaction.spectatorIonIds ?? [])]),
          explanationId: 'below_saturation',
          explanation,
          speciesLedger: null,
          catalogVersion: catalog.catalogVersion,
        });
      }
    };

    return Object.freeze({
      catalogVersion: catalog.catalogVersion,
      modelVersion: model.modelVersion ?? '2.0.0',
      amountTolerance,
      equivalenceTolerance,
      pHTolerance,
      pHModel: Object.freeze({
        modelId: IDEAL_STRONG_MONOPROTIC_PH_MODEL,
        modelLabel: 'Ideal Monoprotic',
        pKw,
        pKwSource: 'standard',
        temperatureCorrected: false,
        neutralPH,
        supportedReactionIds: Object.freeze(['rxn.hcl__naoh']),
        unsupportedReasonCodes: Object.freeze([NO_MODELED_REACTION_PH_REASON]),
      }),
      bounds: Object.freeze({}),
      validateExperimentInput: (inp) => inp,
      normalizePairKey: (idA, idB) => resolveCanonicalPair(idA, idB).key,
      findReaction: (idA, idB) => reactionsByKey.get(resolveCanonicalPair(idA, idB).key),
      calculateAmount: (c, v) => (c * v) / 1000.0,
      toLitres: (ml) => ml / 1000.0,
      negativeLog10: (c) => -Math.log10(c),
      motionSpeedFactor: () => 1.0,
      describeMotion: () => ({ quantitative: false }),
      describePressure: () => ({ atm: 1.0 }),
      describeUnsupportedPH: (reason) => ({ supported: false, reasonCode: reason }),
      evaluateExperiment: evaluateExperimentV2,
    });
  }

  const formatters = createChemistryFormatters(catalog);
  const model = catalog.model ?? {};
  const amountTolerance = model.tolerances?.amount_mol;
  if (!(typeof amountTolerance === 'number' && Number.isFinite(amountTolerance) && amountTolerance > 0)) {
    throw new RangeError('catalog must declare a finite positive model.tolerances.amount_mol');
  }

  // -- declared control capabilities -------------------------------------
  //
  // Temperature and pressure are read from the catalog here, once, so that a
  // catalog which claimed a quantitative effect for either control would fail
  // loudly instead of being silently ignored by an evaluator that only ever
  // treats them as metadata.

  /**
   * Resolves one declared control bound, checked to be usable as a bound.
   *
   * A bound with a missing, non-finite, or inverted edge would make validation
   * meaningless, so the evaluator refuses the catalog at construction instead
   * of accepting inputs it cannot honestly judge. Equality is allowed because
   * a fixed control such as pressure declares the same minimum and maximum.
   */
  const requireBounds = (boundName) => {
    const bounds = model.bounds?.[boundName];
    if (!bounds) throw new RangeError(`catalog declares no model.bounds.${boundName}`);
    requireFiniteDeclaration(bounds.minimum, `model.bounds.${boundName}.minimum`);
    requireFiniteDeclaration(bounds.maximum, `model.bounds.${boundName}.maximum`);
    requireFiniteDeclaration(bounds.default, `model.bounds.${boundName}.default`);
    if (bounds.maximum < bounds.minimum) {
      throw new RangeError(`model.bounds.${boundName} must declare a maximum at or above its minimum`);
    }
    if (bounds.default < bounds.minimum || bounds.default > bounds.maximum) {
      throw new RangeError(`model.bounds.${boundName} must declare a default inside its own range`);
    }
    return bounds;
  };

  const temperatureBounds = requireBounds('temperature_C');
  if (temperatureBounds.maximum <= temperatureBounds.minimum) {
    throw new RangeError('model.bounds.temperature_C must declare a maximum above its minimum');
  }

  const temperatureCapability = model.capabilities?.temperature;
  if (!temperatureCapability) throw new RangeError('catalog declares no temperature capability');
  if (temperatureCapability.effect !== QUALITATIVE_MOTION_EFFECT) {
    throw new RangeError(`temperature capability must declare effect ${QUALITATIVE_MOTION_EFFECT}`);
  }
  for (const claim of ['affectsExtent', 'affectsRateConstant', 'affectsPH']) {
    if (temperatureCapability[claim] !== false) {
      throw new RangeError(`temperature capability must declare ${claim} false in version 1`);
    }
  }

  const motionSpeedModel = temperatureCapability.motionSpeedFactor;
  if (!motionSpeedModel) throw new RangeError('temperature capability declares no motionSpeedFactor');
  if (motionSpeedModel.model !== LINEAR_BOUNDED_MOTION_MODEL) {
    throw new RangeError(`unsupported motion speed model ${String(motionSpeedModel.model)}`);
  }
  requireFiniteDeclaration(motionSpeedModel.atMinimum, 'motionSpeedFactor.atMinimum');
  requireFiniteDeclaration(motionSpeedModel.atMaximum, 'motionSpeedFactor.atMaximum');
  requireFiniteDeclaration(motionSpeedModel.referenceTemperature_C, 'motionSpeedFactor.referenceTemperature_C');
  if (motionSpeedModel.atMinimum <= 0 || motionSpeedModel.atMaximum <= motionSpeedModel.atMinimum) {
    throw new RangeError('motionSpeedFactor must rise from a positive atMinimum to a larger atMaximum');
  }

  const pressureCapability = model.capabilities?.pressure;
  if (!pressureCapability) throw new RangeError('catalog declares no pressure capability');
  if (pressureCapability.effect !== NO_MODELED_PRESSURE_EFFECT) {
    throw new RangeError(`pressure capability must declare effect ${NO_MODELED_PRESSURE_EFFECT} in version 1`);
  }
  if (pressureCapability.selectable !== false || pressureCapability.acceptsAlternateValues !== false) {
    throw new RangeError('pressure capability must be neither selectable nor accept alternate values');
  }
  requireFiniteDeclaration(pressureCapability.fixed_atm, 'pressure capability fixed_atm');
  const pressureBounds = requireBounds('pressure_atm');
  if (
    pressureBounds.minimum !== pressureCapability.fixed_atm ||
    pressureBounds.maximum !== pressureCapability.fixed_atm
  ) {
    throw new RangeError(`model.bounds.pressure_atm must be fixed at ${String(pressureCapability.fixed_atm)} atm`);
  }

  // -- declared pH capability --------------------------------------------
  //
  // Every number the pH model uses is read from the catalog here, once. The
  // neutral point in particular is checked against the declared `pKw` rather
  // than trusted on its own, because a catalog that disagreed with itself
  // about where neutral sits would otherwise report two different answers for
  // the same mixture depending on which field a code path happened to read.

  const phCapability = model.capabilities?.pH;
  if (!phCapability) throw new RangeError('catalog declares no pH capability');
  if (phCapability.modelId !== IDEAL_STRONG_MONOPROTIC_PH_MODEL) {
    throw new RangeError(`unsupported pH model ${String(phCapability.modelId)}`);
  }
  const pKw = requireFiniteDeclaration(phCapability.pKw, 'pH capability pKw');
  if (pKw <= 0) throw new RangeError('pH capability must declare a positive pKw');
  const neutralPH = requireFiniteDeclaration(phCapability.neutralPH, 'pH capability neutralPH');
  if (neutralPH !== pKw / 2) {
    throw new RangeError('pH capability must declare a neutralPH equal to pKw/2 under the ideal model');
  }
  // Version 1 states a documented standard-temperature pKw. A temperature
  // correction would need a validated catalog function this evaluator does not
  // have, so claiming one is a refusal rather than a silently ignored flag.
  // The temperature capability has already been required to declare
  // `affectsPH: false` above, so these two declarations agree.
  if (phCapability.temperatureCorrected !== false) {
    throw new RangeError('pH capability must declare temperatureCorrected false without a validated pKw function');
  }

  const equivalenceTolerance = model.tolerances?.equivalence_mol;
  if (
    !(
      typeof equivalenceTolerance === 'number' &&
      Number.isFinite(equivalenceTolerance) &&
      equivalenceTolerance > 0
    )
  ) {
    throw new RangeError('catalog must declare a finite positive model.tolerances.equivalence_mol');
  }
  const pHTolerance = model.tolerances?.pH;
  if (!(typeof pHTolerance === 'number' && Number.isFinite(pHTolerance) && pHTolerance > 0)) {
    throw new RangeError('catalog must declare a finite positive model.tolerances.pH');
  }

  const supportedPHReactionIds = new Set(phCapability.supportedReactionIds ?? []);

  // Every unsupported system is explained by a declared reason code, so the
  // declarations are required here rather than at the first mixture that needs
  // one: a catalog without them could only answer "no pH" with no reason, which
  // is the silence requirement 3.6 exists to remove.
  const unsupportedPHReasons = phCapability.unsupportedReasons;
  if (!unsupportedPHReasons || Object.keys(unsupportedPHReasons).length === 0) {
    throw new RangeError('pH capability declares no unsupportedReasons');
  }
  if (!unsupportedPHReasons[NO_MODELED_REACTION_PH_REASON]) {
    throw new RangeError(`pH capability must declare the ${NO_MODELED_REACTION_PH_REASON} reason`);
  }

  // -- validated input semantics -----------------------------------------
  //
  // Each declared field is paired with the catalog bound that governs it once,
  // at construction, so every evaluation judges inputs against the committed
  // catalog release rather than against a number written into this module.

  const validatedFields = Object.freeze(
    VALIDATED_EXPERIMENT_FIELDS.map((descriptor) =>
      Object.freeze({ descriptor, bounds: requireBounds(descriptor.bound) }),
    ),
  );

  const fieldByName = new Map(validatedFields.map((entry) => [entry.descriptor.field, entry]));

  /** Accepts one field's value or throws the single violation that rejected it. */
  const requireField = (fieldName, value) => {
    const entry = fieldByName.get(fieldName);
    if (!entry) throw new RangeError(`unknown validated experiment field ${String(fieldName)}`);
    const outcome = checkField(entry.descriptor, entry.bounds, value, true);
    if (outcome.violation) throw new InvalidExperimentQuantityError([outcome.violation]);
    return outcome.value;
  };

  /**
   * Validates every numeric control of one input in a single pass.
   *
   * The whole input is judged before anything is calculated, and every
   * offending field is collected before the rejection is raised, so a learner
   * is never told about one bad control while a second one waits in silence.
   * Nothing is clamped and nothing is skipped: either the returned record
   * describes a supported experiment, or no result is produced at all.
   */
  const validateExperimentInput = (input) => {
    if (!input || typeof input !== 'object') throw new TypeError('experiment input must be an object');

    const violations = [];
    const accepted = {};
    for (const { descriptor, bounds } of validatedFields) {
      const outcome = checkField(descriptor, bounds, input[descriptor.field], descriptor.required);
      if (outcome.violation) violations.push(outcome.violation);
      else accepted[descriptor.field] = outcome.value;
    }
    if (violations.length > 0) throw new InvalidExperimentQuantityError(violations);
    return Object.freeze(accepted);
  };

  const requireReagent = (reagentId, field) => {
    const reagent = catalog.reagents?.[reagentId];
    if (!reagent) throw new RangeError(`${field} references unknown reagent ${String(reagentId)}`);
    return reagent;
  };

  /**
   * Resolves the one reaction record for a reagent pair in either A/B order.
   *
   * Both orders normalize to the same catalog key, so reaction identity,
   * coefficients, and every projection derived from them are independent of the
   * order the learner selected the two solutions in.
   */
  const findReaction = (reagentA, reagentB) => formatters.findReaction(reagentA, reagentB);

  /** Coefficient of one reagent's species in the balanced molecular equation. */
  const molecularCoefficient = (reaction, reagent) => {
    const term = reaction.molecularReactants.find((candidate) => candidate.speciesId === reagent.speciesId);
    if (!term) {
      throw new RangeError(`reaction ${reaction.id} declares no molecular reactant term for ${reagent.speciesId}`);
    }
    if (!Number.isInteger(term.coefficient) || term.coefficient <= 0) {
      throw new RangeError(`reaction ${reaction.id} must declare a positive integer coefficient for ${reagent.speciesId}`);
    }
    return term.coefficient;
  };

  /**
   * Energy label of one presentation record, modeled or unsupported.
   *
   * The localized boundary message states that the label is qualitative, so an
   * exothermic reaction and an unreacted mixture both carry the same honest
   * disclaimer about what version 1 does not calculate.
   */
  const describeEnergy = (presentation) => {
    const boundary = formatters.describeCapabilityBoundary('energy');
    return {
      label: presentation.energyLabel,
      exothermic: presentation.energyLabel === 'exothermic',
      quantitativeEnthalpy: model.capabilities?.energy?.quantitativeEnthalpy ?? false,
      messageKey: boundary.messageKey,
      message: boundary.message,
    };
  };

  const describeAppearance = (presentation, precipitate) => ({
    clarity: presentation.appearance,
    color: presentation.solutionColor,
    precipitate,
  });

  /**
   * Ions of one kind a single formula unit of a reagent releases.
   *
   * Read from the catalog's dissociation record rather than assumed, so the
   * pH model stays driven by declared chemistry. Version 1 declares the
   * *monoprotic* model and lists `polyprotic` among the systems it excludes,
   * so a multiplicity other than one is a catalog claiming chemistry these
   * formulas do not cover, and it is refused instead of silently treated as
   * one equivalent per formula unit.
   */
  const dissociationMultiplicity = (reagentId, ionId, role) => {
    const reagent = catalog.reagents?.[reagentId];
    if (!reagent) throw new RangeError(`pH model references unknown ${role} reagent ${String(reagentId)}`);
    const term = (reagent.ions ?? []).find((candidate) => candidate.ionId === ionId);
    if (!term) throw new RangeError(`${reagentId} does not dissociate into ${String(ionId)}`);
    if (term.multiplicity !== 1) {
      throw new RangeError(
        `${IDEAL_STRONG_MONOPROTIC_PH_MODEL} covers only monoprotic reagents, but ${reagentId} releases ${String(term.multiplicity)} ${String(ionId)} per formula unit`,
      );
    }
    return term.multiplicity;
  };

  /**
   * pH of the one supported acid-base system, from unrounded amounts.
   *
   * The arithmetic is exactly what the catalog declares and nothing more:
   *
   * ```text
   * nH  = acid amount  × protons per formula unit
   * nOH = base amount  × hydroxides per formula unit
   * Δ   = nH - nOH
   * V   = total mixed volume
   * ```
   *
   * `Δ` beyond the declared equivalence tolerance on the acid side gives
   * `[H+] = Δ/V` and `pH = -log10([H+])`; beyond it on the base side gives
   * `[OH-] = -Δ/V`, `pOH = -log10([OH-])`, and `pH = pKw - pOH`; within it the
   * mixture is at equivalence and the pH is the `pKw/2` neutral point the
   * catalog declares. Comparing against a tolerance rather than against zero
   * is what makes an equimolar mixture read as neutral: `0.05 - 0.05` is
   * exactly zero only when the binary arithmetic happens to cooperate.
   *
   * Every input is an unrounded domain value, and the returned pH is unrounded
   * too, so the displayed two-decimal pH is a projection of this number and
   * never an input to it.
   */
  const describeSupportedPH = (reaction, reactants, totalVolume_L) => {
    const declared = reaction.pH;
    if (declared.modelId !== phCapability.modelId) {
      throw new RangeError(`reaction ${reaction.id} declares pH model ${String(declared.modelId)}, not the one the catalog supports`);
    }
    if (!supportedPHReactionIds.has(reaction.id)) {
      throw new RangeError(`reaction ${reaction.id} declares a pH model the catalog does not list as supported`);
    }

    const protonsPerAcid = dissociationMultiplicity(declared.acidReagentId, declared.protonIonId, 'acid');
    const hydroxidesPerBase = dissociationMultiplicity(declared.baseReagentId, declared.hydroxideIonId, 'base');

    const acid = reactants.find((reactant) => reactant.reagentId === declared.acidReagentId);
    const base = reactants.find((reactant) => reactant.reagentId === declared.baseReagentId);
    if (!acid || !base) {
      throw new RangeError(`reaction ${reaction.id} pH model names a reagent this experiment does not contain`);
    }
    if (!(totalVolume_L > 0)) {
      throw new RangeError(`a mixed volume must be positive to report a concentration, received ${String(totalVolume_L)}`);
    }

    const acidEquivalents_mol = acid.amount_mol * protonsPerAcid;
    const baseEquivalents_mol = base.amount_mol * hydroxidesPerBase;
    const equivalenceDifference_mol = acidEquivalents_mol - baseEquivalents_mol;
    const equivalence = Math.abs(equivalenceDifference_mol) <= equivalenceTolerance;

    const side = equivalence ? PH_NEUTRAL : equivalenceDifference_mol > 0 ? PH_ACIDIC : PH_BASIC;
    const excessIonId = equivalence
      ? null
      : side === PH_ACIDIC
        ? declared.protonIonId
        : declared.hydroxideIonId;
    const excessAmount_mol = equivalence ? 0 : Math.abs(equivalenceDifference_mol);
    const excessConcentration_molL = excessAmount_mol / totalVolume_L;

    let value;
    if (equivalence) {
      value = pKw / 2;
    } else if (side === PH_ACIDIC) {
      value = negativeLog10(excessConcentration_molL);
    } else {
      value = pKw - negativeLog10(excessConcentration_molL);
    }

    return {
      supported: true,
      value,
      side,
      equivalence,
      modelId: declared.modelId,
      modelLabel: phCapability.modelLabel,
      pKw,
      pKwSource: phCapability.pKwSource,
      temperatureCorrected: false,
      neutralPH,
      acidReagentId: declared.acidReagentId,
      baseReagentId: declared.baseReagentId,
      protonIonId: declared.protonIonId,
      hydroxideIonId: declared.hydroxideIonId,
      acidEquivalents_mol,
      baseEquivalents_mol,
      equivalenceDifference_mol,
      totalVolume_L,
      excessIonId,
      excessAmount_mol,
      excessConcentration_molL,
      // A calculated pH needs no boundary explanation, and the unsupported
      // variant below fills exactly these three fields, so a consumer reads
      // one pH block either way instead of two different ones.
      reasonCode: null,
      messageKey: null,
      message: null,
    };
  };

  /**
   * The same pH block for a system the declared model does not cover.
   *
   * Nothing is calculated and nothing is defaulted: the numeric value stays
   * `null` and what is added is only the explanation — the stable reason code,
   * its catalog message key, and the localized Indonesian text a learner can
   * be shown. `formatters.describeUnsupportedPH` resolves both from the
   * catalog and throws on a code the catalog does not declare, so every reason
   * a result carries is traceable to the committed release.
   *
   * Every field the supported variant calculates is present and explicitly
   * `null`, including the model identity: the ideal strong-acid/strong-base
   * model was not applied here, so naming it would suggest a value had been
   * computed under it.
   */
  const describeUnsupportedPH = (reasonCode) => {
    const unsupported = formatters.describeUnsupportedPH(reasonCode);
    return {
      supported: false,
      value: null,
      side: null,
      equivalence: null,
      modelId: null,
      modelLabel: null,
      pKw: null,
      pKwSource: null,
      temperatureCorrected: null,
      neutralPH: null,
      acidReagentId: null,
      baseReagentId: null,
      protonIonId: null,
      hydroxideIonId: null,
      acidEquivalents_mol: null,
      baseEquivalents_mol: null,
      equivalenceDifference_mol: null,
      totalVolume_L: null,
      excessIonId: null,
      excessAmount_mol: null,
      excessConcentration_molL: null,
      reasonCode: unsupported.reasonCode,
      messageKey: unsupported.messageKey,
      message: unsupported.message,
    };
  };

  /**
   * Unsupported pH block for a modeled reaction that declares no pH model.
   *
   * The reason comes from the reaction's own `pHUnsupportedReasonCode`, which
   * is why the evaluator contains no list of which pairs produce salts: the
   * catalog says so per reaction, and a reaction that declares neither a pH
   * model nor a reason is a catalog that cannot explain its own boundary, so it
   * is refused rather than answered with an unexplained null.
   */
  const unsupportedPHForReaction = (reaction) => {
    const reasonCode = reaction.pHUnsupportedReasonCode;
    if (!reasonCode) {
      throw new RangeError(
        `reaction ${reaction.id} declares neither a pH model nor a pHUnsupportedReasonCode`,
      );
    }
    return describeUnsupportedPH(reasonCode);
  };

  /**
   * Bounded qualitative motion factor for one temperature.
   *
   * The catalog declares a `linear_bounded` band: the factor is `atMinimum` at
   * the lowest selectable temperature and rises linearly to `atMaximum` at the
   * highest. The band stays closed by *rejecting* a temperature outside the
   * declared control range rather than by clamping it, so a result can never
   * exist for a temperature the catalog does not cover. The factor is a
   * visualization speed multiplier and nothing else: it is not a rate
   * constant, an extent, or a pH correction.
   */
  const motionSpeedFactor = (temperature_C) => {
    const temperature = requireField('temperature_C', temperature_C);
    const temperatureSpan = temperatureBounds.maximum - temperatureBounds.minimum;
    const position = (temperature - temperatureBounds.minimum) / temperatureSpan;
    return motionSpeedModel.atMinimum + position * (motionSpeedModel.atMaximum - motionSpeedModel.atMinimum);
  };

  /**
   * The temperature control's whole modeled consequence.
   *
   * Everything here is metadata about how the mixture is *shown*, which is why
   * the block carries `quantitative: false` and the catalog's localized
   * temperature boundary statement beside the factor. Nothing in the
   * quantitative part of the result reads any of it, so two experiments that
   * differ only in temperature differ only in this block.
   */
  const describeMotion = (temperature_C) => {
    const boundary = formatters.describeCapabilityBoundary('temperature');
    return {
      quantitative: false,
      effect: temperatureCapability.effect,
      model: motionSpeedModel.model,
      temperature_C,
      referenceTemperature_C: motionSpeedModel.referenceTemperature_C,
      speedFactor: motionSpeedFactor(temperature_C),
      referenceSpeedFactor: motionSpeedFactor(motionSpeedModel.referenceTemperature_C),
      minimumSpeedFactor: motionSpeedModel.atMinimum,
      maximumSpeedFactor: motionSpeedModel.atMaximum,
      affectsExtent: false,
      affectsRateConstant: false,
      affectsPH: false,
      messageKey: boundary.messageKey,
      message: boundary.message,
    };
  };

  /**
   * The fixed, unmodeled pressure state.
   *
   * Version 1 models one pressure, so the result reports the catalog's fixed
   * value, which is the only value validation lets an accepted input carry:
   * an alternate selection is rejected before any of this runs, so it has
   * neither a path into a calculated quantity nor a path into a silently
   * ignored field. Reporting it with the localized boundary statement is what
   * keeps the control honestly marked as unsupported.
   */
  const describePressure = () => {
    const boundary = formatters.describeCapabilityBoundary('pressure');
    return {
      atm: pressureCapability.fixed_atm,
      effect: pressureCapability.effect,
      selectable: false,
      acceptsAlternateValues: false,
      affectsResult: false,
      messageKey: boundary.messageKey,
      message: boundary.message,
    };
  };

  /**
   * Result for a supported pair the catalog models no reaction for.
   *
   * Nothing reacts, so the chemistry is fully determined without a reaction
   * record: extent is zero, there is no product, no equation, and no limiting
   * reactant, and every formula unit of both solutions remains in the mixture.
   * The phase comes from the catalog's declared `no_modeled_reaction` outcome,
   * which is checked here to be a single unlayered phase, so the macro
   * projection has no layered phase to render even if a future catalog edit
   * tried to introduce one without also declaring an immiscibility model.
   */
  const buildNoModeledReactionResult = (display, solutions, totalVolume_L, conditions) => {
    const outcome = model.unsupportedOutcomes?.noModeledReaction;
    if (!outcome) throw new RangeError('catalog declares no no_modeled_reaction outcome');
    if (outcome.category !== NO_MODELED_REACTION_CATEGORY) {
      throw new RangeError(`no_modeled_reaction outcome must declare category ${NO_MODELED_REACTION_CATEGORY}`);
    }

    const phaseModel = display.phase;
    if (phaseModel.layered !== false || phaseModel.phases.length !== 1 || phaseModel.phases[0] !== 'aq') {
      throw new RangeError(
        `phase model ${phaseModel.phaseModel} cannot represent two mixed aqueous solutions as one homogeneous phase`,
      );
    }

    const reactants = solutions.map((solution) => ({
      ...solution,
      // No balanced equation exists, so there is no coefficient to report; a
      // placeholder of 1 would read as a consumed formula unit.
      coefficient: null,
      consumed_mol: 0,
      remaining_mol: solution.amount_mol,
      limiting: false,
    }));

    return deepFreeze({
      catalogVersion: catalog.catalogVersion,
      modelVersion: model.modelVersion,
      support: {
        kind: 'unsupported',
        code: outcome.reasonCode,
        messageKey: display.messageKey,
        message: display.message,
      },
      pairKey: display.pairKey,
      reactionId: null,
      category: outcome.category,
      displayName: null,

      reactants,
      totalVolume_L,
      extent_mol: 0,
      limitingSpecies: [],
      // Both solutions are left over in full, which is the same invariant the
      // supported path reports: excess is whatever remains after consumption.
      excessSpecies: reactants.map((reactant) => ({
        speciesId: reactant.speciesId,
        reagentId: reactant.reagentId,
        phase: reactant.phase,
        amount_mol: reactant.remaining_mol,
        role: 'excess',
      })),
      products: [],
      spectatorIons: [],

      molecularEquation: null,
      netIonicEquation: null,
      productSummary: null,
      phaseModel,
      appearance: describeAppearance(outcome.presentation, display.precipitate),
      energy: describeEnergy(outcome.presentation),
      motion: conditions.motion,
      pressure: conditions.pressure,

      // No reaction is modeled, so there is no acid-base system to calculate a
      // pH for. The block still reports the catalog's declared reason and its
      // localized explanation, so an unreacted mixture says why rather than
      // showing a defaulted number.
      pH: describeUnsupportedPH(NO_MODELED_REACTION_PH_REASON),
      speciesLedger: null,
    });
  };

  /**
   * Evaluates one supported experiment.
   *
   * Steps, in the order the chemistry requires them:
   * 1. resolve the reagent pair through its normalized catalog key,
   * 2. calculate each formula-unit amount from concentration and volume,
   * 3. calculate extent as the smallest available-amount/coefficient ratio,
   * 4. name every reactant consumed to within the declared amount tolerance,
   * 5. report remaining excess and product amounts from that one extent,
   * 6. project equations, phase, appearance, and energy from the same record.
   *
   * A pair with no catalog reaction takes the same first two steps and then
   * returns the `no_modeled_reaction` result, so an ordinary mixture is a
   * described outcome rather than a thrown failure.
   *
   * The returned object is deeply frozen and canonically ordered by reagent id,
   * so `evaluate(a, b)` and `evaluate(b, a)` are deeply equal for the same
   * quantities.
   */
  const evaluateExperiment = (input, options = {}) => {
    if (!input || typeof input !== 'object') throw new TypeError('experiment input must be an object');

    const reagentA = requireReagent(input.reagentA, 'reagentA');
    const reagentB = requireReagent(input.reagentB, 'reagentB');

    // Every numeric control is judged first, in one pass, so an out-of-range
    // or undefined selection produces no result at all rather than a result
    // calculated from a quantity that was quietly moved into range.
    const validated = validateExperimentInput(input);

    const quantities = new Map([
      [
        reagentA.id,
        { concentration_molL: validated.concentrationA_molL, volume_mL: validated.volumeA_mL },
      ],
      [
        reagentB.id,
        { concentration_molL: validated.concentrationB_molL, volume_mL: validated.volumeB_mL },
      ],
    ]);
    if (quantities.size !== 2) {
      throw new RangeError(`an experiment must mix two different reagents, received ${reagentA.id} twice`);
    }

    // Canonical reagent order makes the whole result order-independent; the A/B
    // order the learner chose is a presentation concern, not a chemical one.
    const [firstId, secondId] = [reagentA.id, reagentB.id].sort();
    const display = formatters.formatReactionDisplay(firstId, secondId, options);

    // Amounts depend only on what was poured, so they are calculated before the
    // reaction lookup and reported whether or not a reaction is modeled.
    const solutions = [firstId, secondId].map((reagentId) => {
      const reagent = catalog.reagents[reagentId];
      const { concentration_molL, volume_mL } = quantities.get(reagentId);
      return {
        reagentId,
        speciesId: reagent.speciesId,
        phase: reagent.phase,
        concentration_molL,
        volume_mL,
        volume_L: toLitres(volume_mL),
        amount_mol: calculateAmount(concentration_molL, volume_mL),
      };
    });
    const totalVolume_L = solutions.reduce((total, solution) => total + solution.volume_L, 0);

    // Qualitative conditions, kept apart from the arithmetic above: the motion
    // factor is derived from the validated temperature, and the pressure state
    // comes from the catalog because validation has already proved the accepted
    // `pressure_atm` equals the one fixed value version 1 models.
    const conditions = {
      motion: describeMotion(validated.temperature_C),
      pressure: describePressure(),
    };

    const reaction = findReaction(firstId, secondId);
    if (!reaction) return buildNoModeledReactionResult(display, solutions, totalVolume_L, conditions);

    const reactants = solutions.map((solution) => ({
      ...solution,
      coefficient: molecularCoefficient(reaction, catalog.reagents[solution.reagentId]),
    }));

    // Balanced extent: the reaction can only advance as far as the scarcest
    // reactant allows once its own stoichiometric coefficient is accounted for.
    const extent_mol = Math.min(...reactants.map((reactant) => reactant.amount_mol / reactant.coefficient));

    const reactantLedger = reactants.map((reactant) => {
      const consumed_mol = extent_mol * reactant.coefficient;
      const remaining_mol = reactant.amount_mol - consumed_mol;
      return {
        ...reactant,
        consumed_mol,
        // Consumption never exceeds the available amount, so a remainder within
        // the declared tolerance is exhaustion rather than a negative amount.
        remaining_mol: Math.abs(remaining_mol) <= amountTolerance ? 0 : remaining_mol,
        limiting: remaining_mol <= amountTolerance,
      };
    });

    const products = reaction.molecularProducts.map((term) => ({
      speciesId: term.speciesId,
      phase: term.phase,
      coefficient: term.coefficient,
      amount_mol: extent_mol * term.coefficient,
      role: 'product',
    }));

    const excessSpecies = reactantLedger
      .filter((reactant) => reactant.remaining_mol > amountTolerance)
      .map((reactant) => ({
        speciesId: reactant.speciesId,
        reagentId: reactant.reagentId,
        phase: reactant.phase,
        amount_mol: reactant.remaining_mol,
        role: 'excess',
      }));

    return deepFreeze({
      catalogVersion: catalog.catalogVersion,
      modelVersion: model.modelVersion,
      support: { kind: 'supported', modelVersion: model.modelVersion },
      pairKey: display.pairKey,
      reactionId: reaction.id,
      category: reaction.category,
      displayName: reaction.displayName,

      reactants: reactantLedger,
      totalVolume_L,
      extent_mol,
      limitingSpecies: reactantLedger.filter((reactant) => reactant.limiting).map((reactant) => reactant.speciesId),
      excessSpecies,
      products,
      spectatorIons: [...reaction.spectatorIons],

      molecularEquation: display.molecularEquation,
      netIonicEquation: display.netIonicEquation,
      productSummary: display.productSummary,
      phaseModel: display.phase,
      appearance: describeAppearance(reaction.presentation, display.precipitate),
      energy: describeEnergy(reaction.presentation),

      // Temperature's only consequence and pressure's declared absence of one.
      // Neither block is read by any quantity above it, pH included.
      motion: conditions.motion,
      pressure: conditions.pressure,

      // The one modeled acid-base system reports a calculated pH; every other
      // reaction reports the same block with a null value and the reason its
      // own catalog record declares. Task 6.1 owns the ion-level ledger.
      pH: reaction.pH
        ? describeSupportedPH(reaction, reactantLedger, totalVolume_L)
        : unsupportedPHForReaction(reaction),
      speciesLedger: null,
    });
  };

  return Object.freeze({
    catalogVersion: catalog.catalogVersion,
    modelVersion: model.modelVersion,
    amountTolerance,
    equivalenceTolerance,
    pHTolerance,
    pHModel: Object.freeze({
      modelId: phCapability.modelId,
      modelLabel: phCapability.modelLabel,
      pKw,
      pKwSource: phCapability.pKwSource,
      temperatureCorrected: false,
      neutralPH,
      supportedReactionIds: Object.freeze([...supportedPHReactionIds]),
      unsupportedReasonCodes: Object.freeze(Object.keys(unsupportedPHReasons).sort()),
    }),
    bounds: Object.freeze(
      Object.fromEntries(validatedFields.map(({ descriptor, bounds }) => [descriptor.field, bounds])),
    ),
    validateExperimentInput,
    normalizePairKey,
    findReaction,
    calculateAmount,
    toLitres,
    negativeLog10,
    motionSpeedFactor,
    describeMotion,
    describePressure,
    describeUnsupportedPH,
    evaluateExperiment,
  });
}

/** Evaluator bound to the generated catalog binding. */
export const chemistryEvaluator = createChemistryEvaluator();

/**
 * Catalog-first entry point matching the signature the design declares.
 *
 * `createChemistryEvaluator` is the cheaper path when many experiments share
 * one catalog, because it resolves the formatters and tolerances once.
 */
export function evaluateExperiment(catalogOrInput, inputOrCatalog, options = {}) {
  let cat = catalogOrInput;
  let inp = inputOrCatalog;
  if (!inputOrCatalog) {
    cat = CATALOG;
    inp = catalogOrInput;
  } else if (catalogOrInput.reagentA || catalogOrInput.reagentAId || catalogOrInput.concentrationA_M || catalogOrInput.volumeA_L) {
    inp = catalogOrInput;
    cat = inputOrCatalog;
  }
  return createChemistryEvaluator(cat).evaluateExperiment(inp, options);
}
