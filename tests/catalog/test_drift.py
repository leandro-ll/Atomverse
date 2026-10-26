"""Property test 5: Any hand edit to generated output is detected.

Validates: Requirements 2.7
For any mutation of any committed generated artifact (catalog, digest sidecar,
JS binding, Python binding, coverage report) that is not accompanied by a seed
or generator change, the drift check fails and names the mutated artifact.
"""

from pathlib import Path
import pytest
from scripts.catalog.check_drift import check_drift, DriftError

ROOT = Path(__file__).resolve().parents[2]

TARGET_ARTIFACTS = [
    "catalog/chemistry.catalog.json",
    "catalog/chemistry.catalog.digest.json",
    "catalog/coverage-report.json",
    "js/generated/chemistry-catalog.js",
    "backend/app/generated/chemistry_catalog.py",
]


def test_clean_repo_passes_drift_check():
    """Verify clean workspace passes check_drift with four-way digest parity."""
    res = check_drift(ROOT)
    assert res["catalogSha256"] == res["sidecarDigest"] == res["jsDigest"] == res["pyDigest"]


@pytest.mark.parametrize("rel_path", TARGET_ARTIFACTS)
def test_hand_edit_is_detected_property(rel_path: str):
    target_file = ROOT / rel_path
    assert target_file.exists(), f"Target file {target_file} does not exist"

    original_bytes = target_file.read_bytes()

    try:
        # Mutate by appending a comment or newline byte
        mutated_bytes = original_bytes + b" \n"
        target_file.write_bytes(mutated_bytes)

        with pytest.raises(DriftError) as exc_info:
            check_drift(ROOT)

        err_msg = str(exc_info.value)
        # Check that the error names the mutated artifact
        assert rel_path in err_msg or target_file.name in err_msg, (
            f"Drift check failed without naming mutated artifact {rel_path}: {err_msg}"
        )

    finally:
        # Guarantee restoration of the exact original bytes
        target_file.write_bytes(original_bytes)
