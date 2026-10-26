/**
 * Catalog-drawn test generators for frontend chemistry property tests.
 *
 * Validates: Requirements 12.3, 12.4
 * - arbSelectableReagent
 * - arbReagentPair
 * - arbKspPair
 * - arbConcentration (ranges straddling ~0.0515 M threshold)
 * - arbVolume
 * - arbInput
 * - Smoke assertion that selectable count equals coverage report's selectableReagentCount (52)
 * - Coverage assertion that both saturation branches are observed in a sample.
 */

import { CATALOG } from '../../../js/generated/chemistry-catalog.js';
import { evaluateExperiment } from '../../../js/domain/chemistry-evaluator.js';

export const SELECTABLE_REAGENTS = CATALOG.substances.filter((s) => s.selectable);
export const SELECTABLE_MAP = new Map(SELECTABLE_REAGENTS.map((s) => [s.id, s]));

export const KSP_REACTIONS = CATALOG.reactions.filter((r) => r.kspRef && r.candidateSolidId);
export const KSP_REACTION_PAIRS = KSP_REACTIONS.map((r) => r.reactantIds);

export const PBCL2_THRESHOLD_M = 0.051426;

export function assertSelectableCountSmoke(expectedCount = 52) {
  const actual = SELECTABLE_REAGENTS.length;
  if (actual !== expectedCount) {
    throw new Error(`Selectable count mismatch: expected ${expectedCount}, got ${actual}`);
  }
}

export function arbSelectableReagent(rng = Math.random) {
  const idx = Math.floor(rng() * SELECTABLE_REAGENTS.length);
  return SELECTABLE_REAGENTS[idx];
}

export function arbReagentPair(rng = Math.random) {
  const idx1 = Math.floor(rng() * SELECTABLE_REAGENTS.length);
  let idx2 = Math.floor(rng() * (SELECTABLE_REAGENTS.length - 1));
  if (idx2 >= idx1) idx2++;
  return [SELECTABLE_REAGENTS[idx1], SELECTABLE_REAGENTS[idx2]];
}

export function arbKspPair(rng = Math.random) {
  const idx = Math.floor(rng() * KSP_REACTION_PAIRS.length);
  const pair = KSP_REACTION_PAIRS[idx];
  return [pair[0], pair[1]];
}

export function arbConcentration(rng = Math.random, mode = null) {
  if (mode === 'dilute') {
    return 0.001 + rng() * 0.044;
  } else if (mode === 'concentrated') {
    return 0.055 + rng() * 1.945;
  } else {
    return rng() < 0.5 ? 0.001 + rng() * 0.099 : 0.1 + rng() * 1.9;
  }
}

export function arbVolume(rng = Math.random) {
  return Math.round((10.0 + rng() * 90.0) * 10) / 10;
}

export function arbInput(rng = Math.random, { kspOnly = false, mode = null } = {}) {
  let idA, idB;
  if (kspOnly) {
    [idA, idB] = arbKspPair(rng);
  } else {
    const [sA, sB] = arbReagentPair(rng);
    idA = sA.id;
    idB = sB.id;
  }

  return {
    reagentAId: idA,
    reagentBId: idB,
    concentrationA_M: arbConcentration(rng, mode),
    concentrationB_M: arbConcentration(rng, mode),
    volumeA_mL: arbVolume(rng),
    volumeB_mL: arbVolume(rng),
  };
}

export function assertSaturationBranchesObserved(rng = Math.random, sampleSize = 50) {
  const outcomes = new Set();
  for (let i = 0; i < sampleSize; i++) {
    const mode = i % 2 === 0 ? 'concentrated' : 'dilute';
    const input = arbInput(rng, { kspOnly: true, mode });
    const res = evaluateExperiment(input);
    outcomes.add(res.outcome);
  }

  if (!outcomes.has('precipitate_forms')) {
    throw new Error('Expected precipitate_forms in sample');
  }
  if (!outcomes.has('below_saturation')) {
    throw new Error('Expected below_saturation in sample');
  }
}
