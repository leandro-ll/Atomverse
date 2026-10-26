"""Property 9: Reagent order does not affect the result.

Validates: Requirements 5.6, 12.3, 12.4
- For any pair of selectable reagents (A, B) and any quantities, evaluating (A, B)
  and evaluating (B, A) with their corresponding quantities returns identical:
  - outcome
  - productId
  - candidateSolidId
  - molecularEquation
  - netIonicEquation
  - spectatorIonIds
  - saturation (Q, ratio, ksp, kspSourceId)
- Evaluated over at least 100 iterations using catalog-drawn generators.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment
from tests.helpers.chemistry_generators import arb_input


# Feature: chemistry-species-expansion, Property 9: Reagent order does not affect the result
def test_reagent_order_invariance_property() -> None:
    rng = random.Random(999)
    iterations = 120

    for i in range(iterations):
        inp_ab = arb_input(rng)

        # Invert reagents A and B while keeping their respective quantities associated
        inp_ba = {
            "reagentAId": inp_ab["reagentBId"],
            "reagentBId": inp_ab["reagentAId"],
            "concentrationA_M": inp_ab["concentrationB_M"],
            "concentrationB_M": inp_ab["concentrationA_M"],
            "volumeA_mL": inp_ab["volumeB_mL"],
            "volumeB_mL": inp_ab["volumeA_mL"],
        }

        res_ab = evaluate_experiment(CATALOG, inp_ab)
        res_ba = evaluate_experiment(CATALOG, inp_ba)

        assert res_ab["outcome"] == res_ba["outcome"], (
            f"Iteration {i}: outcome mismatch under swap: "
            f"AB='{res_ab['outcome']}', BA='{res_ba['outcome']}'"
        )
        assert res_ab["productId"] == res_ba["productId"], (
            f"Iteration {i}: productId mismatch under swap"
        )
        assert res_ab["candidateSolidId"] == res_ba["candidateSolidId"], (
            f"Iteration {i}: candidateSolidId mismatch under swap"
        )
        assert res_ab["molecularEquation"] == res_ba["molecularEquation"], (
            f"Iteration {i}: molecularEquation mismatch under swap"
        )
        assert res_ab["netIonicEquation"] == res_ba["netIonicEquation"], (
            f"Iteration {i}: netIonicEquation mismatch under swap"
        )

        spec_ab = sorted(res_ab.get("spectatorIonIds") or [])
        spec_ba = sorted(res_ba.get("spectatorIonIds") or [])
        assert spec_ab == spec_ba, f"Iteration {i}: spectatorIonIds mismatch under swap"

        sat_ab = res_ab.get("saturation")
        sat_ba = res_ba.get("saturation")
        if sat_ab is None or sat_ba is None:
            assert sat_ab is None and sat_ba is None
        else:
            assert sat_ab["ksp"] == pytest.approx(sat_ba["ksp"], rel=1e-5)
            assert sat_ab["Q"] == pytest.approx(sat_ba["Q"], rel=1e-5)
            assert sat_ab["ratio"] == pytest.approx(sat_ba["ratio"], rel=1e-5)
            assert sat_ab.get("kspSourceId") == sat_ba.get("kspSourceId")
