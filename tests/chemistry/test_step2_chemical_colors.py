"""Guard test for Step 2 of literal removal: chemicalColors.

Validates: Requirements 10.1
- Verifies that chemicalColors literal is absent from js/chemistry-engine.js
- Verifies that js/main.js does not reference chemicalColors
- Verifies that getChemicalColor is defined in js/chemistry-engine.js
- Verifies that every substance's displayColor is sourced from presentation.substanceColors
- Verifies visual color snapshot for all eight original reagents
"""

from pathlib import Path
import re
import pytest

from backend.app.generated.chemistry_catalog import CATALOG

ROOT = Path(__file__).resolve().parents[2]
CHEMISTRY_ENGINE_JS = ROOT / "js" / "chemistry-engine.js"
MAIN_JS = ROOT / "js" / "main.js"

HEX_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")

EXPECTED_ORIGINAL_COLORS = {
    "AgNO3": "#94a3b8",
    "Pb(NO3)2": "#64748b",
    "BaCl2": "#38bdf8",
    "NaCl": "#a855f7",
    "KI": "#8b5cf6",
    "Na2SO4": "#a855f7",
    "HCl": "#ef4444",
    "NaOH": "#a855f7",
}


def test_chemical_colors_literal_absent_from_chemistry_engine():
    """Assert that chemicalColors identifier is absent from js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "chemicalColors" not in engine_source, (
        "Found 'chemicalColors' literal in js/chemistry-engine.js; it must be removed in Step 2."
    )


def test_chemical_colors_absent_from_main_js():
    """Assert that js/main.js no longer reads from chemicalColors."""
    main_source = MAIN_JS.read_text(encoding="utf-8")
    assert "chemicalColors" not in main_source, (
        "Found 'chemicalColors' reference in js/main.js; it must use getChemicalColor."
    )


def test_get_chemical_color_defined():
    """Assert getChemicalColor function is defined in js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "function getChemicalColor" in engine_source


def test_substance_colors_sourced_from_presentation():
    """Verify that every substance displayColor matches presentation.substanceColors if defined, or cation fallback."""
    substance_colors = CATALOG["presentation"]["substanceColors"]
    cations_by_id = {c["id"]: c for c in CATALOG["ions"] if c["kind"] == "cation"}

    for sub in CATALOG["substances"]:
        sub_id = sub["id"]
        expected_color = substance_colors.get(sub_id, cations_by_id[sub["cationId"]]["displayColor"])
        assert sub["displayColor"] == expected_color, (
            f"displayColor mismatch for {sub_id}: {sub['displayColor']} vs expected {expected_color}"
        )
        assert HEX_COLOR_PATTERN.match(sub["displayColor"]), (
            f"displayColor for {sub_id} is not a valid 6-digit hex color: {sub['displayColor']}"
        )


def test_visualization_snapshot_original_reagents():
    """Snapshot test for solution display colors of all 8 original reagents."""
    substances_by_token = {s["formulaToken"]: s for s in CATALOG["substances"]}

    for token, expected_color in EXPECTED_ORIGINAL_COLORS.items():
        assert token in substances_by_token
        sub = substances_by_token[token]
        assert sub["displayColor"] == expected_color, (
            f"Color mismatch for {token}: expected {expected_color}, got {sub['displayColor']}"
        )
