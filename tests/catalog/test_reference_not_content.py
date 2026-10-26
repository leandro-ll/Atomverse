"""Property test 28: Reference data never becomes catalog content.

Validates: Requirements 11.4

For all substances, the Indonesian name is not equal to any reference-supplied
name, and no solubility class derives from the cached fixture.
"""

from __future__ import annotations

import json
from pathlib import Path
import random
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

from backend.app.generated.chemistry_catalog import CATALOG
from scripts.catalog.generate import cross_check, enumerate_substances
from scripts.catalog.validate_seed import validate_seed

SEED_BUNDLE = validate_seed(REPO_ROOT / "catalog" / "seed")
ALL_SUBSTANCES = enumerate_substances(SEED_BUNDLE, cache=False)
CACHE_PATH = REPO_ROOT / "tests" / "fixtures" / "chemistry" / "pubchem-cache.json"

with open(CACHE_PATH, encoding="utf-8") as f:
    COMMITTED_CACHE = json.load(f)

QUERIED_ENTRIES = COMMITTED_CACHE.get("queried", [])


def test_committed_catalog_reference_isolation():
    """Assert for all substances in catalog that names and solubility are not reference-derived."""
    # 1. Assert committed cache fixture carries no solubility data
    for entry in QUERIED_ENTRIES:
        assert "solubilityClass" not in entry
        assert "solubility" not in entry

    # 2. Assert no catalog substance has an Indonesian name matching a reference query name
    query_names = {e["queryName"].lower() for e in QUERIED_ENTRIES}
    for sub in CATALOG["substances"]:
        indo_name = sub["indonesianName"].lower()
        assert indo_name not in query_names, (
            f"Substance {sub['id']} has indonesianName '{sub['indonesianName']}' matching reference query name"
        )
        # Solubility class must be one of the three modeled domain classes
        assert sub["solubilityClass"] in ("soluble", "insoluble", "slightly_soluble")
        # Every substance has a solubilityRuleId (or H2O exception)
        if sub["id"] != "sub.h2o":
            assert sub["solubilityRuleId"] is not None


def test_reference_mutation_isolation_property():
    """Mutating reference fixture with bogus names or solubility facts never leaks into catalog content."""
    rng = random.Random(2801)

    bogus_names = [
        "chlorosilver", "silver(1+) chloride", "dichlorolead", "lead dichloride",
        "sodium monochloride", "oxidane", "dihydrogen monoxide", "barium disulfate"
    ]
    bogus_solubilities = ["always_dissolves", "super_soluble", "never_precipitates", "unknown_phase"]

    for _ in range(120):
        entry = rng.choice(QUERIED_ENTRIES)
        sid = entry["substanceId"]
        sub = next(s for s in ALL_SUBSTANCES if s.id == sid)

        bogus_name = rng.choice(bogus_names)
        bogus_solubility = rng.choice(bogus_solubilities)

        mock_cache = {
            "schemaVersion": "1.0.0",
            "retrievedOn": "2025-06-01",
            "endpoint": COMMITTED_CACHE["endpoint"],
            "queried": [
                {
                    "substanceId": sid,
                    "queryName": bogus_name,
                    "cid": entry["cid"],
                    "molecularFormula": entry["molecularFormula"],
                    "molecularWeight": str(entry["molecularWeight"]),
                    # Injected unauthorized fields
                    "iupacName": bogus_name,
                    "solubilityClass": bogus_solubility,
                }
            ],
            "missing": [],
        }

        checked = cross_check([sub], mock_cache, tol_ppm=500.0)
        checked_sub = checked[0]

        # Indonesian name must remain the original seed-derived name
        assert checked_sub.indonesianName == sub.indonesianName
        assert checked_sub.indonesianName != bogus_name

        # Solubility class must remain original rule-derived class
        assert checked_sub.solubilityClass == sub.solubilityClass
        assert checked_sub.solubilityClass != bogus_solubility

        # Reference validation block must contain only validation metadata
        ref_val = checked_sub.referenceValidation
        assert "iupacName" not in ref_val
        assert "solubilityClass" not in ref_val
        assert set(ref_val.keys()).issubset({
            "status", "source", "cid", "referenceFormula", "referenceMassGPerMol", "massDeltaPpm"
        })
