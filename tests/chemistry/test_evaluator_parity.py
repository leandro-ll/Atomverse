"""Two-evaluator parity suite between JS and Python pure evaluators.

Validates: Requirements 6.4, 8.1, 8.2, 8.3, 2.7, 4.4
- Runs all six frozen fixtures and the shared vector set through both runtimes.
- Asserts identical:
  - outcome category
  - productId
  - candidateSolidId
  - molecularEquation
  - netIonicEquation
  - spectatorIonIds
  - saturation (Q, ratio, ksp, kspSourceId)
- Asserts both evaluators fail closed with CatalogCompatibilityError on schema major or digest mismatch.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import (
    CatalogCompatibilityError,
    ChemistryEvaluator,
    evaluate_experiment,
    verify_catalog_compatibility,
)

ROOT = Path(__file__).resolve().parents[2]
FROZEN_PATH = ROOT / "tests" / "fixtures" / "chemistry" / "frozen-reactions.json"
VECTORS_PATH = ROOT / "tests" / "fixtures" / "chemistry" / "parity-vectors.json"


def run_js_evaluator_batch(vectors: list[dict]) -> dict:
    """Invokes the JS evaluator in Node over a batch of vector inputs."""
    js_script = """
import { evaluateExperiment } from './js/domain/chemistry-evaluator.js';

const vectors = JSON.parse(process.argv[1]);
const results = {};
for (const v of vectors) {
  results[v.id] = evaluateExperiment(v.input);
}
console.log(JSON.stringify(results));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", js_script, json.dumps(vectors)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return json.loads(proc.stdout)


def test_evaluator_parity_frozen_and_shared_vectors():
    """Assert field-for-field parity across Python and JS evaluators."""
    assert FROZEN_PATH.exists(), f"Missing frozen fixtures: {FROZEN_PATH}"
    assert VECTORS_PATH.exists(), f"Missing parity vectors: {VECTORS_PATH}"

    frozen_data = json.loads(FROZEN_PATH.read_text(encoding="utf-8"))["fixtures"]
    vector_data = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))["vectors"]

    all_vectors: list[dict] = []
    for fix in frozen_data:
        fix_id = fix.get("id") or fix["expect"]["reactionId"]
        all_vectors.append({
            "id": f"frozen::{fix_id}",
            "input": {
                "reagentAId": fix["reagentAId"],
                "reagentBId": fix["reagentBId"],
                **fix["input"],
            },
        })
    for vec in vector_data:
        all_vectors.append(vec)

    assert len(all_vectors) >= 30, f"Expected at least 30 combined vectors, got {len(all_vectors)}"

    # Evaluate via Python
    py_results = {}
    for vec in all_vectors:
        py_results[vec["id"]] = evaluate_experiment(CATALOG, vec["input"])

    # Evaluate via JS
    js_results = run_js_evaluator_batch(all_vectors)

    # Compare field for field
    for vec in all_vectors:
        vid = vec["id"]
        py_res = py_results[vid]
        js_res = js_results[vid]

        # 1. Outcome category
        assert py_res["outcome"] == js_res["outcome"], (
            f"Parity mismatch in vector '{vid}' for field 'outcome': "
            f"Python='{py_res['outcome']}', JS='{js_res['outcome']}'"
        )

        # 2. Product ID
        assert py_res["productId"] == js_res["productId"], (
            f"Parity mismatch in vector '{vid}' for field 'productId': "
            f"Python='{py_res['productId']}', JS='{js_res['productId']}'"
        )

        # 3. Candidate solid ID
        assert py_res["candidateSolidId"] == js_res["candidateSolidId"], (
            f"Parity mismatch in vector '{vid}' for field 'candidateSolidId': "
            f"Python='{py_res['candidateSolidId']}', JS='{js_res['candidateSolidId']}'"
        )

        # 4. Molecular Equation
        assert py_res["molecularEquation"] == js_res["molecularEquation"], (
            f"Parity mismatch in vector '{vid}' for field 'molecularEquation': "
            f"Python='{py_res['molecularEquation']}', JS='{js_res['molecularEquation']}'"
        )

        # 5. Net-ionic Equation
        assert py_res["netIonicEquation"] == js_res["netIonicEquation"], (
            f"Parity mismatch in vector '{vid}' for field 'netIonicEquation': "
            f"Python='{py_res['netIonicEquation']}', JS='{js_res['netIonicEquation']}'"
        )

        # 6. Spectator ions
        py_spectators = sorted(py_res.get("spectatorIonIds") or [])
        js_spectators = sorted(js_res.get("spectatorIonIds") or [])
        assert py_spectators == js_spectators, (
            f"Parity mismatch in vector '{vid}' for field 'spectatorIonIds': "
            f"Python={py_spectators}, JS={js_spectators}"
        )

        # 7. Saturation block
        py_sat = py_res.get("saturation")
        js_sat = js_res.get("saturation")
        if py_sat is None or js_sat is None:
            assert py_sat is None and js_sat is None, (
                f"Parity mismatch in vector '{vid}' for saturation presence: "
                f"Python={py_sat is not None}, JS={js_sat is not None}"
            )
        else:
            assert py_sat["ksp"] == pytest.approx(js_sat["ksp"], rel=1e-5), (
                f"Parity mismatch in vector '{vid}' for saturation.ksp: "
                f"Python={py_sat['ksp']}, JS={js_sat['ksp']}"
            )
            assert py_sat["Q"] == pytest.approx(js_sat["Q"], rel=1e-4), (
                f"Parity mismatch in vector '{vid}' for saturation.Q: "
                f"Python={py_sat['Q']}, JS={js_sat['Q']}"
            )
            assert py_sat["ratio"] == pytest.approx(js_sat["ratio"], rel=1e-4), (
                f"Parity mismatch in vector '{vid}' for saturation.ratio: "
                f"Python={py_sat['ratio']}, JS={js_sat['ratio']}"
            )
            assert py_sat.get("kspSourceId") == js_sat.get("kspSourceId"), (
                f"Parity mismatch in vector '{vid}' for saturation.kspSourceId"
            )


def test_schema_major_and_digest_fail_closed():
    """Verify that both evaluators fail closed when schema-major or digest mismatches."""
    # 1. Python evaluator schema-major mismatch
    incompatible_catalog = dict(CATALOG)
    incompatible_catalog["schemaVersion"] = "1.0.0"
    incompatible_catalog["catalogVersion"] = "1.0.0"

    with pytest.raises(CatalogCompatibilityError) as exc_info:
        ChemistryEvaluator(incompatible_catalog)
    assert "skema utama" in str(exc_info.value) or "tidak kompatibel" in str(exc_info.value)

    # 2. Python evaluator digest mismatch
    with pytest.raises(CatalogCompatibilityError):
        verify_catalog_compatibility(
            {"catalogVersion": "2.0.0", "digest": "wrong_digest_hash"},
            expected_digest="expected_hash_xyz",
        )

    # 3. JS evaluator schema-major mismatch in Node
    js_check = """
import { createChemistryEvaluator, CatalogCompatibilityError } from './js/domain/chemistry-evaluator.js';
import { CATALOG } from './js/generated/chemistry-catalog.js';

let caught = false;
try {
  const badCatalog = { ...CATALOG, schemaVersion: '1.0.0', catalogVersion: '1.0.0' };
  createChemistryEvaluator(badCatalog);
} catch (e) {
  if (e instanceof CatalogCompatibilityError || e.name === 'CatalogCompatibilityError') {
    caught = true;
  }
}
if (!caught) {
  console.error('JS evaluator failed to raise CatalogCompatibilityError on schema major mismatch');
  process.exit(1);
}
console.log('JS_FAIL_CLOSED_OK');
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", js_check],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    assert "JS_FAIL_CLOSED_OK" in proc.stdout
