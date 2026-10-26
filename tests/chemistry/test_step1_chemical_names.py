"""Snapshot and guard test for Step 1 of literal removal: chemicalNames.

Validates: Requirements 10.1, 7.4
- Verifies that chemicalNames literal is absent from js/chemistry-engine.js
- Verifies that js/main.js does not reference chemicalNames
- Verifies snapshot of all eight original formulas from substances[id].notation.unicode,
  specifically asserting AgNO3 is AgNO\u2083 (with subscript 3, not AgNO)
- Verifies snapshot of all eight Indonesian names from substances[id].indonesianName
"""

from pathlib import Path
import re
import pytest

from backend.app.generated.chemistry_catalog import CATALOG

ROOT = Path(__file__).resolve().parents[2]
CHEMISTRY_ENGINE_JS = ROOT / "js" / "chemistry-engine.js"
MAIN_JS = ROOT / "js" / "main.js"

# The eight original formulas and expected unicode notation
EXPECTED_ORIGINAL_FORMULAS = {
    "AgNO3": "AgNO\u2083",
    "Pb(NO3)2": "Pb(NO\u2083)\u2082",
    "BaCl2": "BaCl\u2082",
    "NaCl": "NaCl",
    "KI": "KI",
    "Na2SO4": "Na\u2082SO\u2084",
    "HCl": "HCl",
    "NaOH": "NaOH",
}

EXPECTED_INDONESIAN_NAMES = {
    "AgNO3": "Perak nitrat",
    "Pb(NO3)2": "Timbal(II) nitrat",
    "BaCl2": "Barium klorida",
    "NaCl": "Natrium klorida",
    "KI": "Kalium iodida",
    "Na2SO4": "Natrium sulfat",
    "HCl": "Asam klorida",
    "NaOH": "Natrium hidroksida",
}


def test_chemical_names_literal_absent_from_chemistry_engine():
    """Assert that the chemicalNames identifier is not declared or assigned in js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "chemicalNames" not in engine_source, (
        "Found 'chemicalNames' literal or identifier in js/chemistry-engine.js; it must be removed in Step 1."
    )


def test_chemical_names_absent_from_main_js():
    """Assert that js/main.js no longer reads from chemicalNames."""
    main_source = MAIN_JS.read_text(encoding="utf-8")
    assert "chemicalNames" not in main_source, (
        "Found 'chemicalNames' reference in js/main.js; it must use getChemicalUnicode."
    )


def test_helpers_defined_in_chemistry_engine():
    """Assert getChemicalUnicode and getChemicalIndonesianName are defined in js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "function getChemicalUnicode" in engine_source
    assert "function getChemicalIndonesianName" in engine_source


def test_snapshot_all_eight_original_formulas():
    """Snapshot test over all eight original formulas from the catalog binding."""
    substances_by_token = {s["formulaToken"]: s for s in CATALOG["substances"]}
    substances_by_id = {s["id"]: s for s in CATALOG["substances"]}

    for token, expected_unicode in EXPECTED_ORIGINAL_FORMULAS.items():
        assert token in substances_by_token, f"Original formula token {token} missing from catalog substances"
        sub = substances_by_token[token]

        # Verify unicode notation snapshot
        assert sub["notation"]["unicode"] == expected_unicode, (
            f"Formula mismatch for {token}: expected {expected_unicode!r}, got {sub['notation']['unicode']!r}"
        )

        # Specifically assert AgNO3 has subscript 3, not the mangled AgNO
        if token == "AgNO3":
            assert sub["notation"]["unicode"].endswith("\u2083"), "AgNO3 must end with subscript 3 (\\u2083)"
            assert sub["notation"]["unicode"] != "AgNO", "AgNO3 must not be mangled to AgNO"

        # Verify Indonesian name snapshot
        expected_name = EXPECTED_INDONESIAN_NAMES[token]
        assert sub["indonesianName"] == expected_name, (
            f"Indonesian name mismatch for {token}: expected {expected_name!r}, got {sub['indonesianName']!r}"
        )
