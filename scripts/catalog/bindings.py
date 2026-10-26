"""Generate read-only JavaScript and Python bindings from the canonical chemistry catalog.

Task 5.4 implementation:
- js/generated/chemistry-catalog.js (frozen ESM data module)
- backend/app/generated/chemistry_catalog.py (frozen MappingProxyType)
- data only, no build toolchains or domain logic
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.catalog.emit import atomic_write


def generate_js_binding(catalog_str: str, digest: str) -> str:
    """Generate js/generated/chemistry-catalog.js content."""
    lines = [
        "/**",
        " * GENERATED FILE - DO NOT EDIT.",
        " *",
        " * Read-only frontend binding for the canonical chemistry catalog.",
        " */",
        "",
        "function deepFreeze(value) {",
        "  if (Array.isArray(value)) {",
        "    for (const item of value) deepFreeze(item);",
        "    return Object.freeze(value);",
        "  }",
        '  if (value !== null && typeof value === "object") {',
        "    for (const key of Object.keys(value)) deepFreeze(value[key]);",
        "    return Object.freeze(value);",
        "  }",
        "  return value;",
        "}",
        "",
        'export const CATALOG_SCHEMA_VERSION = "2.0.0";',
        'export const CATALOG_VERSION = "2.0.0";',
        f'export const CATALOG_DIGEST = "{digest}";',
        "",
        f"export const CATALOG = deepFreeze({catalog_str.strip()});",
        "",
    ]
    return "\n".join(lines)


def generate_py_binding(catalog_str: str, digest: str) -> str:
    """Generate backend/app/generated/chemistry_catalog.py content."""
    # To safely embed catalog_str inside a python string literal:
    json_literal = json.dumps(catalog_str)
    lines = [
        '"""GENERATED FILE - DO NOT EDIT.',
        "",
        "Read-only backend binding for the canonical chemistry catalog.",
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "import json",
        "from types import MappingProxyType",
        "from typing import Any",
        "",
        "__all__ = [",
        '    "CATALOG",',
        '    "CATALOG_DIGEST",',
        '    "CATALOG_SCHEMA_VERSION",',
        '    "CATALOG_VERSION",',
        "]",
        "",
        'CATALOG_SCHEMA_VERSION: str = "2.0.0"',
        'CATALOG_VERSION: str = "2.0.0"',
        f'CATALOG_DIGEST: str = "{digest}"',
        "",
        "",
        "def _freeze(value: Any) -> Any:",
        '    """Returns a deeply read-only view of parsed JSON data."""',
        "    if isinstance(value, dict):",
        "        return MappingProxyType({key: _freeze(item) for key, item in value.items()})",
        "    if isinstance(value, list):",
        "        return tuple(_freeze(item) for item in value)",
        "    return value",
        "",
        "",
        f"_RAW_JSON: str = {json_literal}",
        "",
        "CATALOG: MappingProxyType = _freeze(json.loads(_RAW_JSON))",
        "",
    ]
    return "\n".join(lines)


def emit_bindings(repo_root: Path) -> tuple[str, str]:
    """Read catalog and digest sidecar and emit both bindings atomically."""
    catalog_path = repo_root / "catalog" / "chemistry.catalog.json"
    digest_path = repo_root / "catalog" / "chemistry.catalog.digest.json"

    catalog_str = catalog_path.read_text(encoding="utf-8")
    digest_data = json.loads(digest_path.read_text(encoding="utf-8"))
    digest = digest_data["digest"]

    js_str = generate_js_binding(catalog_str, digest)
    py_str = generate_py_binding(catalog_str, digest)

    js_path = repo_root / "js" / "generated" / "chemistry-catalog.js"
    py_path = repo_root / "backend" / "app" / "generated" / "chemistry_catalog.py"

    atomic_write(js_path, js_str)
    atomic_write(py_path, py_str)

    return js_str, py_str


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    emit_bindings(repo_root)
    print("PASS: Both bindings emitted successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
