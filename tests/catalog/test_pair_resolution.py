"""Property test 7: Every reagent selection resolves.

Validates: Requirements 5.4
For every ordered pair of selectable reagents, including self-pairs, resolution
yields exactly one record whose outcome is a member of the declared outcome enumeration.
No selection resolves to an undefined state.
"""

from pathlib import Path
import pytest
from scripts.catalog.validate_seed import validate_seed
from scripts.catalog.generate import (
    enumerate_substances,
    enumerate_reactions,
    reaction_id_from_pair,
    canonical_pair_key,
)

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"

DECLARED_OUTCOMES = {
    "precipitate_forms",
    "below_saturation",
    "neutralization",
    "all_products_soluble",
    "same_reagent",
    "no_modeled_reaction",
    "unsupported",
}


def test_every_reagent_selection_resolves_property():
    seed = validate_seed(SEED_DIR)
    substances = enumerate_substances(seed)
    sub_map = {s.id: s for s in substances}
    selectable = [s for s in substances if s.selectable]

    assert len(selectable) >= 40, f"Expected at least 40 selectable reagents, got {len(selectable)}"

    reactions = enumerate_reactions(substances, seed)
    rxn_map = {r.id: r for r in reactions}

    # Verify every ordered pair (a, b) in selectable reagents resolves
    pairs_tested = 0
    for a in selectable:
        for b in selectable:
            rxn_id = reaction_id_from_pair(a.id, b.id)
            assert rxn_id in rxn_map, f"Missing reaction record for pair ({a.id}, {b.id}) with id {rxn_id}"

            rec = rxn_map[rxn_id]
            assert rec.canonicalKey == canonical_pair_key(a.id, b.id)

            if rec.outcome is not None:
                assert rec.outcome in DECLARED_OUTCOMES, (
                    f"Reaction {rxn_id} has invalid outcome {rec.outcome}; "
                    f"must be in {DECLARED_OUTCOMES}"
                )
            else:
                assert rec.outcomeCategories is not None
                for cat in rec.outcomeCategories:
                    assert cat in DECLARED_OUTCOMES, f"Reaction {rxn_id} category {cat} not in {DECLARED_OUTCOMES}"

            if a.id == b.id:
                assert rec.outcome == "no_modeled_reaction", (
                    f"Self-pair ({a.id}, {b.id}) should have outcome 'no_modeled_reaction', got {rec.outcome}"
                )
                assert rec.reasonCode == "same_reagent"
                assert rec.candidateSolidId is None

            if rec.candidateSolidId is not None:
                assert rec.reactionClass == "double_displacement"
                assert rec.outcomeCategories == ["precipitate_forms", "below_saturation"]
                assert rec.candidateSolidId in sub_map, f"Solid {rec.candidateSolidId} not in substances"
                solid_sub = sub_map[rec.candidateSolidId]
                assert solid_sub.solubilityClass in ("insoluble", "slightly_soluble")
                assert rec.reactants is not None and len(rec.reactants) > 0
                assert rec.products is not None and len(rec.products) > 0
                assert rec.molecularEquation is not None
                assert rec.netIonicEquation is not None

            pairs_tested += 1

    expected_pairs = len(selectable) * len(selectable)
    assert pairs_tested == expected_pairs
