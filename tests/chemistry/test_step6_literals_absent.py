"""Static check asserting all five literals and getReactionResult are absent from js/chemistry-engine.js.

Validates: Requirements 10.1, 10.6, 3.2
- Absolute ban on:
  - chemicalNames
  - chemicalColors
  - reagentIons
  - reactionRules
  - reactionEquations
  - getReactionResult
- Verifies that js/chemistry-engine.js resolves facts only from the generated catalog binding
"""

from pathlib import Path
import re
import pytest

ROOT = Path(__file__).resolve().parents[2]
CHEMISTRY_ENGINE_JS = ROOT / "js" / "chemistry-engine.js"

FORBIDDEN_LITERAL_IDENTIFIERS = [
    "chemicalNames",
    "chemicalColors",
    "reagentIons",
    "reactionRules",
    "reactionEquations",
    "getReactionResult",
]


def test_five_literals_and_get_reaction_result_strictly_absent():
    """Assert that none of the five literals or getReactionResult appear in js/chemistry-engine.js."""
    source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")

    # Strip single-line and multi-line comments to test actual code
    code_without_comments = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    code_without_comments = re.sub(r"//.*$", "", code_without_comments, flags=re.MULTILINE)

    violations = []
    for identifier in FORBIDDEN_LITERAL_IDENTIFIERS:
        # Check as identifier word boundary or literal
        if re.search(rf"\b{re.escape(identifier)}\b", code_without_comments):
            violations.append(f"Forbidden identifier '{identifier}' found in js/chemistry-engine.js")

    assert not violations, "\n".join(violations)


def test_reads_chemistry_facts_only_from_binding():
    """Verify that js/chemistry-engine.js reads from catalog binding (__CHEMISTRY_CATALOG__)."""
    source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "__CHEMISTRY_CATALOG__" in source, (
        "js/chemistry-engine.js must reference __CHEMISTRY_CATALOG__ to read from generated binding"
    )
    assert "getCatalog" in source
    assert "getSubstance" in source
    assert "findReactionRecord" in source
    assert "evaluateExperiment" in source


def test_no_export_in_classic_script():
    """Assert js/chemistry-engine.js contains no ES module export keyword, remaining a classic script."""
    source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    code_without_comments = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    code_without_comments = re.sub(r"//.*$", "", code_without_comments, flags=re.MULTILINE)
    assert not re.search(r"\bexport\b", code_without_comments), (
        "js/chemistry-engine.js must remain a classic browser script without top-level 'export'"
    )
