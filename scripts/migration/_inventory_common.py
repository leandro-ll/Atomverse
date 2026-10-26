"""Shared helpers for read-only migration inventory commands."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Iterable


SENSITIVE_PARTS = {".git", ".vercel"}
SENSITIVE_NAMES = {".env", "backend/.env"}


def relative_posix(path: Path, root: Path) -> str:
    """Return a stable, forward-slash path relative to root."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix() or "."
    except ValueError:
        return path.resolve().as_posix()


def is_sensitive_path(path: Path, root: Path) -> bool:
    """Reject paths that can contain credentials or local repository metadata."""
    relative = relative_posix(path, root)
    parts = [part.lower() for part in Path(relative).parts]
    if any(part in SENSITIVE_PARTS or part == "__pycache__" for part in parts):
        return True
    if any(part == ".env" or part.startswith(".env.") for part in parts):
        return True
    return relative.lower() in SENSITIVE_NAMES


def sha256_file(path: Path) -> str:
    """Hash a regular file without loading it all into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def aggregate_digest(records: Iterable[dict[str, Any]]) -> str:
    """Create a deterministic digest over normalized inventory records."""
    digest = hashlib.sha256()
    for record in records:
        encoded = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest.update(encoded.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def emit_json(payload: Any, *, pretty: bool = False) -> None:
    """Write an inventory payload to stdout; inventory commands have no output-file mode."""
    print(
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2 if pretty else None,
            sort_keys=True,
            separators=None if pretty else (",", ":"),
        )
    )


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def readonly_git_environment() -> dict[str, str]:
    """Prevent read-only Git queries from refreshing or locking repository indexes."""
    environment = os.environ.copy()
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    environment["GIT_TERMINAL_PROMPT"] = "0"
    return environment
