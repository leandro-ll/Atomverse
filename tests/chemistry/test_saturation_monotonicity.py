"""Property 19: Saturation is monotonic in concentration and dilution.

Validates: Requirements 9.1, 9.2, 12.4
- For any reagent pair and valid input:
  1. Increasing either reagent concentration while holding all else constant
     never changes the outcome from 'precipitate_forms' to 'below_saturation'.
  2. Increasing total mixed volume while holding reagent amounts constant
     never changes the outcome from 'below_saturation' to 'precipitate_forms'.
- Evaluated over at least 100 iterations.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment


# Feature: chemistry-species-expansion, Property 19: Saturation is monotonic in concentration and dilution
def test_saturation_monotonicity_property() -> None:
    ksp_rxns = [r for r in CATALOG["reactions"] if r.get("kspRef") and "candidateSolidId" in r]
    assert len(ksp_rxns) > 0, "Expected reactions with cited Ksp in catalog"

    rng = random.Random(1919)
    iterations = 120

    # Part 1: Concentration monotonicity
    for i in range(iterations):
        rxn = rng.choice(ksp_rxns)
        reagent_a, reagent_b = rxn["reactantIds"]

        c_a = rng.uniform(0.001, 1.0)
        c_b = rng.uniform(0.001, 1.0)
        v_a = rng.uniform(10.0, 100.0)
        v_b = rng.uniform(10.0, 100.0)

        base_res = evaluate_experiment(CATALOG, {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_a,
            "concentrationB_M": c_b,
            "volumeA_mL": v_a,
            "volumeB_mL": v_b,
        })

        # Increase concentrations by positive increments
        delta_a = rng.uniform(0.01, 0.5)
        delta_b = rng.uniform(0.01, 0.5)

        increased_res = evaluate_experiment(CATALOG, {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_a + delta_a,
            "concentrationB_M": c_b + delta_b,
            "volumeA_mL": v_a,
            "volumeB_mL": v_b,
        })

        # Monotonicity check: Q must be non-decreasing
        q_base = base_res["saturation"]["Q"]
        q_increased = increased_res["saturation"]["Q"]
        assert q_increased >= q_base, (
            f"Iteration {i}: Q decreased on concentration increase! base={q_base}, increased={q_increased}"
        )

        # Monotonicity rule: precipitate_forms -> never below_saturation
        if base_res["outcome"] == "precipitate_forms":
            assert increased_res["outcome"] == "precipitate_forms", (
                f"Iteration {i}: concentration increase flipped precipitate_forms to {increased_res['outcome']}"
            )

    # Part 2: Dilution monotonicity (holding moles constant, increasing volume)
    for i in range(iterations):
        rxn = rng.choice(ksp_rxns)
        reagent_a, reagent_b = rxn["reactantIds"]
        ksp_val = float(rxn["kspRef"]["value"])
        sum_p = sum(rxn["kspRef"]["ionPowers"].values())

        # Start from below_saturation by picking dilute concentrations
        target_c = 0.1 * (ksp_val ** (1.0 / sum_p))
        c_a = target_c * rng.uniform(0.1, 0.8)
        c_b = target_c * rng.uniform(0.1, 0.8)
        v_a_ml = rng.uniform(10.0, 50.0)
        v_b_ml = rng.uniform(10.0, 50.0)

        base_res = evaluate_experiment(CATALOG, {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_a,
            "concentrationB_M": c_b,
            "volumeA_mL": v_a_ml,
            "volumeB_mL": v_b_ml,
        })

        if base_res["outcome"] == "below_saturation":
            # Dilute by doubling total volume while keeping moles constant:
            # moles = C * V -> C_new = moles / V_new = C / factor
            dilution_factor = rng.uniform(1.5, 4.0)
            v_a_dil = v_a_ml * dilution_factor
            v_b_dil = v_b_ml * dilution_factor
            c_a_dil = c_a / dilution_factor
            c_b_dil = c_b / dilution_factor

            diluted_res = evaluate_experiment(CATALOG, {
                "reagentAId": reagent_a,
                "reagentBId": reagent_b,
                "concentrationA_M": c_a_dil,
                "concentrationB_M": c_b_dil,
                "volumeA_mL": v_a_dil,
                "volumeB_mL": v_b_dil,
            })

            # Monotonicity rule: dilution must keep or decrease Q
            assert diluted_res["saturation"]["Q"] <= base_res["saturation"]["Q"] + 1e-18, (
                f"Iteration {i}: Q increased upon dilution!"
            )
            assert diluted_res["outcome"] == "below_saturation", (
                f"Iteration {i}: dilution flipped below_saturation to {diluted_res['outcome']}"
            )
