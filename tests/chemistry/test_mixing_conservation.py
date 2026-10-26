"""Property 14: Mixing conserves moles and Q uses stoichiometric powers.

Validates: Requirements 8.1
- For any valid experiment input, moles of each ion computed before mixing equal
  post-mixing concentration multiplied by total mixed volume.
- Reported ion product Q equals the product of post-mixing concentrations raised
  to catalog-declared stoichiometric powers.
- Evaluated over at least 100 iterations with randomized inputs.
"""

from __future__ import annotations

import math
import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import (
    post_mix_concentrations,
    ion_product,
)


# Feature: chemistry-species-expansion, Property 14: Mixing conserves moles and Q uses stoichiometric powers
def test_mixing_conservation_property() -> None:
    substances = CATALOG["substances"]
    reactions = CATALOG["reactions"]
    solids = [r["candidateSolidId"] for r in reactions if "candidateSolidId" in r and r.get("kspRef")]

    rng = random.Random(1414)

    # 1. Non-positive volume rejection
    with pytest.raises((ValueError, TypeError)):
        post_mix_concentrations(
            {
                "reagentAId": substances[0]["id"],
                "reagentBId": substances[1]["id"],
                "concentrationA_M": 0.1,
                "concentrationB_M": 0.1,
                "volumeA_L": 0.0,
                "volumeB_L": 0.0,
            },
            CATALOG,
        )

    # 2. Run at least 100 iterations of mixing conservation & Q calculation
    iterations = 120
    for i in range(iterations):
        sub_a = rng.choice(substances)
        sub_b = rng.choice(substances)
        c_a = rng.uniform(0.001, 2.0)
        c_b = rng.uniform(0.001, 2.0)
        v_a_ml = rng.uniform(1.0, 500.0)
        v_b_ml = rng.uniform(1.0, 500.0)
        v_a_l = v_a_ml / 1000.0
        v_b_l = v_b_ml / 1000.0
        v_total_l = v_a_l + v_b_l

        inp = {
            "reagentAId": sub_a["id"],
            "reagentBId": sub_b["id"],
            "concentrationA_M": c_a,
            "concentrationB_M": c_b,
            "volumeA_L": v_a_l,
            "volumeB_L": v_b_l,
        }

        conc_map = post_mix_concentrations(inp, CATALOG)

        # Compute initial moles of each ion from input
        expected_moles: dict[str, float] = {}
        for sub, c, v in [(sub_a, c_a, v_a_l), (sub_b, c_b, v_b_l)]:
            for part in sub.get("dissociation", ()):
                ion_id = part["ionId"]
                mult = part["multiplicity"]
                expected_moles[ion_id] = expected_moles.get(ion_id, 0.0) + (c * v * mult)

        # Assert conservation of moles: conc * total_volume == initial_moles
        for ion_id, initial_moles in expected_moles.items():
            post_conc = conc_map.get(ion_id, 0.0)
            recalculated_moles = post_conc * v_total_l
            assert recalculated_moles == pytest.approx(initial_moles, rel=1e-6, abs=1e-12), (
                f"Iteration {i}: mole conservation violated for {ion_id}: "
                f"expected {initial_moles}, got {recalculated_moles}"
            )

        # Assert Q calculation uses stoichiometric powers for candidate solids
        solid_id = rng.choice(solids)
        q = ion_product(conc_map, solid_id, CATALOG)

        # Recompute expected Q
        solid_sub = next(s for s in substances if s["id"] == solid_id)
        expected_q = 1.0
        for part in solid_sub.get("dissociation", ()):
            ion_id = part["ionId"]
            power = part["multiplicity"]
            ion_c = conc_map.get(ion_id, 0.0)
            expected_q *= math.pow(ion_c, power)

        assert q == pytest.approx(expected_q, rel=1e-6, abs=1e-25), (
            f"Iteration {i}: ion product Q mismatch for {solid_id}: "
            f"reported {q}, expected {expected_q}"
        )
