"""Property 22: Dissociation multiplicities reconstruct the formula unit.

Validates: Requirements 10.5, 12.4
"""

from __future__ import annotations

from pathlib import Path
import random
import pytest

from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


# Feature: chemistry-species-expansion, Property 22: Dissociation multiplicities reconstruct the formula unit
def test_dissociation_multiplicity_property() -> None:
    """The sum of multiplicity * charge equals zero and cationCount/anionCount match multiplicities."""
    bundle = validate_seed(SEED_DIR)
    ion_map = {ion.id: ion for ion in bundle.ions}
    substances = enumerate_substances(bundle)

    for sub in substances:
        assert len(sub.dissociation) == 2, f"{sub.id} expected exactly 2 dissociation parts (binary salt/acid/base)"

        cat_part = sub.dissociation[0]
        an_part = sub.dissociation[1]

        assert cat_part["ionId"] == sub.cationId
        assert an_part["ionId"] == sub.anionId

        assert cat_part["multiplicity"] == sub.cationCount
        assert an_part["multiplicity"] == sub.anionCount

        # Charge neutrality via multiplicity: n_cat * z_cat + n_an * z_an == 0
        cat_ion = ion_map[cat_part["ionId"]]
        an_ion = ion_map[an_part["ionId"]]
        net_charge = cat_part["multiplicity"] * cat_ion.charge + an_part["multiplicity"] * an_ion.charge
        assert net_charge == 0, f"{sub.id} dissociation is not charge-neutral: net charge {net_charge}"

        # Specific known multiplicity checks
        if sub.id == "sub.pb_no3_2":
            assert cat_part["multiplicity"] == 1 and an_part["multiplicity"] == 2
        elif sub.id == "sub.na2so4":
            assert cat_part["multiplicity"] == 2 and an_part["multiplicity"] == 1
        elif sub.id == "sub.fe2_so4_3":
            assert cat_part["multiplicity"] == 2 and an_part["multiplicity"] == 3
        elif sub.id == "sub.caso4":
            assert cat_part["multiplicity"] == 1 and an_part["multiplicity"] == 1

    # Randomized iteration checks over 100 runs
    rng = random.Random(42)
    for _ in range(100):
        sub = rng.choice(substances)
        cat_part, an_part = sub.dissociation
        z_net = cat_part["multiplicity"] * cat_part["charge"] + an_part["multiplicity"] * an_part["charge"]
        assert z_net == 0
