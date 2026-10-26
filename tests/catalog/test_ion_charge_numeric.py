"""Property 21: Ion charge is numeric and distinct from its label.

Validates: Requirements 10.4
"""

from __future__ import annotations

from pathlib import Path
import random
import pytest

from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


# Feature: chemistry-species-expansion, Property 21: Ion charge is numeric and distinct from its label
def test_ion_charge_numeric_property() -> None:
    """For every ion and dissociation entry, charge is a signed integer and not a string label."""
    bundle = validate_seed(SEED_DIR)

    # 1. Check all seeded ions
    for ion in bundle.ions:
        assert isinstance(ion.charge, int) and not isinstance(ion.charge, bool), (
            f"Ion {ion.id} charge must be integer, got {type(ion.charge)}"
        )
        if ion.kind == "cation":
            assert ion.charge > 0, f"Cation {ion.id} charge must be > 0"
        else:
            assert ion.charge < 0, f"Anion {ion.id} charge must be < 0"
        # Must be distinct from formula token label (e.g. charge=2 vs formulaToken="Pb+2")
        assert not isinstance(ion.charge, str)

    # 2. Check dissociation entries of generated substances
    substances = enumerate_substances(bundle)
    for sub in substances:
        assert sub.dissociation, f"{sub.id} missing dissociation entries"
        for part in sub.dissociation:
            charge = part["charge"]
            assert isinstance(charge, int) and not isinstance(charge, bool), (
                f"{sub.id} dissociation charge must be integer, got {type(charge)}"
            )
            assert isinstance(part["multiplicity"], int) and part["multiplicity"] >= 1

    # 3. Randomized checks across 100 iterations
    rng = random.Random(42)
    for _ in range(100):
        sub = rng.choice(substances)
        for part in sub.dissociation:
            assert type(part["charge"]) is int
            assert type(part["multiplicity"]) is int
