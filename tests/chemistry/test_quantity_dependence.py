"""Property 23: Outcomes depend on quantities.

Validates: Requirements 10.6
- For any reagent pair with a cited Ksp, there exist valid inputs differing only
  in concentration whose outcomes differ.
- No supported pair has an outcome constant in its submitted quantities.
- Evaluated for all cited-Ksp reactions across the library and over at least 100 iterations.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment


# Feature: chemistry-species-expansion, Property 23: Outcomes depend on quantities
def test_outcomes_depend_on_quantities_property() -> None:
    ksp_rxns = [r for r in CATALOG["reactions"] if r.get("kspRef") and "candidateSolidId" in r]
    assert len(ksp_rxns) > 0, "Expected reactions with cited Ksp in catalog"

    # 1. Exhaustive check: every cited-Ksp reaction must be capable of both precipitate_forms and below_saturation
    for rxn in ksp_rxns:
        reagent_a, reagent_b = rxn["reactantIds"]
        ksp_val = float(rxn["kspRef"]["value"])
        powers = rxn["kspRef"]["ionPowers"]
        sum_powers = sum(powers.values())

        # High concentration -> precipitate
        c_high = 1.0
        inp_high = {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_high,
            "concentrationB_M": c_high,
            "volumeA_mL": 50.0,
            "volumeB_mL": 50.0,
        }
        res_high = evaluate_experiment(CATALOG, inp_high)

        # Dilute concentration -> below saturation
        c_low = 0.1 * (ksp_val ** (1.0 / sum_powers))
        inp_low = {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_low,
            "concentrationB_M": c_low,
            "volumeA_mL": 50.0,
            "volumeB_mL": 50.0,
        }
        res_low = evaluate_experiment(CATALOG, inp_low)

        assert res_high["outcome"] == "precipitate_forms", (
            f"Reaction {rxn['id']} at 1.0 M failed to precipitate: Q={res_high.get('saturation', {}).get('Q')}, Ksp={ksp_val}"
        )
        assert res_low["outcome"] == "below_saturation", (
            f"Reaction {rxn['id']} at {c_low} M precipitated: Q={res_low.get('saturation', {}).get('Q')}, Ksp={ksp_val}"
        )
        assert res_high["outcome"] != res_low["outcome"], (
            f"Reaction {rxn['id']} had constant outcome across concentration variations!"
        )

    # 2. Randomized sampling over 100+ iterations
    rng = random.Random(2323)
    iterations = 120
    for i in range(iterations):
        rxn = rng.choice(ksp_rxns)
        reagent_a, reagent_b = rxn["reactantIds"]
        ksp_val = float(rxn["kspRef"]["value"])
        sum_p = sum(rxn["kspRef"]["ionPowers"].values())

        v_a = rng.uniform(20.0, 80.0)
        v_b = rng.uniform(20.0, 80.0)

        c_high = rng.uniform(0.5, 2.0)
        c_low = 0.05 * (ksp_val ** (1.0 / sum_p)) * rng.uniform(0.1, 0.9)

        res_1 = evaluate_experiment(CATALOG, {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_high,
            "concentrationB_M": c_high,
            "volumeA_mL": v_a,
            "volumeB_mL": v_b,
        })

        res_2 = evaluate_experiment(CATALOG, {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_low,
            "concentrationB_M": c_low,
            "volumeA_mL": v_a,
            "volumeB_mL": v_b,
        })

        assert res_1["outcome"] == "precipitate_forms"
        assert res_2["outcome"] == "below_saturation"
        assert res_1["outcome"] != res_2["outcome"]
