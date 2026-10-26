#!/usr/bin/env python3
"""Static analysis check ensuring backend/app/ modules never import build-time chemistry toolchains or catalog generator scripts.

Validates: Requirements 3.2, 3.3, 3.4
"""

from __future__ import annotations

import ast
from pathlib import Path
import sys

FORBIDDEN_APP_IMPORTS = ("chempy", "scripts.catalog", "sympy", "scipy")


def verify_import_graph(app_dir: Path) -> list[str]:
    violations: list[str] = []
    if not app_dir.exists():
        return violations

    for py_file in sorted(app_dir.rglob("*.py")):
        content = py_file.read_text(encoding="utf-8")
        try:
            tree = ast.parse(content, filename=str(py_file))
        except SyntaxError as e:
            violations.append(f"{py_file}: syntax error {e}")
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    for forbidden in FORBIDDEN_APP_IMPORTS:
                        if alias.name == forbidden or alias.name.startswith(f"{forbidden}."):
                            violations.append(
                                f"{py_file.name}:{node.lineno} imports forbidden build toolchain '{alias.name}'"
                            )
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    for forbidden in FORBIDDEN_APP_IMPORTS:
                        if node.module == forbidden or node.module.startswith(f"{forbidden}."):
                            violations.append(
                                f"{py_file.name}:{node.lineno} imports from forbidden build toolchain '{node.module}'"
                            )
    return violations


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    app_dir = repo_root / "backend" / "app"

    violations = verify_import_graph(app_dir)
    if violations:
        print("FAIL: Forbidden build toolchain imports detected in backend/app:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        return 1

    print(f"PASS: Import graph verified clean ({app_dir.as_posix()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
