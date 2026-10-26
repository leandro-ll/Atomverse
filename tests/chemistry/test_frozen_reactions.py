"""Harness asserting the six frozen reaction fixtures against the shipped generated catalog binding.

Validates: Requirements 6.2, 6.4
- Evaluates through backend/app/generated/chemistry_catalog.py
- Asserts identity, equations, product id and name, Ksp literal
- Verifies that no parallel chemistry table exists anywhere under tests/
"""

import ast
import json
from pathlib import Path
import re
import pytest

from backend.app.generated.chemistry_catalog import CATALOG, CATALOG_VERSION
from backend.app.domain.chemistry_evaluator import evaluate_experiment

ROOT = Path(__file__).resolve().parents[2]
FIXTURES_PATH = ROOT / "tests" / "fixtures" / "chemistry" / "frozen-reactions.json"


def test_frozen_reactions_against_shipped_binding():
    assert FIXTURES_PATH.exists(), f"Missing fixtures file: {FIXTURES_PATH}"
    data = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    assert data["generatedFromCatalogVersion"] == CATALOG_VERSION

    # Build lookup mappings from the generated binding
    substance_map = {s["id"]: s for s in CATALOG["substances"]}
    reaction_map = {r["id"]: r for r in CATALOG["reactions"]}

    fixtures = data["fixtures"]
    assert len(fixtures) == 6, f"Expected 6 canonical reaction fixtures, got {len(fixtures)}"

    for fix in fixtures:
        exp = fix["expect"]
        rxn_id = exp["reactionId"]
        assert rxn_id in reaction_map, f"Reaction {rxn_id} not found in shipped CATALOG binding"

        rec = reaction_map[rxn_id]

        # Assert identity
        assert rec["id"] == rxn_id

        # Assert equations
        assert rec["molecularEquation"] == exp["molecularEquation"], (
            f"Molecular equation mismatch for {rxn_id}:\n"
            f"  Catalog: {rec['molecularEquation']}\n"
            f"  Fixture: {exp['molecularEquation']}"
        )
        assert rec["netIonicEquation"] == exp["netIonicEquation"], (
            f"Net-ionic equation mismatch for {rxn_id}:\n"
            f"  Catalog: {rec['netIonicEquation']}\n"
            f"  Fixture: {exp['netIonicEquation']}"
        )

        # Assert product and Ksp
        if exp["outcome"] == "precipitate_forms":
            solid_id = exp["productId"]
            assert rec["candidateSolidId"] == solid_id
            assert solid_id in substance_map
            assert substance_map[solid_id]["indonesianName"] == exp["productIndonesianName"]
            assert rec["kspRef"]["value"] == exp["kspLiteral"]
            assert "precipitate_forms" in rec["outcomeCategories"]
        elif exp["outcome"] == "neutralization":
            assert rec["reactionClass"] == "neutralization"
            assert exp["productId"] in substance_map
            assert substance_map[exp["productId"]]["indonesianName"] == exp["productIndonesianName"]

        # Evaluator-dependent assertions (Task 9.6, Requirements 6.2, 6.4)
        eval_input = {
            "reagentAId": fix["reagentAId"],
            "reagentBId": fix["reagentBId"],
            **fix["input"],
        }
        res = evaluate_experiment(CATALOG, eval_input)
        assert res["outcome"] == exp["outcome"], (
            f"Evaluator outcome mismatch for {rxn_id}: expected {exp['outcome']}, got {res['outcome']}"
        )
        if exp["outcome"] == "precipitate_forms":
            assert res["saturation"] is not None
            assert res["saturation"]["Q"] == pytest.approx(exp["QApprox"], rel=1e-3)
            ksp_val = float(exp["kspLiteral"])
            assert res["saturation"]["ksp"] == ksp_val
            assert res["saturation"]["ratio"] == pytest.approx(exp["QApprox"] / ksp_val, rel=1e-3)
            assert res["productId"] == exp["productId"]
        elif exp["outcome"] == "neutralization":
            assert res["outcome"] == "neutralization"
            assert res["saturation"] is None



def test_no_parallel_chemistry_table_in_tests():
    """Verify no separate test-only catalog table is defined anywhere under tests/."""
    tests_dir = ROOT / "tests"
    forbidden_table_markers = [
        "TEST_ONLY_CATALOG =",
        "PARALLEL_CHEMISTRY_TABLE =",
        "MOCK_CATALOG_TABLE =",
    ]

    for py_file in tests_dir.rglob("*.py"):
        if "fixtures" in py_file.parts or py_file.resolve() == Path(__file__).resolve():
            continue
        text = py_file.read_text(encoding="utf-8")
        for marker in forbidden_table_markers:
            assert marker not in text, f"Parallel chemistry table marker '{marker}' found in {py_file}"
