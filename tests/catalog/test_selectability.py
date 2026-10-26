"""Property 8: Selectability follows solubility.

Validates: Requirements 5.5
"""

from __future__ import annotations

from pathlib import Path
import random
import pytest

from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


# Feature: chemistry-species-expansion, Property 8: Selectability follows solubility
def test_selectability_property() -> None:
    """A substance is selectable if and only if it is soluble, aqueous-supported, and not the pure solvent H2O."""
    bundle = validate_seed(SEED_DIR)
    substances = enumerate_substances(bundle)

    selectable_count = 0
    for sub in substances:
        if sub.selectable:
            selectable_count += 1
            assert sub.solubilityClass == "soluble", f"{sub.id} is selectable but classified as {sub.solubilityClass}"
            assert sub.id != "sub.h2o", "H2O must not be selectable as a reagent"
        else:
            # If not selectable, it must be insoluble, slightly_soluble, or non-aqueous/H2O
            assert sub.solubilityClass in ("insoluble", "slightly_soluble") or sub.id == "sub.h2o", (
                f"{sub.id} is soluble but not selectable"
            )

    # Reviewed band check (Requirement 5.5: approximately 45, band 40 to 55)
    assert 40 <= selectable_count <= 55, (
        f"Selectable reagent count {selectable_count} outside reviewed band [40, 55]"
    )

    # Randomized iteration check across 100 iterations
    rng = random.Random(42)
    for _ in range(100):
        sample = rng.sample(substances, k=15)
        for s in sample:
            if s.solubilityClass in ("insoluble", "slightly_soluble"):
                assert s.selectable is False
            elif s.id == "sub.h2o":
                assert s.selectable is False
            else:
                assert s.selectable is True
