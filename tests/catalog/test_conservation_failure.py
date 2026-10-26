"""Property 25: Conservation violations fail generation with identification.

Validates: Requirements 12.2
- For any corruption of any coefficient in any generated reaction, conservation
  verification fails (raises ValueError).
- The exception message names the reaction identifier and the violated quantity (element Z or charge).
- Evaluated over at least 100 iterations with randomized coefficient corruptions.
"""

from __future__ import annotations

import random
import pytest

from scripts.catalog.generate import (
    enumerate_substances,
    verify_conservation,
)
from scripts.catalog.validate_seed import validate_seed
from backend.app.generated.chemistry_catalog import CATALOG

SEED_DIR = pytest.importorskip("pathlib").Path(__file__).resolve().parents[2] / "catalog" / "seed"


# Feature: chemistry-species-expansion, Property 25: Conservation violations fail generation with identification
def test_conservation_violations_fail_generation_with_id_property() -> None:
    seed = validate_seed(SEED_DIR)
    substances = {s.id: s for s in enumerate_substances(seed)}

    modeled_reactions = [r for r in CATALOG["reactions"] if "reactants" in r and "products" in r]
    assert len(modeled_reactions) > 0, "Expected modeled reactions in catalog"

    rng = random.Random(2525)
    iterations = 120

    for i in range(iterations):
        rxn = rng.choice(modeled_reactions)
        rxn_id = rxn["id"]

        r_coef = dict(rxn["reactants"])
        p_coef = dict(rxn["products"])

        # Randomly choose whether to corrupt reactant side or product side
        corrupt_reactant = rng.choice([True, False])
        target_dict = r_coef if corrupt_reactant else p_coef
        target_species = rng.choice(list(target_dict.keys()))

        # Introduce corruption: +/- 1 or factor of 2 or 3
        orig_val = target_dict[target_species]
        corruption_type = rng.choice(["add", "subtract", "multiply"])
        if corruption_type == "add":
            target_dict[target_species] = orig_val + rng.choice([1, 2, 3])
        elif corruption_type == "subtract":
            target_dict[target_species] = orig_val - 1 if orig_val > 1 else orig_val + 1
        else:
            target_dict[target_species] = orig_val * 2

        # Verify that corrupted reaction fails generation/conservation
        with pytest.raises(ValueError) as exc_info:
            verify_conservation(rxn_id, r_coef, p_coef, substances)

        err_msg = str(exc_info.value)

        # Assertion: Exception names the reaction identifier
        assert rxn_id in err_msg, (
            f"Iteration {i}: failure message must name reaction '{rxn_id}', got: '{err_msg}'"
        )

        # Assertion: Exception names the violated quantity (element or charge)
        assert ("element" in err_msg or "charge" in err_msg or "Z=" in err_msg), (
            f"Iteration {i}: failure message must identify violated quantity, got: '{err_msg}'"
        )
