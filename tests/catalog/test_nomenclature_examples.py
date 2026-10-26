"""Example tests pinning generated Indonesian names and provenances.

Validates: Requirements 7.1, 7.2, 7.3
Pins:
- "Timbal(II) nitrat" (compositional, variable oxidation state)
- "Besi(III) klorida" (compositional, variable oxidation state)
- "Tembaga(II) sulfat" (compositional, variable oxidation state)
- "Perak nitrat" (compositional, single oxidation state, no roman numeral)
- "Natrium sulfat" (compositional, single oxidation state, no roman numeral)
- "Asam klorida" (override)
- "Air" (override)
"""

from pathlib import Path
import pytest
from scripts.catalog.validate_seed import validate_seed
from scripts.catalog.generate import enumerate_substances

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


def test_pinned_nomenclature_examples():
    seed = validate_seed(SEED_DIR)
    substances = enumerate_substances(seed)
    sub_map = {s.id: s for s in substances}

    pinned = [
        ("sub.pb_no3_2", "Timbal(II) nitrat", "compositional"),
        ("sub.fecl3", "Besi(III) klorida", "compositional"),
        ("sub.cuso4", "Tembaga(II) sulfat", "compositional"),
        ("sub.agno3", "Perak nitrat", "compositional"),
        ("sub.na2so4", "Natrium sulfat", "compositional"),
        ("sub.hcl", "Asam klorida", "override"),
        ("sub.h2o", "Air", "override"),
    ]

    for sid, expected_name, expected_provenance in pinned:
        assert sid in sub_map, f"Substance {sid} missing from enumerated substances"
        sub = sub_map[sid]
        assert sub.indonesianName == expected_name, (
            f"Name mismatch for {sid}: expected '{expected_name}', got '{sub.indonesianName}'"
        )
        assert sub.nameProvenance == expected_provenance, (
            f"Provenance mismatch for {sid}: expected '{expected_provenance}', got '{sub.nameProvenance}'"
        )
