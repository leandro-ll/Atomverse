"""Guard test for Step 3 of literal removal: reagentIons.

Validates: Requirements 10.1, 10.4, 10.5
- Verifies that reagentIons literal is absent from js/chemistry-engine.js
- Verifies that reagentIons is absent from js/visualization.js
- Verifies that getReagentDissociation is defined in js/chemistry-engine.js
- Verifies that Na2SO4 dissociation yields two Na+ (multiplicity 2) and that 0.1 M Na2SO4 yields 0.2 M Na+
- Verifies that every substance has integer multiplicity and numeric charge with net charge zero
"""

from decimal import Decimal
from pathlib import Path
import pytest

from backend.app.generated.chemistry_catalog import CATALOG

ROOT = Path(__file__).resolve().parents[2]
CHEMISTRY_ENGINE_JS = ROOT / "js" / "chemistry-engine.js"
VISUALIZATION_JS = ROOT / "js" / "visualization.js"


def test_reagent_ions_literal_absent_from_chemistry_engine():
    """Assert that reagentIons identifier is absent from js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "reagentIons" not in engine_source, (
        "Found 'reagentIons' literal in js/chemistry-engine.js; it must be removed in Step 3."
    )


def test_reagent_ions_absent_from_visualization_js():
    """Assert that js/visualization.js no longer reads from reagentIons."""
    vis_source = VISUALIZATION_JS.read_text(encoding="utf-8")
    assert "reagentIons" not in vis_source, (
        "Found 'reagentIons' reference in js/visualization.js; it must use getReagentIons."
    )


def test_get_reagent_dissociation_defined():
    """Assert getReagentDissociation function is defined in js/chemistry-engine.js."""
    engine_source = CHEMISTRY_ENGINE_JS.read_text(encoding="utf-8")
    assert "function getReagentDissociation" in engine_source


def test_na2so4_multiplicity_and_concentration():
    """Assert Na2SO4 contributes two Na+ and that 0.1 M Na2SO4 yields 0.2 M Na+."""
    substances_by_id = {s["id"]: s for s in CATALOG["substances"]}
    assert "sub.na2so4" in substances_by_id, "Missing sub.na2so4 in catalog"

    na2so4 = substances_by_id["sub.na2so4"]
    dissoc = na2so4["dissociation"]
    assert len(dissoc) == 2

    # Find the sodium cation entry
    na_entry = next((d for d in dissoc if d["ionId"] == "ion.na_1p"), None)
    so4_entry = next((d for d in dissoc if d["ionId"] == "ion.so4_2m"), None)

    assert na_entry is not None, "Missing ion.na_1p in sub.na2so4 dissociation"
    assert so4_entry is not None, "Missing ion.so4_2m in sub.na2so4 dissociation"

    # Multiplicities and charges
    assert na_entry["multiplicity"] == 2
    assert na_entry["charge"] == 1
    assert isinstance(na_entry["charge"], int)

    assert so4_entry["multiplicity"] == 1
    assert so4_entry["charge"] == -2
    assert isinstance(so4_entry["charge"], int)

    # 0.1 M Na2SO4 yields 0.2 M Na+
    c_na2so4 = Decimal("0.1")
    c_na_plus = c_na2so4 * na_entry["multiplicity"]
    assert c_na_plus == Decimal("0.2"), f"Expected 0.2 M Na+, got {c_na_plus}"


def test_library_wide_dissociation_multiplicity_and_charge():
    """Verify that every substance has integer multiplicity >= 1, integer charge, and net charge 0."""
    for sub in CATALOG["substances"]:
        dissoc = sub["dissociation"]
        assert len(dissoc) >= 2, f"{sub['id']} must dissociate into at least 2 ions"

        net_charge = 0
        for entry in dissoc:
            assert isinstance(entry["multiplicity"], int) and entry["multiplicity"] >= 1, (
                f"{sub['id']} non-integer or < 1 multiplicity: {entry['multiplicity']}"
            )
            assert isinstance(entry["charge"], int) and entry["charge"] != 0, (
                f"{sub['id']} non-integer or zero charge: {entry['charge']}"
            )
            net_charge += entry["multiplicity"] * entry["charge"]

        assert net_charge == 0, f"{sub['id']} dissociation is not charge-neutral: {net_charge}"
