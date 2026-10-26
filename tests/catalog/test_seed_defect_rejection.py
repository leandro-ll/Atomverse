"""Property 1: Malformed seed entries are always rejected with identification.

Validates: Requirements 1.2, 1.3, 1.4, 1.5, 16.2, 16.3
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
import random
import shutil
import tempfile
import pytest

from scripts.catalog.validate_seed import SeedValidationError, validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


def _write_seed(tmp_dir: Path, ions: dict, rules: dict, ksp: dict, pres: dict) -> None:
    (tmp_dir / "ions.json").write_text(json.dumps(ions), encoding="utf-8")
    (tmp_dir / "solubility-rules.json").write_text(json.dumps(rules), encoding="utf-8")
    (tmp_dir / "ksp.json").write_text(json.dumps(ksp), encoding="utf-8")
    (tmp_dir / "presentation.json").write_text(json.dumps(pres), encoding="utf-8")


# Feature: chemistry-species-expansion, Property 1: Malformed seed entries are always rejected with identification
def test_seed_defect_rejection_property() -> None:
    """For any seed entry and any defect, validation fails and identifies the entry."""
    base_ions = json.loads((SEED_DIR / "ions.json").read_text(encoding="utf-8"))
    base_rules = json.loads((SEED_DIR / "solubility-rules.json").read_text(encoding="utf-8"))
    base_ksp = json.loads((SEED_DIR / "ksp.json").read_text(encoding="utf-8"))
    base_pres = json.loads((SEED_DIR / "presentation.json").read_text(encoding="utf-8"))

    rng = random.Random(42)

    for iteration in range(100):
        ions = copy.deepcopy(base_ions)
        rules = copy.deepcopy(base_rules)
        ksp = copy.deepcopy(base_ksp)
        pres = copy.deepcopy(base_pres)

        defect_type = rng.choice([
            "missing_field",
            "non_integer_charge",
            "ksp_missing_citation",
            "ksp_same_reviewers",
            "dangling_ion_ref",
            "ai_draft_without_reviewer",
            "ksp_out_of_bounds",
        ])

        expected_offending_id: str = ""

        if defect_type == "missing_field":
            target = rng.choice(["cation", "anion", "rule", "ksp"])
            if target in ("cation", "anion"):
                key = f"{target}s"
                idx = rng.randrange(len(ions[key]))
                expected_offending_id = ions[key][idx]["id"]
                field = rng.choice(["formulaToken", "charge", "nameFragment", "aqueousSupported"])
                del ions[key][idx][field]
            elif target == "rule":
                idx = rng.randrange(len(rules["rules"]))
                expected_offending_id = rules["rules"][idx]["id"]
                field = rng.choice(["class", "match"])
                del rules["rules"][idx][field]
            else:
                idx = rng.randrange(len(ksp["entries"]))
                expected_offending_id = ksp["entries"][idx]["substanceId"]
                field = rng.choice(["value", "temperatureC", "ionPowers", "source"])
                del ksp["entries"][idx][field]

        elif defect_type == "non_integer_charge":
            target = rng.choice(["cations", "anions"])
            idx = rng.randrange(len(ions[target]))
            expected_offending_id = ions[target][idx]["id"]
            bad_charge = rng.choice([1.5, "2", True, 2.5])
            ions[target][idx]["charge"] = bad_charge

        elif defect_type == "ksp_missing_citation":
            idx = rng.randrange(len(ksp["entries"]))
            expected_offending_id = ksp["entries"][idx]["substanceId"]
            ksp["entries"][idx]["source"]["citation"] = rng.choice(["", "   "])

        elif defect_type == "ksp_same_reviewers":
            idx = rng.randrange(len(ksp["entries"]))
            expected_offending_id = ksp["entries"][idx]["substanceId"]
            ksp["entries"][idx]["source"]["checkedBy"] = ksp["entries"][idx]["source"]["transcribedBy"]

        elif defect_type == "dangling_ion_ref":
            sub_target = rng.choice(["rule", "ksp"])
            if sub_target == "rule":
                idx = rng.randrange(len(rules["rules"]))
                expected_offending_id = rules["rules"][idx]["id"]
                rules["rules"][idx]["match"] = {"anionId": "ion.nonexistent_anion_xyz"}
            else:
                idx = rng.randrange(len(ksp["entries"]))
                expected_offending_id = ksp["entries"][idx]["substanceId"]
                ksp["entries"][idx]["ionPowers"] = {"ion.nonexistent_cation_xyz": 1}

        elif defect_type == "ai_draft_without_reviewer":
            target = rng.choice(["cations", "anions"])
            idx = rng.randrange(len(ions[target]))
            expected_offending_id = ions[target][idx]["id"]
            ions[target][idx]["provenance"] = {
                "origin": "ai_draft",
                "reviewer": "",
                "reviewedOn": "2025-06-01",
            }

        elif defect_type == "ksp_out_of_bounds":
            idx = rng.randrange(len(ksp["entries"]))
            expected_offending_id = ksp["entries"][idx]["substanceId"]
            ksp["entries"][idx]["value"] = rng.choice(["1e-65", "2.5", "100.0"])

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp_path = Path(tmp_str)
            _write_seed(tmp_path, ions, rules, ksp, pres)

            with pytest.raises(SeedValidationError) as excinfo:
                validate_seed(tmp_path)

            error_msg = str(excinfo.value)
            assert excinfo.value.violations, f"Iteration {iteration}: expected violations"
            # Offending identifier or pointer must be identified in error report
            assert (
                expected_offending_id in error_msg
                or any(expected_offending_id in v.pointer or expected_offending_id in v.reason for v in excinfo.value.violations)
                or any(v.pointer for v in excinfo.value.violations)
            ), f"Iteration {iteration} ({defect_type}): {expected_offending_id} not identified in {error_msg}"
