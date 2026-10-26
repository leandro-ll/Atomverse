/**
 * Scientific and referential invariants of the canonical chemistry catalog.
 *
 * The JSON Schema in `catalog/chemistry.schema.json` constrains shape: required
 * fields, enumerations, positive integers, nonzero charges. It cannot express
 * the invariants that make the catalog *chemically* usable, which this module
 * owns:
 *
 * - formula composition agreement between structural terms, element counts, and
 *   the ASCII formula (so a malformed `AgNO` can never reach a renderer),
 * - elemental balance and charge balance of every molecular and net ionic
 *   equation,
 * - reference integrity across species, ions, reagents, reactions, inverse
 *   targets, phases, phase models, and localized messages,
 * - normalized, order-independent, unique reaction pair keys.
 *
 * Every check returns machine-readable violations rather than throwing, so a
 * caller can report all problems in one pass.
 */

/** Order-independent reagent pair key: both identifiers sorted and pipe joined. */
export function normalizePairKey(reagentA, reagentB) {
  return [reagentA, reagentB].sort().join('|');
}

function violation(code, path, message) {
  return { code, path, message };
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function addCounts(target, counts, factor = 1) {
  for (const [element, count] of Object.entries(counts ?? {})) {
    target[element] = (target[element] ?? 0) + count * factor;
  }
  return target;
}

/** Drops zero entries and sorts keys so two totals can be compared and printed. */
function normalizeCounts(counts) {
  const normalized = {};
  for (const element of Object.keys(counts).sort()) {
    if (counts[element] !== 0) normalized[element] = counts[element];
  }
  return normalized;
}

function formatCounts(counts) {
  const normalized = normalizeCounts(counts);
  const entries = Object.entries(normalized);
  if (entries.length === 0) return '(nothing)';
  return entries.map(([element, count]) => `${element}${count}`).join(' ');
}

function countsEqual(left, right) {
  const a = normalizeCounts(left);
  const b = normalizeCounts(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Flattens structural formula terms into element counts, expanding nested
 * groups by their multiplicity.
 */
export function flattenFormulaTerms(terms, factor = 1, counts = {}) {
  for (const term of terms ?? []) {
    const multiplier = isPositiveInteger(term?.count) ? term.count : Number.NaN;
    if (!Number.isFinite(multiplier)) return null;
    if (Array.isArray(term.group)) {
      if (flattenFormulaTerms(term.group, factor * multiplier, counts) === null) return null;
      continue;
    }
    if (typeof term?.element !== 'string') return null;
    counts[term.element] = (counts[term.element] ?? 0) + factor * multiplier;
  }
  return counts;
}

/**
 * Parses the element body of an ASCII formula into element counts.
 *
 * Supported grammar: element symbols with optional counts and parenthesized
 * groups with optional counts. Throws on malformed input.
 */
function parseFormulaBody(body, formula) {
  if (body.length === 0) throw new SyntaxError(`formula ${formula} has no element body`);

  let index = 0;

  const readCount = () => {
    const match = /^\d+/u.exec(body.slice(index));
    if (!match) return 1;
    index += match[0].length;
    const count = Number(match[0]);
    if (!isPositiveInteger(count)) throw new SyntaxError(`formula ${formula} has a non-positive count`);
    return count;
  };

  const readSequence = (depth) => {
    const counts = {};
    while (index < body.length) {
      const character = body[index];
      if (character === ')') break;
      if (character === '(') {
        index += 1;
        const group = readSequence(depth + 1);
        if (body[index] !== ')') throw new SyntaxError(`formula ${formula} has an unclosed group`);
        index += 1;
        addCounts(counts, group, readCount());
        continue;
      }
      const symbol = /^[A-Z][a-z]?/u.exec(body.slice(index));
      if (!symbol) throw new SyntaxError(`formula ${formula} has an unexpected character at position ${index}`);
      index += symbol[0].length;
      counts[symbol[0]] = (counts[symbol[0]] ?? 0) + readCount();
    }
    if (depth === 0 && index !== body.length) {
      throw new SyntaxError(`formula ${formula} has trailing characters at position ${index}`);
    }
    return counts;
  };

  const counts = readSequence(0);
  if (Object.keys(counts).length === 0) throw new SyntaxError(`formula ${formula} declares no element`);
  return counts;
}

/**
 * Parses an ASCII formula into every consistent reading of its composition and
 * net charge.
 *
 * A trailing charge token is written as a sign with an optional magnitude, which
 * makes digits before the sign ambiguous in plain ASCII: `NO3-` is nitrate with
 * charge -1, while `Pb2+` is lead(II) with charge +2. Rather than privileging
 * one reading, this parser returns both and the caller requires the declared
 * composition and charge to agree under one of them. A space before the
 * magnitude (`SO4 2-`) removes the ambiguity, leaving a single reading, and a
 * malformed formula such as `AgNO` or `Pb(NO)2` matches no reading at all.
 */
export function parseFormulaAsciiReadings(formula) {
  if (typeof formula !== 'string' || formula.length === 0) {
    throw new SyntaxError('formula must be a non-empty string');
  }

  const chargeMatch = /(\s?)(\d*)([+-])$/u.exec(formula);
  if (!chargeMatch) {
    return [{ counts: parseFormulaBody(formula, formula), charge: 0 }];
  }

  const [token, space, digits, sign] = chargeMatch;
  const polarity = sign === '+' ? 1 : -1;
  const readings = [];
  const errors = [];

  const addReading = (body, charge) => {
    try {
      readings.push({ counts: parseFormulaBody(body, formula), charge });
    } catch (error) {
      errors.push(error);
    }
  };

  // Reading A: the magnitude digits belong to the charge.
  addReading(formula.slice(0, formula.length - token.length), polarity * (digits === '' ? 1 : Number(digits)));

  // Reading B: the digits belong to the formula and the sign carries magnitude
  // one. A space before the digits rules this reading out.
  if (digits !== '' && space === '') {
    addReading(formula.slice(0, formula.length - sign.length), polarity);
  }

  if (readings.length === 0) throw errors[0];
  return readings;
}

/** The primary reading of an ASCII formula: `{ counts, charge }`. */
export function parseFormulaAscii(formula) {
  return parseFormulaAsciiReadings(formula)[0];
}

function definitionOf(catalog, id) {
  return catalog.species?.[id] ?? catalog.ions?.[id] ?? null;
}

function chargeOf(definition) {
  return Number.isInteger(definition?.charge) ? definition.charge : 0;
}

/**
 * Verifies that structural terms, declared element counts, and the ASCII
 * formula describe the same composition and charge for every species and ion.
 */
export function collectFormulaViolations(catalog) {
  const violations = [];
  const elements = new Set(Array.isArray(catalog.elements) ? catalog.elements : Object.keys(catalog.elements ?? {}));

  const entries = [
    ...Object.entries(catalog.species ?? {}).map(([id, definition]) => ['species', id, definition]),
    ...Object.entries(catalog.ions ?? {}).map(([id, definition]) => ['ions', id, definition]),
  ];

  for (const [collection, id, definition] of entries) {
    const path = `${collection}.${id}`;
    const declared = definition?.elementCounts;

    const structural = flattenFormulaTerms(definition?.formulaTerms);
    if (structural === null) {
      violations.push(
        violation('FORMULA_TERMS_MALFORMED', path, `${path} structural formula terms are malformed`),
      );
    } else {
      for (const element of Object.keys(structural)) {
        if (!elements.has(element)) {
          violations.push(
            violation('ELEMENT_UNKNOWN', path, `${path} structural terms reference untracked element ${element}`),
          );
        }
      }
      if (!countsEqual(structural, declared ?? {})) {
        violations.push(
          violation(
            'FORMULA_COMPOSITION_MISMATCH',
            path,
            `${path} structural terms flatten to ${formatCounts(structural)} but elementCounts declares ${formatCounts(declared ?? {})}`,
          ),
        );
      }
    }

    for (const element of Object.keys(declared ?? {})) {
      if (!elements.has(element)) {
        violations.push(
          violation('ELEMENT_UNKNOWN', path, `${path} elementCounts references untracked element ${element}`),
        );
      }
    }

    let readings = null;
    try {
      readings = parseFormulaAsciiReadings(definition?.formulaAscii);
    } catch (error) {
      violations.push(
        violation('FORMULA_ASCII_UNPARSABLE', path, `${path} formulaAscii cannot be parsed: ${error.message}`),
      );
    }
    if (readings) {
      const expectedCharge = chargeOf(definition);
      const consistent = readings.some(
        (reading) => reading.charge === expectedCharge && countsEqual(reading.counts, declared ?? {}),
      );
      if (!consistent) {
        const readingsLabel = readings
          .map((reading) => `${formatCounts(reading.counts)} charge ${reading.charge}`)
          .join(' or ');
        violations.push(
          violation(
            'FORMULA_ASCII_MISMATCH',
            path,
            `${path} formulaAscii ${definition.formulaAscii} reads as ${readingsLabel} but the definition declares ${formatCounts(declared ?? {})} charge ${expectedCharge}`,
          ),
        );
      }
    }
  }

  return violations;
}

function collectMessageKeyReferences(value, keys, path = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectMessageKeyReferences(item, keys, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) {
      const childPath = path === '' ? name : `${path}.${name}`;
      if (
        typeof item === 'string' &&
        (name === 'messageKey' || name === 'descriptionKey' || name === 'scaleDisclosureKey')
      ) {
        keys.set(item, childPath);
      } else {
        collectMessageKeyReferences(item, keys, childPath);
      }
    }
  }
}

/** Verifies that every identifier referenced inside the catalog resolves. */
export function collectReferenceViolations(catalog) {
  const violations = [];
  const phases = new Set(catalog.phases ?? []);
  const reactionIds = new Set(Object.values(catalog.reactions ?? {}).map((reaction) => reaction.id));

  const requireReference = (present, code, path, message) => {
    if (!present) violations.push(violation(code, path, message));
  };

  const checkPhases = (declaredPhases, path) => {
    for (const phase of declaredPhases ?? []) {
      requireReference(phases.has(phase), 'PHASE_UNKNOWN', path, `${path} declares undeclared phase ${String(phase)}`);
    }
  };

  for (const [id, species] of Object.entries(catalog.species ?? {})) {
    checkPhases(species.phases, `species.${id}`);
  }
  for (const [id, ion] of Object.entries(catalog.ions ?? {})) {
    checkPhases(ion.phases, `ions.${id}`);
  }

  for (const [id, reagent] of Object.entries(catalog.reagents ?? {})) {
    const path = `reagents.${id}`;
    requireReference(
      Boolean(catalog.species?.[reagent.speciesId]),
      'SPECIES_UNKNOWN',
      path,
      `${path} references unknown species ${String(reagent.speciesId)}`,
    );
    requireReference(phases.has(reagent.phase), 'PHASE_UNKNOWN', path, `${path} declares undeclared phase ${String(reagent.phase)}`);
    for (const term of reagent.ions ?? []) {
      requireReference(
        Boolean(catalog.ions?.[term.ionId]),
        'ION_UNKNOWN',
        path,
        `${path} references unknown ion ${String(term.ionId)}`,
      );
    }
  }

  for (const [key, reaction] of Object.entries(catalog.reactions ?? {})) {
    const path = `reactions["${key}"]`;

    for (const reagentId of reaction.reactantSet ?? []) {
      requireReference(
        Boolean(catalog.reagents?.[reagentId]),
        'REAGENT_UNKNOWN',
        path,
        `${path} references unknown reagent ${String(reagentId)}`,
      );
    }

    for (const side of ['molecularReactants', 'molecularProducts', 'netIonicReactants', 'netIonicProducts']) {
      for (const term of reaction[side] ?? []) {
        const definition = definitionOf(catalog, term.speciesId);
        if (!definition) {
          violations.push(
            violation('SPECIES_UNKNOWN', `${path}.${side}`, `${path}.${side} references unknown species ${String(term.speciesId)}`),
          );
          continue;
        }
        requireReference(
          definition.phases?.includes(term.phase),
          'PHASE_UNDECLARED_FOR_SPECIES',
          `${path}.${side}`,
          `${path}.${side} uses phase ${String(term.phase)} that ${term.speciesId} does not declare`,
        );
      }
    }

    for (const ionId of reaction.spectatorIons ?? []) {
      requireReference(
        Boolean(catalog.ions?.[ionId]),
        'ION_UNKNOWN',
        path,
        `${path} references unknown spectator ion ${String(ionId)}`,
      );
    }

    requireReference(
      Boolean(catalog.model?.phaseModels?.[reaction.phaseModel]),
      'PHASE_MODEL_UNKNOWN',
      path,
      `${path} references unknown phase model ${String(reaction.phaseModel)}`,
    );

    for (const tag of reaction.targetTags ?? []) {
      requireReference(
        Boolean(catalog.inverseTargets?.[tag]),
        'INVERSE_TARGET_UNKNOWN',
        path,
        `${path} references unknown inverse target ${String(tag)}`,
      );
    }

    const precipitateId = reaction.presentation?.precipitateSpeciesId;
    if (precipitateId !== null && precipitateId !== undefined) {
      requireReference(
        Boolean(catalog.species?.[precipitateId]),
        'SPECIES_UNKNOWN',
        path,
        `${path} presentation references unknown precipitate species ${String(precipitateId)}`,
      );
    }

    if (reaction.pH) {
      for (const field of ['acidReagentId', 'baseReagentId']) {
        requireReference(
          Boolean(catalog.reagents?.[reaction.pH[field]]),
          'REAGENT_UNKNOWN',
          path,
          `${path} pH model references unknown reagent ${String(reaction.pH[field])}`,
        );
      }
      for (const field of ['protonIonId', 'hydroxideIonId']) {
        requireReference(
          Boolean(catalog.ions?.[reaction.pH[field]]),
          'ION_UNKNOWN',
          path,
          `${path} pH model references unknown ion ${String(reaction.pH[field])}`,
        );
      }
    }

    if (reaction.pHUnsupportedReasonCode !== null && reaction.pHUnsupportedReasonCode !== undefined) {
      requireReference(
        Boolean(catalog.model?.capabilities?.pH?.unsupportedReasons?.[reaction.pHUnsupportedReasonCode]),
        'PH_REASON_UNKNOWN',
        path,
        `${path} references undeclared pH reason code ${String(reaction.pHUnsupportedReasonCode)}`,
      );
    }
  }

  for (const [id, target] of Object.entries(catalog.inverseTargets ?? {})) {
    const path = `inverseTargets.${id}`;
    for (const reactionId of target.reactionIds ?? []) {
      requireReference(
        reactionIds.has(reactionId),
        'REACTION_UNKNOWN',
        path,
        `${path} references unknown reaction ${String(reactionId)}`,
      );
    }
    if (target.speciesId !== null && target.speciesId !== undefined) {
      requireReference(
        Boolean(catalog.species?.[target.speciesId]),
        'SPECIES_UNKNOWN',
        path,
        `${path} references unknown species ${String(target.speciesId)}`,
      );
    }
  }

  const pH = catalog.model?.capabilities?.pH ?? {};
  for (const reactionId of pH.supportedReactionIds ?? []) {
    requireReference(
      reactionIds.has(reactionId),
      'REACTION_UNKNOWN',
      'model.capabilities.pH',
      `model.capabilities.pH references unknown reaction ${String(reactionId)}`,
    );
  }
  for (const pair of pH.supportedReagentPairs ?? []) {
    const key = normalizePairKey(pair[0], pair[1]);
    requireReference(
      Boolean(catalog.reactions?.[key]),
      'REACTION_UNKNOWN',
      'model.capabilities.pH',
      `model.capabilities.pH references reagent pair ${key} with no catalog reaction`,
    );
  }

  for (const [name, phaseModel] of Object.entries(catalog.model?.phaseModels ?? {})) {
    checkPhases(phaseModel.phases, `model.phaseModels.${name}`);
  }
  const noModeledReaction = catalog.model?.unsupportedOutcomes?.noModeledReaction;
  if (noModeledReaction) {
    requireReference(
      Boolean(catalog.model?.phaseModels?.[noModeledReaction.phaseModel]),
      'PHASE_MODEL_UNKNOWN',
      'model.unsupportedOutcomes.noModeledReaction',
      `model.unsupportedOutcomes.noModeledReaction references unknown phase model ${String(noModeledReaction.phaseModel)}`,
    );
  }

  const locale = catalog.locale;
  const messages = catalog.messages?.[locale] ?? {};
  const referencedKeys = new Map();
  collectMessageKeyReferences({ ...catalog, messages: undefined }, referencedKeys);
  for (const [key, usagePath] of referencedKeys) {
    requireReference(
      typeof messages[key] === 'string' && messages[key].trim().length > 0,
      'MESSAGE_KEY_UNKNOWN',
      usagePath,
      `${usagePath} references message key ${key} with no ${String(locale)} text`,
    );
  }

  return violations;
}

/**
 * Totals the element counts and net charge of one side of an equation, applying
 * each term's integer coefficient. `resolved` is false when a term references an
 * unknown species or lacks a positive integer coefficient, in which case the
 * totals are incomplete and balance cannot be decided.
 */
export function computeEquationTotals(catalog, terms) {
  const counts = {};
  let charge = 0;
  let resolved = true;

  for (const term of terms ?? []) {
    const definition = definitionOf(catalog, term.speciesId);
    if (!definition || !isPositiveInteger(term.coefficient)) {
      resolved = false;
      continue;
    }
    addCounts(counts, definition.elementCounts ?? {}, term.coefficient);
    charge += chargeOf(definition) * term.coefficient;
  }

  return { counts, charge, resolved };
}

/**
 * Verifies that every molecular and net ionic equation conserves elements and
 * charge with the declared integer coefficients.
 */
export function collectBalanceViolations(catalog) {
  const violations = [];

  for (const [key, reaction] of Object.entries(catalog.reactions ?? {})) {
    const equations = [
      ['molecular', reaction.molecularReactants, reaction.molecularProducts],
      ['netIonic', reaction.netIonicReactants, reaction.netIonicProducts],
    ];

    for (const [label, reactantTerms, productTerms] of equations) {
      const path = `reactions["${key}"].${label}`;
      const reactants = computeEquationTotals(catalog, reactantTerms);
      const products = computeEquationTotals(catalog, productTerms);

      if (!reactants.resolved || !products.resolved) {
        violations.push(
          violation('BALANCE_UNVERIFIABLE', path, `${path} cannot be balanced because a term is unknown or has a non-positive integer coefficient`),
        );
        continue;
      }

      if (!countsEqual(reactants.counts, products.counts)) {
        violations.push(
          violation(
            'ELEMENT_BALANCE_VIOLATION',
            path,
            `${path} consumes ${formatCounts(reactants.counts)} but produces ${formatCounts(products.counts)}`,
          ),
        );
      }

      if (reactants.charge !== products.charge) {
        violations.push(
          violation(
            'CHARGE_BALANCE_VIOLATION',
            path,
            `${path} consumes net charge ${reactants.charge} but produces net charge ${products.charge}`,
          ),
        );
      }
    }

  }

  // Dissociation must conserve both composition and charge: the released ions
  // must rebuild the dissolved species and must cancel to a neutral solution.
  for (const [id, reagent] of Object.entries(catalog.reagents ?? {})) {
    const species = catalog.species?.[reagent.speciesId];
    if (!species) continue;
    const dissociated = {};
    let charge = 0;
    let resolved = true;
    for (const term of reagent.ions ?? []) {
      const ion = catalog.ions?.[term.ionId];
      if (!ion || !isPositiveInteger(term.multiplicity)) {
        resolved = false;
        continue;
      }
      addCounts(dissociated, ion.elementCounts ?? {}, term.multiplicity);
      charge += chargeOf(ion) * term.multiplicity;
    }
    if (!resolved) continue;
    if (charge !== 0) {
      violations.push(
        violation(
          'CHARGE_BALANCE_VIOLATION',
          `reagents.${id}`,
          `reagents.${id} dissociation terms carry net charge ${charge} instead of being electroneutral`,
        ),
      );
    }
    if (!countsEqual(dissociated, species.elementCounts ?? {})) {
      violations.push(
        violation(
          'ELEMENT_BALANCE_VIOLATION',
          `reagents.${id}`,
          `reagents.${id} dissociates into ${formatCounts(dissociated)} but species ${reagent.speciesId} declares ${formatCounts(species.elementCounts ?? {})}`,
        ),
      );
    }
  }

  return violations;
}

/**
 * Verifies that reaction records are keyed by their normalized, order
 * independent reagent pair and that no pair or reaction identifier repeats.
 */
export function collectPairKeyViolations(catalog) {
  const violations = [];
  const seenPairs = new Map();
  const seenIds = new Map();

  for (const [key, reaction] of Object.entries(catalog.reactions ?? {})) {
    const path = `reactions["${key}"]`;
    const reactantSet = Array.isArray(reaction.reactantSet) ? reaction.reactantSet : [];

    if (reactantSet.length !== 2) {
      violations.push(violation('PAIR_KEY_MALFORMED', path, `${path} must declare exactly two reagents`));
      continue;
    }
    if (reactantSet[0] === reactantSet[1]) {
      violations.push(violation('PAIR_KEY_MALFORMED', path, `${path} must pair two distinct reagents`));
      continue;
    }

    const normalized = normalizePairKey(reactantSet[0], reactantSet[1]);
    if (normalized !== key) {
      violations.push(
        violation('PAIR_KEY_NOT_NORMALIZED', path, `${path} must be keyed by its normalized reagent pair ${normalized}`),
      );
    }

    const previousPair = seenPairs.get(normalized);
    if (previousPair) {
      violations.push(
        violation('PAIR_KEY_DUPLICATE', path, `${path} repeats the reagent pair ${normalized} already defined by ${previousPair}`),
      );
    } else {
      seenPairs.set(normalized, path);
    }

    const previousId = seenIds.get(reaction.id);
    if (previousId) {
      violations.push(
        violation('REACTION_ID_DUPLICATE', path, `${path} repeats reaction id ${String(reaction.id)} already defined by ${previousId}`),
      );
    } else {
      seenIds.set(reaction.id, path);
    }
  }

  return violations;
}

/** Collects every scientific and referential invariant violation. */
export function collectInvariantViolations(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    return [violation('CATALOG_MALFORMED', '$', 'catalog must be a JSON object')];
  }
  return [
    ...collectFormulaViolations(catalog),
    ...collectReferenceViolations(catalog),
    ...collectBalanceViolations(catalog),
    ...collectPairKeyViolations(catalog),
  ];
}
