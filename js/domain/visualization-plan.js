/**
 * js/domain/visualization-plan.js
 *
 * Deterministic visualization plan and species ledger for submicroscopic simulation.
 * Derives formula-unit expansion from catalog dissociation multiplicities,
 * consumes only complete balanced events, and guarantees no precipitate species
 * are emitted for below_saturation, no_modeled_reaction, or unsupported outcomes,
 * and no gas species under any outcome in this phase.
 *
 * Validates: Requirements 8.3, 10.5, 12.4, 15.3, 17.1, 17.2
 */

import { CATALOG } from '../generated/chemistry-catalog.js';

function getSubstanceRecord(catalog, idOrToken) {
  if (!idOrToken) return null;
  const list = catalog.substances || [];
  return list.find((s) => s.id === idOrToken || s.formulaToken === idOrToken) || null;
}

function getIonRecord(catalog, ionId) {
  if (!ionId) return null;
  const list = catalog.ions || [];
  return list.find((i) => i.id === ionId || i.formulaToken === ionId) || null;
}

/**
 * Derives the initial ion ledger from submitted reagent quantities and catalog dissociation multiplicities.
 */
export function buildInitialIonLedger(evalResult, catalog = CATALOG) {
  const initialIons = {};

  const reactants = evalResult?.reactants || [];
  for (const r of reactants) {
    const sub = getSubstanceRecord(catalog, r.reagentId || r.speciesId);
    if (!sub || !sub.dissociation) continue;

    const formulaUnitMoles = Number(r.amount_mol || 0);

    for (const d of sub.dissociation) {
      const ionId = d.ionId;
      const multiplicity = Number(d.multiplicity || 1);
      const charge = Number(d.charge);
      const moles = formulaUnitMoles * multiplicity;

      if (!initialIons[ionId]) {
        const ionRec = getIonRecord(catalog, ionId);
        initialIons[ionId] = {
          ionId,
          charge,
          multiplicity,
          formulaToken: ionRec?.formulaToken || ionId,
          displayColor: ionRec?.displayColor || '#94a3b8',
          amount_mol: 0,
        };
      }
      initialIons[ionId].amount_mol += moles;
    }
  }

  return initialIons;
}

/**
 * Builds the complete species ledger according to the resolved outcome and stoichiometry.
 */
export function buildSpeciesLedger(evalResult, catalog = CATALOG) {
  const initialIonsMap = buildInitialIonLedger(evalResult, catalog);
  const initialIons = Object.values(initialIonsMap);

  const consumedIons = [];
  const remainingIons = [];
  const precipitates = [];
  const gases = []; // Strictly empty in this phase (Req 17.1, 17.2)

  const outcome = evalResult?.outcome || 'no_modeled_reaction';

  if (outcome === 'precipitate_forms' && evalResult.productId) {
    const solidSub = getSubstanceRecord(catalog, evalResult.productId);
    const candidateSolidId = evalResult.productId;

    // Determine stoichiometric requirements from the solid's dissociation
    if (solidSub && solidSub.dissociation) {
      const dissoc = solidSub.dissociation;
      // Extent limited by scarcest ion relative to solid stoichiometry
      let maxExtent = Infinity;
      for (const d of dissoc) {
        const available = initialIonsMap[d.ionId]?.amount_mol || 0;
        const possible = available / d.multiplicity;
        if (possible < maxExtent) {
          maxExtent = possible;
        }
      }
      if (maxExtent === Infinity || maxExtent < 0) maxExtent = 0;

      // Consume only complete balanced events
      for (const d of dissoc) {
        const consumedMol = maxExtent * d.multiplicity;
        consumedIons.push({
          ionId: d.ionId,
          amount_mol: consumedMol,
        });
      }

      precipitates.push({
        speciesId: candidateSolidId,
        formulaToken: solidSub.formulaToken,
        indonesianName: solidSub.indonesianName,
        displayColor: solidSub.displayColor || '#ffffff',
        amount_mol: maxExtent,
        phase: 's',
      });
    }
  } else if (outcome === 'neutralization') {
    // 1:1 H+ and OH- consumption
    const hMoles = initialIonsMap['ion.h_1p']?.amount_mol || 0;
    const ohMoles = initialIonsMap['ion.oh_1m']?.amount_mol || 0;
    const extent = Math.min(hMoles, ohMoles);

    if (extent > 0) {
      consumedIons.push({ ionId: 'ion.h_1p', amount_mol: extent });
      consumedIons.push({ ionId: 'ion.oh_1m', amount_mol: extent });
    }
  }
  // For below_saturation, no_modeled_reaction, and unsupported:
  // consumedIons is empty, precipitates is empty, gases is empty.

  // Calculate remaining aqueous ions
  const consumedMap = Object.fromEntries(consumedIons.map((c) => [c.ionId, c.amount_mol]));
  for (const ion of initialIons) {
    const consumed = consumedMap[ion.ionId] || 0;
    const remaining = Math.max(0, ion.amount_mol - consumed);
    remainingIons.push({
      ...ion,
      amount_mol: remaining,
    });
  }

  return Object.freeze({
    outcome,
    initialIons: Object.freeze(initialIons),
    consumedIons: Object.freeze(consumedIons),
    remainingIons: Object.freeze(remainingIons),
    precipitates: Object.freeze(precipitates),
    gases: Object.freeze(gases),
  });
}

/**
 * Creates the visualization plan consumed by the submicroscopic simulation view.
 */
export function createVisualizationPlan(evalResult, catalog = CATALOG, options = {}) {
  const ledger = buildSpeciesLedger(evalResult, catalog);
  const particleScale = options.particleScale || 200; // factor to convert mol to particle count

  // Map remaining ions to solution particles
  const solutionParticles = [];
  for (const ion of ledger.remainingIons) {
    const count = Math.min(60, Math.round(ion.amount_mol * particleScale));
    for (let i = 0; i < count; i += 1) {
      solutionParticles.push({
        ionId: ion.ionId,
        type: ion.formulaToken,
        color: ion.displayColor,
        isPrecipitate: false,
      });
    }
  }

  // Precipitate particles (never emitted for below_saturation, no_modeled_reaction, or unsupported)
  const precipitateParticles = [];
  if (ledger.outcome === 'precipitate_forms') {
    for (const ppt of ledger.precipitates) {
      const count = Math.min(80, Math.max(8, Math.round(ppt.amount_mol * particleScale)));
      for (let i = 0; i < count; i += 1) {
        precipitateParticles.push({
          speciesId: ppt.speciesId,
          type: ppt.indonesianName || ppt.formulaToken,
          color: ppt.displayColor,
          isPrecipitate: true,
        });
      }
    }
  }

  return Object.freeze({
    outcome: ledger.outcome,
    speciesLedger: ledger,
    hasPrecipitate: precipitateParticles.length > 0,
    hasGas: false, // Always false in this phase
    particles: Object.freeze({
      solution: Object.freeze(solutionParticles),
      precipitate: Object.freeze(precipitateParticles),
      gas: Object.freeze([]),
    }),
  });
}
