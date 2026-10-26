"""Property 29: Seed entries always carry reviewed provenance.

Validates: Requirements 16.5
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import pytest

from scripts.catalog.validate_seed import VALID_ORIGINS, validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"
ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# Feature: chemistry-species-expansion, Property 29: Seed entries always carry reviewed provenance
def test_seed_provenance_property() -> None:
    """For all seed entries, a provenance block is present with valid origin, non-empty reviewer, and date."""
    bundle = validate_seed(SEED_DIR)

    # 1. Verify all ions carry reviewed provenance
    assert bundle.ions, "Expected non-empty ions"
    for ion in bundle.ions:
        prov = ion.provenance
        assert prov is not None, f"Ion {ion.id} missing provenance"
        assert prov.origin in VALID_ORIGINS, f"Ion {ion.id} invalid origin: {prov.origin}"
        assert prov.reviewer and prov.reviewer.strip(), f"Ion {ion.id} empty reviewer"
        assert ISO_DATE_PATTERN.match(prov.reviewedOn), f"Ion {ion.id} invalid reviewedOn date: {prov.reviewedOn}"

    # 2. Verify all Ksp entries carry reviewed provenance
    assert bundle.ksp, "Expected non-empty Ksp entries"
    for sub_id, entry in bundle.ksp.items():
        prov = entry.provenance
        assert prov is not None, f"Ksp entry {sub_id} missing provenance"
        assert prov.origin in VALID_ORIGINS, f"Ksp entry {sub_id} invalid origin: {prov.origin}"
        assert prov.reviewer and prov.reviewer.strip(), f"Ksp entry {sub_id} empty reviewer"
        assert ISO_DATE_PATTERN.match(prov.reviewedOn), f"Ksp entry {sub_id} invalid reviewedOn date: {prov.reviewedOn}"

    # 3. Property assertion over randomized sampling / iterations
    for _ in range(100):
        # Pick random ion and Ksp entry and assert invariants hold
        import random
        random_ion = random.choice(bundle.ions)
        assert random_ion.provenance.origin in ("hand", "ai_draft")
        assert len(random_ion.provenance.reviewer) > 0
        assert len(random_ion.provenance.reviewedOn) == 10

        random_ksp = random.choice(list(bundle.ksp.values()))
        assert random_ksp.provenance.origin in ("hand", "ai_draft")
        assert len(random_ksp.provenance.reviewer) > 0
        assert len(random_ksp.provenance.reviewedOn) == 10
