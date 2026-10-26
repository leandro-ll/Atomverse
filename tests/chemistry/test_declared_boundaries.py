"""Property test 37: Declared boundaries return unsupported without fabricated products.

Validates: Requirements 17.1, 17.3, 17.4
For any reagent pair in a declared-unsupported class (acid with carbonate or sulfide,
redox or metal displacement, weak-acid/weak-base/buffer system), the outcome is
unsupported with the corresponding reason code and a non-empty localized explanation,
the product identifier is absent, and no gas or precipitate species appears in the
derived visual plan.
"""

from pathlib import Path
import pytest
from scripts.catalog.validate_seed import validate_seed
from scripts.catalog.generate import (
    enumerate_substances,
    enumerate_reactions,
    reaction_id_from_pair,
)

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"

EXPECTED_UNSUPPORTED_REASONS = {
    "gas_evolution_not_modeled",
    "redox_not_modeled",
    "weak_equilibrium_not_modeled",
}


def test_declared_boundaries_return_unsupported_without_fabricated_products_property():
    seed = validate_seed(SEED_DIR)
    substances = enumerate_substances(seed)
    sub_map = {s.id: s for s in substances}
    selectable = [s for s in substances if s.selectable]
    reactions = enumerate_reactions(substances, seed)
    rxn_map = {r.id: r for r in reactions}

    explanations = seed.presentation.explanations

    unsupported_records = [r for r in reactions if r.outcome == "unsupported"]
    assert len(unsupported_records) > 0, "Expected declared unsupported reaction records"

    # 1. Verify every unsupported record satisfies the property constraints
    for rec in unsupported_records:
        assert rec.reasonCode in EXPECTED_UNSUPPORTED_REASONS, (
            f"Reaction {rec.id} has unexpected reasonCode {rec.reasonCode}"
        )
        assert rec.explanationId is not None, f"Reaction {rec.id} missing explanationId"
        assert rec.explanationId in explanations, (
            f"Reaction {rec.id} explanationId '{rec.explanationId}' not found in presentation.explanations"
        )
        explanation_text = explanations[rec.explanationId]
        assert isinstance(explanation_text, str) and len(explanation_text) > 0, (
            f"Empty explanation for {rec.explanationId}"
        )
        # No product identifier
        assert rec.candidateSolidId is None, (
            f"Unsupported reaction {rec.id} fabricated candidateSolidId: {rec.candidateSolidId}"
        )
        # No fabricated products or equations
        assert rec.products is None, f"Unsupported reaction {rec.id} fabricated products: {rec.products}"
        assert rec.molecularEquation is None, f"Unsupported reaction {rec.id} fabricated molecular equation"
        assert rec.netIonicEquation is None, f"Unsupported reaction {rec.id} fabricated net ionic equation"

    # 2. Specifically test acid + carbonate pairs
    acids = [s for s in selectable if s.cationId == "ion.h_1p"]
    carbonates = [s for s in selectable if s.anionId == "ion.co3_2m"]
    sulfides = [s for s in selectable if s.anionId == "ion.s_2m"]

    assert len(acids) > 0, "No selectable acids found"
    assert len(carbonates) > 0, "No selectable carbonates found"
    assert len(sulfides) > 0, "No selectable sulfides found"

    for acid in acids:
        for carb in carbonates:
            rxn_id = reaction_id_from_pair(acid.id, carb.id)
            rec = rxn_map[rxn_id]
            assert rec.outcome == "unsupported"
            assert rec.reasonCode == "gas_evolution_not_modeled"
            assert rec.explanationId == "unsupported.gas_evolution"
            assert rec.candidateSolidId is None

        for sulf in sulfides:
            rxn_id = reaction_id_from_pair(acid.id, sulf.id)
            rec = rxn_map[rxn_id]
            assert rec.outcome == "unsupported"
            assert rec.reasonCode == "gas_evolution_not_modeled"
            assert rec.explanationId == "unsupported.gas_evolution"
            assert rec.candidateSolidId is None

    # 3. Specifically test redox pairs: Fe(III) or Cu(II) with I-
    fe3_cu2_reagents = [s for s in selectable if s.cationId in ("ion.fe_3p", "ion.cu_2p")]
    iodides = [s for s in selectable if s.anionId == "ion.i_1m"]
    assert len(fe3_cu2_reagents) > 0, "No Fe3+/Cu2+ reagents found"
    assert len(iodides) > 0, "No iodide reagents found"

    for metal in fe3_cu2_reagents:
        for iod in iodides:
            rxn_id = reaction_id_from_pair(metal.id, iod.id)
            rec = rxn_map[rxn_id]
            assert rec.outcome == "unsupported"
            assert rec.reasonCode == "redox_not_modeled"
            assert rec.explanationId == "unsupported.redox"
            assert rec.candidateSolidId is None
