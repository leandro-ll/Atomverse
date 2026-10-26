"""Property 15: Precipitation is exactly saturation.

Validates: Requirements 4.3, 8.2, 8.3
- For any reagent pair with a cited Ksp and any valid quantities, outcome is
  'precipitate_forms' if and only if Q > Ksp, and 'below_saturation' otherwise.
- In both cases, the saturation block reports compared Q, ksp, ratio, and candidateSolidId is identified.
- Evaluated over at least 100 iterations with randomized inputs.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import (
    evaluate_experiment,
    decide_outcome,
)


# Feature: chemistry-species-expansion, Property 15: Precipitation is exactly saturation
def test_saturation_decision_property() -> None:
    reactions = [r for r in CATALOG["reactions"] if r.get("kspRef") and "candidateSolidId" in r]
    assert len(reactions) > 0, "Expected reactions with cited Ksp in catalog"

    rng = random.Random(1515)
    observed_precipitate = 0
    observed_below = 0

    iterations = 120
    for i in range(iterations):
        rxn = rng.choice(reactions)
        reagent_a, reagent_b = rxn["reactantIds"]
        ksp_val = float(rxn["kspRef"]["value"])

        # Alternate between high concentrations (to trigger precipitate) and dilute concentrations (below saturation)
        if i % 2 == 0:
            c_a = rng.uniform(0.05, 1.0)
            c_b = rng.uniform(0.05, 1.0)
        else:
            c_a = rng.uniform(1e-7, 1e-4)
            c_b = rng.uniform(1e-7, 1e-4)

        v_a = rng.uniform(10.0, 100.0)
        v_b = rng.uniform(10.0, 100.0)

        inp = {
            "reagentAId": reagent_a,
            "reagentBId": reagent_b,
            "concentrationA_M": c_a,
            "concentrationB_M": c_b,
            "volumeA_mL": v_a,
            "volumeB_mL": v_b,
        }

        res = evaluate_experiment(CATALOG, inp)

        assert res["candidateSolidId"] == rxn["candidateSolidId"]
        sat = res["saturation"]
        assert sat is not None, f"Iteration {i}: saturation block must be present"
        assert "Q" in sat
        assert "ksp" in sat
        assert "ratio" in sat
        assert sat["ksp"] == ksp_val
        assert sat["ratio"] == pytest.approx(sat["Q"] / ksp_val, rel=1e-5)

        q = sat["Q"]
        if q > ksp_val:
            assert res["outcome"] == "precipitate_forms", (
                f"Iteration {i}: Q ({q}) > Ksp ({ksp_val}) must yield 'precipitate_forms', got '{res['outcome']}'"
            )
            assert res["productId"] == rxn["candidateSolidId"]
            observed_precipitate += 1
        else:
            assert res["outcome"] == "below_saturation", (
                f"Iteration {i}: Q ({q}) <= Ksp ({ksp_val}) must yield 'below_saturation', got '{res['outcome']}'"
            )
            assert res["productId"] is None
            observed_below += 1

        # Also test decide_outcome helper parity
        helper_outcome = decide_outcome(q, ksp_val, CATALOG)
        assert helper_outcome == res["outcome"]

    # Verify both branches were exercised in the randomized test
    assert observed_precipitate > 0, "Expected at least one precipitate_forms outcome"
    assert observed_below > 0, "Expected at least one below_saturation outcome"


def test_saturation_strict_inequality_at_boundary() -> None:
    """When Q == Ksp exactly, outcome must be below_saturation (strict inequality)."""
    ksp = 1.0e-5
    # Exact equality
    assert decide_outcome(ksp, ksp, CATALOG) == "below_saturation"
    # Infinitesimally below
    assert decide_outcome(ksp - 1e-12, ksp, CATALOG) == "below_saturation"
    # Infinitesimally above
    assert decide_outcome(ksp + 1e-12, ksp, CATALOG) == "precipitate_forms"
