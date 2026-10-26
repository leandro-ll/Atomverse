"""Regeneration drift check and four-way digest parity assertion.

Task 5.5 implementation:
- Regenerates catalog, digest sidecar, both bindings, and coverage report into a temp directory.
- Byte-compares against committed artifacts.
- Reports first differing byte offset and unified diff if drift occurs.
- Asserts four-way digest parity across:
  1. chemistry.catalog.json bytes sha256
  2. chemistry.catalog.digest.json digest field
  3. js/generated/chemistry-catalog.js CATALOG_DIGEST
  4. backend/app/generated/chemistry_catalog.py CATALOG_DIGEST
"""

from __future__ import annotations

import difflib
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
from typing import Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.catalog.bindings import generate_js_binding, generate_py_binding
from scripts.catalog.emit import (
    atomic_write,
    build_catalog_bundle,
    canonical_dumps,
)
from scripts.catalog.generate import enumerate_reactions, enumerate_substances
from scripts.catalog.validate_seed import validate_seed


class DriftError(Exception):
    """Raised when committed generated artifacts drift from fresh generation."""


def find_first_difference(committed: bytes, fresh: bytes) -> tuple[int, str]:
    """Return the first differing byte offset and a unified diff snippet."""
    min_len = min(len(committed), len(fresh))
    diff_offset = min_len
    for i in range(min_len):
        if committed[i] != fresh[i]:
            diff_offset = i
            break

    c_text = committed.decode("utf-8", errors="replace").splitlines(keepends=True)
    f_text = fresh.decode("utf-8", errors="replace").splitlines(keepends=True)
    diff = "".join(
        difflib.unified_diff(
            c_text,
            f_text,
            fromfile="committed",
            tofile="fresh",
            n=3,
        )
    )
    return diff_offset, diff


def check_drift(repo_root: Path) -> dict[str, str]:
    """Perform regeneration into temp dir, byte comparison, and four-way digest check."""
    seed_dir = repo_root / "catalog" / "seed"
    seed = validate_seed(seed_dir)
    substances = enumerate_substances(seed)
    reactions = enumerate_reactions(substances, seed)

    catalog_dict, digest_dict, coverage_dict = build_catalog_bundle(
        substances, reactions, seed, repo_root
    )

    catalog_bytes = canonical_dumps(catalog_dict).encode("utf-8")
    digest_bytes = canonical_dumps(digest_dict).encode("utf-8")
    coverage_bytes = canonical_dumps(coverage_dict).encode("utf-8")

    digest_str = digest_dict["digest"]
    js_binding_bytes = generate_js_binding(catalog_bytes.decode("utf-8"), digest_str).encode("utf-8")
    py_binding_bytes = generate_py_binding(catalog_bytes.decode("utf-8"), digest_str).encode("utf-8")

    artifacts_to_check = [
        ("catalog/chemistry.catalog.json", catalog_bytes),
        ("catalog/chemistry.catalog.digest.json", digest_bytes),
        ("catalog/coverage-report.json", coverage_bytes),
        ("js/generated/chemistry-catalog.js", js_binding_bytes),
        ("backend/app/generated/chemistry_catalog.py", py_binding_bytes),
    ]

    for rel_path, fresh_bytes in artifacts_to_check:
        committed_file = repo_root / rel_path
        if not committed_file.exists():
            raise DriftError(f"Missing committed artifact: {rel_path}")

        committed_bytes = committed_file.read_bytes()
        if committed_bytes != fresh_bytes:
            offset, diff = find_first_difference(committed_bytes, fresh_bytes)
            raise DriftError(
                f"Drift detected in {rel_path} at byte offset {offset} "
                f"(committed {len(committed_bytes)} bytes vs fresh {len(fresh_bytes)} bytes):\n{diff}"
            )

    # Four-way digest parity assertion
    catalog_sha256 = hashlib.sha256(catalog_bytes).hexdigest()
    sidecar_digest = digest_dict["digest"]

    # Extract JS binding digest
    js_text = (repo_root / "js" / "generated" / "chemistry-catalog.js").read_text(encoding="utf-8")
    m_js = re.search(r'export const CATALOG_DIGEST = "([a-f0-9]{64})";', js_text)
    if not m_js:
        raise DriftError("Could not extract CATALOG_DIGEST from js/generated/chemistry-catalog.js")
    js_digest = m_js.group(1)

    # Extract Python binding digest
    py_text = (repo_root / "backend" / "app" / "generated" / "chemistry_catalog.py").read_text(encoding="utf-8")
    m_py = re.search(r'CATALOG_DIGEST: str = "([a-f0-9]{64})"', py_text)
    if not m_py:
        raise DriftError("Could not extract CATALOG_DIGEST from backend/app/generated/chemistry_catalog.py")
    py_digest = m_py.group(1)

    if not (catalog_sha256 == sidecar_digest == js_digest == py_digest):
        raise DriftError(
            f"Four-way digest parity failed:\n"
            f"  - catalog bytes sha256: {catalog_sha256}\n"
            f"  - sidecar digest:       {sidecar_digest}\n"
            f"  - JS binding digest:    {js_digest}\n"
            f"  - Python binding digest: {py_digest}"
        )

    return {
        "catalogSha256": catalog_sha256,
        "sidecarDigest": sidecar_digest,
        "jsDigest": js_digest,
        "pyDigest": py_digest,
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    try:
        res = check_drift(repo_root)
        print("PASS: No drift detected and four-way digest parity verified.")
        print(f"  - Verified digest: {res['catalogSha256']}")
        return 0
    except DriftError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
