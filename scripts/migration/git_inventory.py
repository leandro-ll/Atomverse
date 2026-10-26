"""Inventory root and nested Git worktrees using read-only Git commands only."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from typing import Any, Sequence

from _inventory_common import emit_json, readonly_git_environment, relative_posix


_PRUNED_DIRECTORIES = {".git", ".vercel", "__pycache__", "node_modules", ".venv", "venv"}
_ALLOWED_GIT_COMMANDS = {
    "rev-parse",
    "status",
    "symbolic-ref",
    "remote",
}


def _run_git(repo: Path, arguments: Sequence[str]) -> str:
    if not arguments or arguments[0] not in _ALLOWED_GIT_COMMANDS:
        raise ValueError(f"Perintah Git tidak diizinkan untuk inventaris: {arguments!r}")
    completed = subprocess.run(
        ["git", "--no-optional-locks", "-C", str(repo), *arguments],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=readonly_git_environment(),
    )
    return completed.stdout.rstrip("\n")


def discover_git_worktrees(root: Path) -> list[Path]:
    """Find Git worktree roots without traversing repository metadata."""
    root = root.resolve()
    repositories: set[Path] = set()
    for current, directory_names, file_names in __import__("os").walk(root, topdown=True):
        current_path = Path(current)
        if ".git" in directory_names or ".git" in file_names:
            repositories.add(current_path.resolve())
        directory_names[:] = sorted(
            name for name in directory_names if name not in _PRUNED_DIRECTORIES
        )
    return sorted(repositories, key=lambda path: (len(path.parts), path.as_posix().casefold()))


def _inspect_worktree(repo: Path, root: Path) -> dict[str, Any]:
    status_lines = _run_git(
        repo,
        ["status", "--porcelain=v2", "--branch", "--no-ahead-behind", "--untracked-files=all"],
    ).splitlines()
    head = _run_git(repo, ["rev-parse", "--verify", "HEAD"])
    branch = _run_git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    remote_names = sorted(filter(None, _run_git(repo, ["remote"]).splitlines()))
    git_marker = repo / ".git"
    return {
        "path": relative_posix(repo, root),
        "worktree": relative_posix(Path(_run_git(repo, ["rev-parse", "--show-toplevel"])), root),
        "gitMarkerKind": "directory" if git_marker.is_dir() else "file",
        "head": head,
        "branch": branch or None,
        "remoteNames": remote_names,
        "statusPorcelainV2": status_lines,
        "dirty": any(not line.startswith("# ") for line in status_lines),
    }


def inventory_git(root: Path) -> dict[str, Any]:
    root = root.resolve()
    repositories = discover_git_worktrees(root)
    inspected = [_inspect_worktree(repo, root) for repo in repositories]
    root_repositories = [item for item in inspected if item["path"] == "."]
    nested = [item["path"] for item in inspected if item["path"] != "."]
    return {
        "inventoryVersion": 1,
        "kind": "git-topology-status",
        "root": root.as_posix(),
        "repositoryCount": len(inspected),
        "rootRepositoryCount": len(root_repositories),
        "nestedRepositories": nested,
        "overlappingOwnershipDetected": bool(root_repositories and nested),
        "repositories": inspected,
        "safety": {
            "gitOptionalLocks": False,
            "commands": sorted(_ALLOWED_GIT_COMMANDS),
            "mutatingCommandsPermitted": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--pretty", action="store_true")
    arguments = parser.parse_args()
    emit_json(inventory_git(arguments.root), pretty=arguments.pretty)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
