"""Property test 27: Unverified substances are never reported as verified.

Validates: Requirements 11.6

For all substances absent from the cached validation fixture,
referenceValidation.status is unverified, and no substance carries
verified status without a corresponding cache entry.
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
QUERIED_SET = {e["substanceId"] for e in QUERIED_ENTRIES}


def test_committed_catalog_unverified_status():
    """Verify in committed catalog that all absent substances are unverified and no substance is falsely verified."""
    substances = CATALOG["substances"]

    for sub in substances:
        sid = sub["id"]
        ref_val = sub.get("referenceValidation", {})
        status = ref_val.get("status")

        if sid in QUERIED_SET:
            assert status == "verified"
            assert ref_val.get("cid") is not None
            assert ref_val.get("referenceFormula") is not None
        else:
            assert status == "unverified"
            assert ref_val.get("cid") is None
            assert ref_val.get("referenceFormula") is None
            assert ref_val.get("referenceMassGPerMol") is None
            assert ref_val.get("massDeltaPpm") is None


def test_unverified_substances_never_verified_property():
    """For any partition of cache entries, unqueried substances are never reported as verified."""
    rng = random.Random(2701)

    for _ in range(120):
        # Pick a random subset of queried entries (between 0 and len(QUERIED_ENTRIES))
        subset_size = rng.randint(0, len(QUERIED_ENTRIES))
        retained_entries = rng.sample(QUERIED_ENTRIES, subset_size)
        retained_set = {e["substanceId"] for e in retained_entries}

        sub_cache = {
            "schemaVersion": "1.0.0",
            "retrievedOn": "2025-06-01",
            "endpoint": COMMITTED_CACHE["endpoint"],
            "queried": retained_entries,
            "missing": [
                {"substanceId": s.id, "reason": "omitted_for_property_test"}
                for s in ALL_SUBSTANCES
                if s.id not in retained_set
            ],
        }

        checked = cross_check(ALL_SUBSTANCES, sub_cache, tol_ppm=500.0)

        for sub in checked:
            ref_val = sub.referenceValidation
            if sub.id not in retained_set:
                assert ref_val["status"] == "unverified", (
                    f"Substance {sub.id} absent from cache must have status 'unverified', got {ref_val['status']}"
                )
                assert ref_val["cid"] is None
                assert ref_val["referenceFormula"] is None
            else:
                assert ref_val["status"] == "verified"
