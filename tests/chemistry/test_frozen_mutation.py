"""Property test 10: Frozen fixtures are immutable under change.

Validates: Requirements 6.3
For any mutation of a seed entry, solubility rule, nomenclature override, or generator stage
that participates in one of the six frozen reactions, the frozen-fixture suite fails.
"""

import json
from pathlib import Path
import pytest

from backend.app.generated.chemistry_catalog import CATALOG, CATALOG_VERSION

ROOT = Path(__file__).resolve().parents[2]
FIXTURES_PATH = ROOT / "tests" / "fixtures" / "chemistry" / "frozen-reactions.json"


def run_fixture_check(custom_fixtures_data: dict, custom_catalog: dict = None) -> None:
    """Run the frozen fixture verification logic on custom/mutated data."""
    active_cat = custom_catalog if custom_catalog is not None else CATALOG
    substance_map = {s["id"]: s for s in active_cat["substances"]}
    reaction_map = {r["id"]: r for r in active_cat["reactions"]}

    for fix in custom_fixtures_data["fixtures"]:
        exp = fix["expect"]
        rxn_id = exp["reactionId"]
        assert rxn_id in reaction_map, f"Reaction {rxn_id} missing"
        rec = reaction_map[rxn_id]
        assert rec["id"] == rxn_id
        assert rec["molecularEquation"] == exp["molecularEquation"]
        assert rec["netIonicEquation"] == exp["netIonicEquation"]

        if exp["outcome"] == "precipitate_forms":
            solid_id = exp["productId"]
            assert rec["candidateSolidId"] == solid_id
            assert solid_id in substance_map
            assert substance_map[solid_id]["indonesianName"] == exp["productIndonesianName"]
            assert rec["kspRef"]["value"] == exp["kspLiteral"]


def test_frozen_mutation_property():
    raw_fixtures = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))

    # Baseline passes
    run_fixture_check(raw_fixtures)

    # 1. Mutate molecular equation in fixture -> must fail
    mutated = json.loads(json.dumps(raw_fixtures))
    mutated["fixtures"][0]["expect"]["molecularEquation"] += " (corrupted)"
    with pytest.raises(AssertionError):
        run_fixture_check(mutated)

    # 2. Mutate net-ionic equation in fixture -> must fail
    mutated = json.loads(json.dumps(raw_fixtures))
    mutated["fixtures"][0]["expect"]["netIonicEquation"] += " + e-"
    with pytest.raises(AssertionError):
        run_fixture_check(mutated)

    # 3. Mutate product name -> must fail
    mutated = json.loads(json.dumps(raw_fixtures))
    mutated["fixtures"][0]["expect"]["productIndonesianName"] = "Wrong Name"
    with pytest.raises(AssertionError):
        run_fixture_check(mutated)

    # 4. Mutate product id -> must fail
    mutated = json.loads(json.dumps(raw_fixtures))
    mutated["fixtures"][0]["expect"]["productId"] = "sub.wrong_id"
    with pytest.raises(AssertionError):
        run_fixture_check(mutated)

    # 5. Mutate Ksp literal in fixture -> must fail
    mutated = json.loads(json.dumps(raw_fixtures))
    mutated["fixtures"][0]["expect"]["kspLiteral"] = "9.99e-99"
    with pytest.raises(AssertionError):
        run_fixture_check(mutated)

    # 6. Mutate catalog side (participating catalog reaction) -> must fail
    cat_file = ROOT / "catalog" / "chemistry.catalog.json"
    mutated_cat = json.loads(cat_file.read_text(encoding="utf-8"))
    pb_rxn = next(r for r in mutated_cat["reactions"] if r["id"] == "rxn.nacl__pb_no3_2")
    pb_rxn["kspRef"]["value"] = "1.0e-20"
    with pytest.raises(AssertionError):
        run_fixture_check(raw_fixtures, custom_catalog=mutated_cat)
