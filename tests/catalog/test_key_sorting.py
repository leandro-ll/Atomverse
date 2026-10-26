"""Property test 4: Keys are sorted at every depth.

Validates: Requirements 2.4
For every object at any nesting depth in the emitted catalog, digest sidecar,
and coverage report, the keys appear in sorted order.
"""

import json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]


def verify_keys_sorted_at_every_depth(file_path: Path) -> int:
    """Parse JSON and verify keys in every object are lexicographically sorted."""
    assert file_path.exists(), f"File {file_path} does not exist"
    object_count = 0

    def check_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        nonlocal object_count
        object_count += 1
        keys = [k for k, _ in pairs]
        sorted_keys = sorted(keys)
        assert keys == sorted_keys, (
            f"Keys in {file_path.name} not sorted at depth: "
            f"found {keys}, expected {sorted_keys}"
        )
        return dict(pairs)

    content = file_path.read_text(encoding="utf-8")
    json.loads(content, object_pairs_hook=check_pairs)
    return object_count


def test_keys_are_sorted_at_every_depth_property():
    target_files = [
        ROOT / "catalog" / "chemistry.catalog.json",
        ROOT / "catalog" / "chemistry.catalog.digest.json",
        ROOT / "catalog" / "coverage-report.json",
    ]

    for target in target_files:
        obj_count = verify_keys_sorted_at_every_depth(target)
        assert obj_count > 0, f"Expected objects in {target.name}, found {obj_count}"
