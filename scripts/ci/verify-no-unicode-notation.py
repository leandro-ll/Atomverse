#!/usr/bin/env python3
"""Static analysis check ensuring js/ and backend/app/ never contain hand-typed Unicode subscript, superscript, or arrow characters.

Display notation is never hand-typed. Every formula, ion label, and equation is
assembled from notation.unicode (or notation.latex) recorded at generation time.
No file under js/ (excluding js/generated/) or backend/app/ (excluding
backend/app/generated/) may contain characters in the forbidden Unicode ranges.

Forbidden ranges:
- Unicode subscript: U+2080-U+2089
- Unicode superscript: U+00B2, U+00B3, U+2070-U+207F
- Unicode arrow: U+2192

Validates: Requirements 7.4, 7.5
"""

from __future__ import annotations

from pathlib import Path
import re
import sys

FORBIDDEN_PATTERN = re.compile(r"[\u2080-\u2089\u00b2\u00b3\u2070-\u207f\u2192]")

SCAN_ROOTS = [
    ("js", "js/generated"),
    ("backend/app", "backend/app/generated"),
]


def verify_no_unicode_notation(repo_root: Path) -> list[str]:
    violations: list[str] = []

    for scan_rel, exclude_rel in SCAN_ROOTS:
        scan_dir = repo_root / scan_rel
        if not scan_dir.exists():
            continue

        for path in sorted(scan_dir.rglob("*")):
            if not path.is_file():
                continue

            rel_str = path.relative_to(repo_root).as_posix()
            if rel_str.startswith(exclude_rel):
                continue

            # Only scan text-like source files (js, ts, py, json, css, html)
            if path.suffix.lower() not in {".js", ".mjs", ".cjs", ".ts", ".py", ".html", ".css", ".json"}:
                continue

            try:
                content = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError) as e:
                violations.append(f"{rel_str}: unable to read file ({e})")
                continue

            for lineno, line in enumerate(content.splitlines(), start=1):
                matches = FORBIDDEN_PATTERN.findall(line)
                if matches:
                    unique_chars = sorted(set(matches))
                    violations.append(
                        f"{rel_str}:{lineno}: contains forbidden Unicode characters {unique_chars}: {line.strip()}"
                    )

    return violations


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    violations = verify_no_unicode_notation(repo_root)

    if violations:
        print("FAIL: Forbidden hand-typed Unicode notation detected:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        return 1

    print("PASS: No hand-typed Unicode notation detected in js/ or backend/app/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
