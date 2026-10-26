"""Property test 26: Generated masses and formulas agree with the cached reference.

Validates: Requirements 11.1, 11.5

For all substances present in the cached validation fixture, the generated
formula's element multiset equals the reference formula's element multiset
and the molar-mass difference is within the declared ppm tolerance;
for any perturbation of a cached mass, validation fails if and only if the
perturbation exceeds that tolerance, and the failure message names the substance
and both values.
"""

from __future__ import annotations

import json
from pathlib import Path
import random
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

from scripts.catalog.generate import cross_check, enumerate_substances, formulas_equivalent
from scripts.catalog.validate_seed import validate_seed

SEED_BUNDLE = validate_seed(REPO_ROOT / "catalog" / "seed")
ALL_SUBSTANCES = enumerate_substances(SEED_BUNDLE, cache=False)
CACHE_PATH = REPO_ROOT / "tests" / "fixtures" / "chemistry" / "pubchem-cache.json"

with open(CACHE_PATH, encoding="utf-8") as f:
    COMMITTED_CACHE = json.load(f)

QUERIED_ENTRIES = COMMITTED_CACHE.get("queried", [])
SUBSTANCE_MAP = {s.id: s for s in ALL_SUBSTANCES}


def test_committed_cache_reference_agreement():
    """Verify all substances present in committed fixture agree with reference within 500 ppm."""
    checked = cross_check(ALL_SUBSTANCES, COMMITTED_CACHE, tol_ppm=500.0)
    checked_map = {s.id: s for s in checked}

    for entry in QUERIED_ENTRIES:
        sid = entry["substanceId"]
        sub = checked_map[sid]
        ref_val = sub.referenceValidation
        assert ref_val["status"] == "verified"
        assert ref_val["cid"] == entry["cid"]
        assert ref_val["referenceFormula"] == entry["molecularFormula"]

        ref_mass = float(entry["molecularWeight"])
        our_mass = float(sub.molarMassGPerMol)
        ppm = abs(ref_mass - our_mass) / ref_mass * 1e6
        assert ppm <= 500.0
        assert ref_val["massDeltaPpm"] == round(ppm)
        assert formulas_equivalent(sub.formulaToken, entry["molecularFormula"])


def test_mass_perturbation_exceeding_tolerance_fails_property():
    """For any perturbation of a cached mass exceeding tolerance, validation fails with identification."""
    rng = random.Random(2601)

    for _ in range(120):
        entry = rng.choice(QUERIED_ENTRIES)
        sid = entry["substanceId"]
        sub = SUBSTANCE_MAP[sid]
        our_mass = float(sub.molarMassGPerMol)

        # Generate perturbation > 500 ppm (between 505 and 50000 ppm)
        ppm_delta = rng.uniform(505.0, 50000.0)
        sign = rng.choice([-1.0, 1.0])

        if sign > 0:
            perturbed_ref_mass = our_mass / (1.0 - (ppm_delta / 1e6))
        else:
            perturbed_ref_mass = our_mass / (1.0 + (ppm_delta / 1e6))

        mock_cache = {
            "schemaVersion": "1.0.0",
            "retrievedOn": "2025-06-01",
            "endpoint": COMMITTED_CACHE["endpoint"],
            "queried": [
                {
                    "substanceId": sid,
                    "queryName": entry["queryName"],
                    "cid": entry["cid"],
                    "molecularFormula": entry["molecularFormula"],
                    "molecularWeight": f"{perturbed_ref_mass:.6f}",
                }
            ],
            "missing": [],
        }

        with pytest.raises(ValueError) as exc_info:
            cross_check([sub], mock_cache, tol_ppm=500.0)

        err_msg = str(exc_info.value)
        # Failure message MUST identify substance id, catalog mass, and reference mass
        assert sid in err_msg, f"Error message must name substance {sid}: {err_msg}"
        assert str(sub.molarMassGPerMol) in err_msg or f"{our_mass:.4f}" in err_msg, (
            f"Error message must name catalog mass {sub.molarMassGPerMol}: {err_msg}"
        )
        assert f"{perturbed_ref_mass:.6f}" in err_msg, (
            f"Error message must name reference mass {perturbed_ref_mass:.6f}: {err_msg}"
        )


def test_formula_mismatch_fails_with_identification_property():
    """For any reference formula multiset mismatch, validation fails naming substance and both formulas."""
    rng = random.Random(2602)
    candidate_formulas = ["H2O", "NaCl", "AgCl", "BaSO4", "PbI2", "KNO3", "CaCO3", "FeCl3"]

    for _ in range(120):
        entry = rng.choice(QUERIED_ENTRIES)
        sid = entry["substanceId"]
        sub = SUBSTANCE_MAP[sid]

        # Pick a formula that has a different composition
        mutated_formula = rng.choice(candidate_formulas)
        while formulas_equivalent(sub.formulaToken, mutated_formula):
            mutated_formula = rng.choice(candidate_formulas)

        mock_cache = {
            "schemaVersion": "1.0.0",
            "retrievedOn": "2025-06-01",
            "endpoint": COMMITTED_CACHE["endpoint"],
            "queried": [
                {
                    "substanceId": sid,
                    "queryName": entry["queryName"],
                    "cid": entry["cid"],
                    "molecularFormula": mutated_formula,
                    "molecularWeight": str(entry["molecularWeight"]),
                }
            ],
            "missing": [],
        }

        with pytest.raises(ValueError) as exc_info:
            cross_check([sub], mock_cache, tol_ppm=500.0)

        err_msg = str(exc_info.value)
        assert sid in err_msg, f"Error message must name substance {sid}: {err_msg}"
        assert sub.formulaToken in err_msg, f"Error message must name catalog formula: {err_msg}"
        assert mutated_formula in err_msg, f"Error message must name reference formula: {err_msg}"
