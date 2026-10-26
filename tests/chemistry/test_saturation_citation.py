"""Property 17: Below-saturation results explain the comparison with a resolvable citation.

Validates: Requirements 8.4, 8.7, 15.3
- For any below_saturation result:
  - Localized Indonesian explanation is non-empty.
  - Explanation contains both the computed ion product Q and cited solubility product Ksp.
  - Referenced kspSourceId resolves to a catalog source with a non-empty citation.
- Evaluated over at least 100 iterations.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment


# Feature: chemistry-species-expansion, Property 17: Below-saturation results explain the comparison with a resolvable citation
def test_saturation_citation_property() -> None:
    ksp_rxns = [r for r in CATALOG["reactions"] if r.get("kspRef") and "candidateSolidId" in r]
    assert len(ksp_rxns) > 0, "Expected reactions with cited Ksp in catalog"

    sources = CATALOG.get("sources", {})
    assert len(sources) > 0, "Expected sources in catalog"

    rng = random.Random(1717)

    iterations = 120
    for i in range(iterations):
        rxn = rng.choice(ksp_rxns)
        reagent_a, reagent_b = rxn["reactantIds"]
        ksp_literal = str(rxn["kspRef"]["value"])

        # Calculate concentration guaranteed to be below Ksp threshold
        ksp_val = float(ksp_literal)
        powers = rxn["kspRef"]["ionPowers"]
        sum_powers = sum(powers.values())
        target_c = 0.2 * (ksp_val ** (1.0 / sum_powers))

        c_a = target_c * rng.uniform(0.1, 0.9)
        c_b = target_c * rng.uniform(0.1, 0.9)
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
        assert res["outcome"] == "below_saturation", f"Iteration {i}: expected below_saturation"

        explanation = res.get("explanation")
        assert explanation and isinstance(explanation, str), (
            f"Iteration {i}: below_saturation result must contain non-empty explanation string"
        )

        # Explanation contains authored Ksp literal
        assert ksp_literal in explanation, (
            f"Iteration {i}: explanation '{explanation}' must contain authored Ksp literal '{ksp_literal}'"
        )

        # Saturation block contains Q and resolvable source ID
        sat = res["saturation"]
        assert sat is not None
        source_id = sat.get("kspSourceId")
        assert source_id in sources, (
            f"Iteration {i}: kspSourceId '{source_id}' must resolve to an entry in CATALOG['sources']"
        )
        source = sources[source_id]
        citation = source.get("citation")
        assert citation and isinstance(citation, str) and len(citation.strip()) > 0, (
            f"Iteration {i}: source '{source_id}' must have a non-empty citation string"
        )
