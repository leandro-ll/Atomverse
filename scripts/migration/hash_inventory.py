"""Generate deterministic hashes for non-secret source and configuration files."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Iterable

from _inventory_common import (
    aggregate_digest,
    emit_json,
    is_sensitive_path,
    relative_posix,
    sha256_file,
)


_INCLUDED_SUFFIXES = {
    ".css", ".html", ".js", ".json", ".md", ".py", ".toml", ".txt", ".yaml", ".yml"
}
_INCLUDED_NAMES = {".gitignore", ".vercelignore", "Procfile", "requirements.txt"}
_PRUNED_DIRECTORIES = {
    ".git", ".vercel", "__pycache__", "node_modules", ".venv", "venv", "semantic-review"
}
_EXCLUDED_SUFFIXES = {".pyc", ".mp3", ".wav", ".ogg", ".mp4"}


def iter_default_source_files(root: Path) -> Iterable[Path]:
    root = root.resolve()
    for current, directory_names, file_names in os.walk(root, topdown=True):
        directory_names[:] = sorted(
            name for name in directory_names if name not in _PRUNED_DIRECTORIES
        )
        current_path = Path(current)
        for name in sorted(file_names):
            path = current_path / name
            if path.is_symlink() or not path.is_file() or is_sensitive_path(path, root):
                continue
            if path.suffix.lower() in _EXCLUDED_SUFFIXES:
                continue
            if path.suffix.lower() in _INCLUDED_SUFFIXES or name in _INCLUDED_NAMES:
                yield path


def _validated_explicit_files(root: Path, paths: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for supplied in paths:
        candidate = supplied if supplied.is_absolute() else root / supplied
        candidate = candidate.resolve()
        if is_sensitive_path(candidate, root):
            raise ValueError(f"Jalur sensitif ditolak dari inventaris hash: {relative_posix(candidate, root)}")
        if not candidate.is_file() or candidate.is_symlink():
            raise ValueError(f"Hanya berkas reguler yang dapat diinventaris: {supplied}")
        files.append(candidate)
    return files


def inventory_hashes(root: Path, paths: Iterable[Path] | None = None) -> dict[str, object]:
    root = root.resolve()
    selected = (
        _validated_explicit_files(root, paths)
        if paths is not None
        else list(iter_default_source_files(root))
    )
    records = [
        {
            "path": relative_posix(path, root),
            "sizeBytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in sorted(set(selected), key=lambda item: relative_posix(item, root).casefold())
    ]
    return {
        "inventoryVersion": 1,
        "kind": "source-file-hashes",
        "root": root.as_posix(),
        "algorithm": "sha256",
        "fileCount": len(records),
        "aggregateSha256": aggregate_digest(records),
        "files": records,
        "exclusions": {
            "sensitivePaths": [".env*", "backend/.env", ".git", ".vercel"],
            "generatedOrLocal": ["__pycache__", "*.pyc", "node_modules", "semantic-review"],
            "mediaDeferredToTask1.2": ["*.mp3", "*.wav", "*.ogg", "*.mp4"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--path", type=Path, action="append", dest="paths")
    parser.add_argument("--pretty", action="store_true")
    arguments = parser.parse_args()
    emit_json(inventory_hashes(arguments.root, arguments.paths), pretty=arguments.pretty)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
