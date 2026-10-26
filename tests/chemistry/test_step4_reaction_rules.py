"""Guard test for Step 4 of literal removal: reactionRules.

Validates: Requirements 10.1, 6.2, 6.4
- Verifies that reactionRules literal is absent from js/chemistry-engine.js
- Verifies that reactionRules is absent from js/visualization.js
- Verifies that findReactionRecord is defined in js/chemistry-engine.js
- Verifies candidateSolidId and kspRef against the six frozen reaction fixtures
"""

import json
from pathlib import Path
import pytest

from backend.app.generated.chemistry_catalog import CATALOG

ROOT = Path(__file__).resolve().parents[2]
CHEMISTRY_ENGINE_JS = ROOT / "js" / "chemistry-engine.js"
VISUALIZATION_JS = ROOT / "js" / "visualization.js"
FIXTURES_PATH = ROOT / "tests" / "fixtures" / "chemistry" / "frozen-reactions.json"


def test_reaction_rules_literal_absent_from_chemistry_engine():
    """Assert that reactionRules identifier is absent from js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "reactionRules" not in engine_source, (
        "Found 'reactionRules' literal in js/chemistry-engine.js; it must be removed in Step 4."
    )


def test_reaction_rules_absent_from_visualization_js():
    """Assert that js/visualization.js no longer reads from reactionRules."""
    vis_source = VISUALIZATION_JS.read_text(encoding="utf-8")
    assert "reactionRules" not in vis_source, (
        "Found 'reactionRules' reference in js/visualization.js; it must use findReactionRecord."
    )


def test_find_reaction_record_defined():
    """Assert findReactionRecord function is defined in js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "function findReactionRecord" in engine_source


def test_frozen_fixtures_candidate_solid_and_ksp_ref():
    """Guard reaction candidateSolidId and kspRef against the six frozen fixtures."""
    assert FIXTURES_PATH.exists(), f"Missing fixtures file: {FIXTURES_PATH}"
    fixtures_data = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    reactions_by_id = {r["id"]: r for r in CATALOG["reactions"]}
    substances_by_id = {s["id"]: s for s in CATALOG["substances"]}

    for fix in fixtures_data["fixtures"]:
        exp = fix["expect"]
        rxn_id = exp["reactionId"]
        assert rxn_id in reactions_by_id, f"Reaction {rxn_id} missing from catalog"
        rxn = reactions_by_id[rxn_id]

        if exp["outcome"] == "precipitate_forms":
            solid_id = exp["productId"]
            assert rxn["candidateSolidId"] == solid_id, (
                f"{rxn_id}: candidateSolidId {rxn['candidateSolidId']} does not match fixture product {solid_id}"
            )
            assert solid_id in substances_by_id, f"Solid {solid_id} missing from substances"

            # Check Ksp literal matches
            assert "kspRef" in rxn, f"{rxn_id} must have kspRef"
            assert rxn["kspRef"]["value"] == exp["kspLiteral"], (
                f"{rxn_id}: Ksp value {rxn['kspRef']['value']} != fixture {exp['kspLiteral']}"
            )
        elif exp["outcome"] == "neutralization":
            assert rxn.get("candidateSolidId") is None, (
                f"{rxn_id}: neutralization reaction must not declare a candidateSolidId"
            )
            assert rxn["outcome"] == "neutralization"
