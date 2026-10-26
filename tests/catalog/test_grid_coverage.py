"""Property 6: The cation/anion grid is covered exactly once.

Validates: Requirements 5.3
"""

from __future__ import annotations

from pathlib import Path
import pytest

from scripts.catalog.generate import DECLARED_EXCLUSIONS, enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


# Feature: chemistry-species-expansion, Property 6: The cation/anion grid is covered exactly once
def test_grid_coverage_property() -> None:
    """Every non-excluded cation/anion pair produces exactly one substance record."""
    bundle = validate_seed(SEED_DIR)
    cations = [ion for ion in bundle.ions if ion.kind == "cation"]
    anions = [ion for ion in bundle.ions if ion.kind == "anion"]

    assert len(cations) == 11, f"Expected 11 cations, got {len(cations)}"
    assert len(anions) == 9, f"Expected 9 anions, got {len(anions)}"

    substances = enumerate_substances(bundle)
    substance_map = {s.id: s for s in substances}

    # Verify no duplicate substance IDs
    assert len(substance_map) == len(substances), "Duplicate substance IDs detected"

    # Track seen grid pairs
    seen_pairs: set[tuple[str, str]] = set()

    for sub in substances:
        pair = (sub.cationId, sub.anionId)
        assert pair not in seen_pairs, f"Pair {pair} generated more than once ({sub.id})"
        seen_pairs.add(pair)

    # Grid check
    total_grid_cells = len(cations) * len(anions)
    assert total_grid_cells == 99, f"Expected 99 grid cells, got {total_grid_cells}"

    unaccounted: list[tuple[str, str]] = []
    for cation in cations:
        for anion in anions:
            pair = (cation.id, anion.id)
            if pair not in seen_pairs:
                # Must be a declared exclusion
                excluded = False
                for exc_id in DECLARED_EXCLUSIONS:
                    if exc_id in ("sub.h2co3", "sub.h2s", "sub.h3po4") and cation.id == "ion.h_1p":
                        if exc_id == "sub.h2co3" and anion.id == "ion.co3_2m":
                            excluded = True
                        elif exc_id == "sub.h2s" and anion.id == "ion.s_2m":
                            excluded = True
                        elif exc_id == "sub.h3po4" and anion.id == "ion.po4_3m":
                            excluded = True
                if not excluded:
                    unaccounted.append(pair)

    assert not unaccounted, f"Unaccounted grid pairs without declared exclusions: {unaccounted}"
    assert len(substances) + len(DECLARED_EXCLUSIONS) == 99
