"""Property 16: Non-precipitating outcomes expose no product.

Validates: Requirements 8.3, 8.5, 12.4
- For any result whose outcome is 'below_saturation' or 'no_modeled_reaction',
  product identifier, molecular equation, and net-ionic equation are all absent (None / null).
- Evaluated over at least 100 iterations.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment


# Feature: chemistry-species-expansion, Property 16: Non-precipitating outcomes expose no product
def test_no_product_outcomes_property() -> None:
    reactions = CATALOG["reactions"]
    no_rxn_pairs = [r for r in reactions if r.get("outcome") == "no_modeled_reaction"]
    ksp_rxns = [r for r in reactions if r.get("kspRef") and "candidateSolidId" in r]
    unsupported_rxns = [r for r in reactions if r.get("outcome") == "unsupported"]

    assert len(no_rxn_pairs) > 0
    assert len(ksp_rxns) > 0

    rng = random.Random(1616)

    iterations = 120
    for i in range(iterations):
        if i % 3 == 0:
            # no_modeled_reaction
            rxn = rng.choice(no_rxn_pairs)
            reagent_a, reagent_b = rxn["reactantIds"]
            c_a = rng.uniform(0.01, 1.0)
            c_b = rng.uniform(0.01, 1.0)
        elif i % 3 == 1:
            # below_saturation: using dilute concentration
            rxn = rng.choice(ksp_rxns)
            reagent_a, reagent_b = rxn["reactantIds"]
            c_a = rng.uniform(1e-9, 1e-6)
            c_b = rng.uniform(1e-9, 1e-6)
        else:
            # unsupported or same-reagent mixture
            if unsupported_rxns and rng.random() > 0.5:
                rxn = rng.choice(unsupported_rxns)
                reagent_a, reagent_b = rxn["reactantIds"]
            else:
                sub = rng.choice(CATALOG["substances"])
                reagent_a, reagent_b = sub["id"], sub["id"]
            c_a = rng.uniform(0.01, 1.0)
            c_b = rng.uniform(0.01, 1.0)

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
        outcome = res["outcome"]

        if outcome in ("below_saturation", "no_modeled_reaction", "unsupported"):
            assert res["productId"] is None, (
                f"Iteration {i}: non-precipitating outcome '{outcome}' must have productId None, got {res['productId']}"
            )
            assert res["molecularEquation"] is None, (
                f"Iteration {i}: non-precipitating outcome '{outcome}' must have molecularEquation None, got {res['molecularEquation']}"
            )
            assert res["netIonicEquation"] is None, (
                f"Iteration {i}: non-precipitating outcome '{outcome}' must have netIonicEquation None, got {res['netIonicEquation']}"
            )
