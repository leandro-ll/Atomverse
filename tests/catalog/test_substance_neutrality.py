"""Property 2: Enumerated substances are charge-neutral and fully resolved.

Validates: Requirements 2.2, 5.1, 5.2
"""

from __future__ import annotations

from pathlib import Path
import random
import pytest

from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


# Feature: chemistry-species-expansion, Property 2: Enumerated substances are charge-neutral and fully resolved
def test_substance_neutrality_property() -> None:
    """For all generated substances, net charge is zero, mass > 0, and notation fields are non-empty."""
    bundle = validate_seed(SEED_DIR)
    substances = enumerate_substances(bundle)

    assert len(substances) > 0, "Expected non-empty substances"

    for sub in substances:
        # Net charge is 0
        assert sub.netCharge == 0, f"{sub.id} net charge is {sub.netCharge}, expected 0"
        assert sub.composition.get("0", 0) == 0, f"{sub.id} composition['0'] must be 0"

        # Positive molar mass
        assert sub.molarMassGPerMol > 0, f"{sub.id} mass must be > 0, got {sub.molarMassGPerMol}"

        # Non-empty Unicode, LaTeX, and HTML notation
        notation = sub.notation
        assert notation["unicode"] and notation["unicode"].strip(), f"{sub.id} missing unicode notation"
        assert notation["latex"] and notation["latex"].strip(), f"{sub.id} missing latex notation"
        assert notation["html"] and notation["html"].strip(), f"{sub.id} missing html notation"

    # Property test across randomized subsamples over 100 iterations
    rng = random.Random(42)
    for _ in range(100):
        sample = rng.sample(substances, k=min(10, len(substances)))
        for item in sample:
            assert item.netCharge == 0
            assert item.molarMassGPerMol > 0
            assert len(item.notation["unicode"]) > 0
            assert len(item.notation["latex"]) > 0
            assert len(item.notation["html"]) > 0
