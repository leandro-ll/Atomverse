"""Guard test for Step 5 of literal removal: reactionEquations and getReactionResult.

Validates: Requirements 10.1, 10.2, 10.3, 10.6
- Verifies reactionEquations literal is absent from js/chemistry-engine.js
- Verifies getReactionResult is absent from js/chemistry-engine.js and js/main.js
- Verifies evaluateExperiment is defined in js/chemistry-engine.js
- Verifies repo-wide scan that malformed strings 'AgNO(aq)' and 'Pb(NO)\u2082' appear nowhere in runtime/catalog code
- Guards evaluation of the six frozen fixtures
"""

import json
from pathlib import Path
import re
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment

ROOT = Path(__file__).resolve().parents[2]
CHEMISTRY_ENGINE_JS = ROOT / "js" / "chemistry-engine.js"
MAIN_JS = ROOT / "js" / "main.js"
FIXTURES_PATH = ROOT / "tests" / "fixtures" / "chemistry" / "frozen-reactions.json"

MALFORMED_STRINGS = [
    "AgNO(aq)",
    "Pb(NO)\u2082",
]


def test_reaction_equations_literal_absent():
    """Assert that reactionEquations identifier is absent from js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "reactionEquations" not in engine_source, (
        "Found 'reactionEquations' in js/chemistry-engine.js; it must be removed in Step 5."
    )


def test_get_reaction_result_deleted():
    """Assert that getReactionResult identifier is absent from chemistry-engine.js and main.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "getReactionResult" not in engine_source, (
        "Found 'getReactionResult' in js/chemistry-engine.js; it must be deleted."
    )
    main_source = MAIN_JS.read_text(encoding="utf-8")
    assert "getReactionResult" not in main_source, (
        "Found 'getReactionResult' in js/main.js; it must route through evaluateExperiment."
    )


def test_evaluate_experiment_defined_in_engine():
    """Assert evaluateExperiment function is defined in js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "function evaluateExperiment" in engine_source


def test_malformed_equation_strings_absent_from_runtime():
    """Scan js/ (except vendor/generated) and catalog/ to ensure AgNO(aq) and Pb(NO)₂ appear nowhere."""
    scan_dirs = [ROOT / "js", ROOT / "catalog"]
    violations = []

    for s_dir in scan_dirs:
        for file_path in s_dir.rglob("*"):
            if not file_path.is_file():
                continue
            if "node_modules" in file_path.parts:
                continue
            if file_path.suffix.lower() not in {".js", ".json", ".html", ".css", ".ts"}:
                continue
            try:
                content = file_path.read_text(encoding="utf-8")
            except Exception:
                continue

            for bad_str in MALFORMED_STRINGS:
                if bad_str in content:
                    violations.append(f"{file_path.relative_to(ROOT)}: contains malformed string '{bad_str}'")

    assert not violations, f"Malformed equation strings found in runtime/catalog files:\n" + "\n".join(violations)


def test_six_frozen_fixtures_with_evaluator():
    """Guard the six frozen fixtures by evaluating through evaluate_experiment."""
    assert FIXTURES_PATH.exists(), f"Missing fixtures file: {FIXTURES_PATH}"
    fixtures_data = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    for fix in fixtures_data["fixtures"]:
        inp = dict(fix["input"])
        inp["reagentAId"] = fix["reagentAId"]
        inp["reagentBId"] = fix["reagentBId"]
        res = evaluate_experiment(inp)
        exp = fix["expect"]

        assert res["outcome"] == exp["outcome"], (
            f"{fix['name']}: expected outcome {exp['outcome']}, got {res['outcome']}"
        )
        assert res["reactionId"] == exp["reactionId"], (
            f"{fix['name']}: expected reactionId {exp['reactionId']}, got {res['reactionId']}"
        )
        if exp["outcome"] == "precipitate_forms":
            assert res["productId"] == exp["productId"], (
                f"{fix['name']}: expected productId {exp['productId']}, got {res['productId']}"
            )
            assert res["molecularEquation"] == exp["molecularEquation"]
            assert res["netIonicEquation"] == exp["netIonicEquation"]
