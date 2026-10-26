"""Inventory deferred media and sensitive local paths without exposing secrets."""

from __future__ import annotations

import argparse
from fnmatch import fnmatchcase
from pathlib import Path
import subprocess
from typing import Any, Iterable

from _inventory_common import (
    aggregate_digest,
    emit_json,
    readonly_git_environment,
    relative_posix,
    sha256_file,
)


EXPECTED_MEDIA_NAMES = (
    "Ai.mp3",
    "Problem part 1.mp3",
    "demo part 1.mp3",
    "demo part 2.mp3",
    "endign.mp3",
    "johnstone.mp3",
    "modul lingkungan.mp3",
    "problem part 2.mp3",
    "solution intro.mp3",
)


def _git_exit_code(repository: Path, arguments: list[str]) -> int:
    """Run a read-only Git path query while suppressing path/content output."""
    completed = subprocess.run(
        ["git", "--no-optional-locks", "-C", str(repository), *arguments],
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=readonly_git_environment(),
    )
    return completed.returncode


def _is_git_tracked(repository: Path, relative_path: str) -> bool:
    return _git_exit_code(repository, ["ls-files", "--error-unmatch", "--", relative_path]) == 0


def _is_git_ignored(repository: Path, relative_path: str) -> bool:
    return _git_exit_code(repository, ["check-ignore", "--no-index", "--quiet", "--", relative_path]) == 0


def _read_ignore_rules(path: Path) -> list[str]:
    """Read a non-secret ignore policy, retaining ordered effective rules."""
    if not path.is_file():
        return []
    rules: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#"):
            rules.append(line)
    return rules


def _rule_matches(relative_path: str, rule: str) -> bool:
    pattern = rule[1:] if rule.startswith("!") else rule
    pattern = pattern.lstrip("/").rstrip("/")
    if not pattern:
        return False
    path = relative_path.strip("/")
    if "/" in pattern:
        return fnmatchcase(path, pattern) or path.startswith(f"{pattern}/")
    return any(fnmatchcase(part, pattern) for part in path.split("/"))


def matching_ignore_rules(relative_path: str, rules: Iterable[str]) -> list[str]:
    """Return effective matching rules using ordered gitignore-style negation."""
    effective: list[str] = []
    excluded = False
    for rule in rules:
        if not _rule_matches(relative_path, rule):
            continue
        if rule.startswith("!"):
            excluded = False
            effective = []
        else:
            excluded = True
            effective.append(rule)
    return effective if excluded else []


def inventory_media(root: Path) -> dict[str, Any]:
    """Hash only the nine expected MP3 files and validate preservation policy."""
    root = root.resolve()
    assets = root / "assets"
    observed_paths = sorted(
        (
            path
            for path in assets.glob("*.mp3")
            if path.is_file() and not path.is_symlink()
        ),
        key=lambda path: relative_posix(path, root).casefold(),
    )
    deployment_rules = _read_ignore_rules(root / ".vercelignore")
    records: list[dict[str, Any]] = []
    for path in observed_paths:
        relative = relative_posix(path, root)
        matched_rules = matching_ignore_rules(relative, deployment_rules)
        records.append(
            {
                "path": relative,
                "sizeBytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "gitTracked": _is_git_tracked(root, relative),
                "deploymentExcluded": bool(matched_rules),
                "deploymentExclusionRules": matched_rules,
                "ownerClassification": "pending",
                "preservationPolicy": "preserve-byte-for-byte",
            }
        )

    observed_names = {path.name for path in observed_paths}
    expected_names = set(EXPECTED_MEDIA_NAMES)
    problems: list[str] = []
    missing = sorted(expected_names - observed_names, key=str.casefold)
    unexpected = sorted(observed_names - expected_names, key=str.casefold)
    if missing:
        problems.append(f"Berkas MP3 wajib tidak ditemukan: {missing}")
    if unexpected:
        problems.append(f"Berkas MP3 tambahan memerlukan keputusan pemilik: {unexpected}")
    if any(record["gitTracked"] for record in records):
        problems.append("Satu atau lebih MP3 telah terlacak Git sebelum persetujuan pemilik")
    if any(not record["deploymentExcluded"] for record in records):
        problems.append("Satu atau lebih MP3 tidak dikecualikan dari payload deployment")

    digest_records = [
        {"path": record["path"], "sizeBytes": record["sizeBytes"], "sha256": record["sha256"]}
        for record in records
    ]
    return {
        "inventoryVersion": 1,
        "kind": "deferred-mp3-inventory",
        "algorithm": "sha256",
        "expectedCount": 9,
        "fileCount": len(records),
        "aggregateSha256": aggregate_digest(digest_records),
        "files": records,
        "validation": {
            "valid": not problems,
            "exactExpectedSet": not missing and not unexpected,
            "allUntracked": all(not record["gitTracked"] for record in records),
            "allDeploymentExcluded": all(record["deploymentExcluded"] for record in records),
            "problems": problems,
        },
        "safety": {
            "mediaContentReadOnlyForHashing": True,
            "filesWrittenOrDeleted": False,
            "ownerApprovalRequiredBeforeReclassification": True,
        },
    }


def _sensitive_path_record(
    root: Path,
    path: Path,
    *,
    category: str,
    owner_repository: Path,
    deployment_rules: list[str],
) -> dict[str, Any]:
    relative = relative_posix(path, root)
    owner_relative = relative_posix(path, owner_repository)
    matched_rules = matching_ignore_rules(relative, deployment_rules)
    return {
        "path": relative,
        "category": category,
        "present": path.exists(),
        "pathKind": "directory" if path.is_dir() else "file",
        "gitTracked": _is_git_tracked(owner_repository, owner_relative),
        "gitIgnored": _is_git_ignored(owner_repository, owner_relative),
        "deploymentExcluded": bool(matched_rules),
        "deploymentExclusionRules": matched_rules,
        "contentInspected": False,
        "metadataRecorded": ["path", "category", "presence", "exclusion-status"],
    }


def inventory_local_sensitive_paths(root: Path) -> dict[str, Any]:
    """Record path/policy metadata for local secrets without opening their contents."""
    root = root.resolve()
    deployment_rules = _read_ignore_rules(root / ".vercelignore")
    paths: list[tuple[Path, str, Path]] = []
    paths.extend(
        (path, "local-environment", root)
        for path in sorted(root.glob(".env*"), key=lambda item: item.name.casefold())
        if path.is_file() and not path.is_symlink()
    )
    backend_env = root / "backend" / ".env"
    paths.append((backend_env, "backend-local-environment", root / "backend"))
    vercel_metadata = root / ".vercel"
    paths.append((vercel_metadata, "local-deployment-metadata", root))

    records = [
        _sensitive_path_record(
            root,
            path,
            category=category,
            owner_repository=owner_repository,
            deployment_rules=deployment_rules,
        )
        for path, category, owner_repository in paths
    ]
    problems: list[str] = []
    for record in records:
        if record["present"] and record["gitTracked"]:
            problems.append(f"Jalur lokal sensitif terlacak Git: {record['path']}")
        if record["present"] and not record["gitIgnored"]:
            problems.append(f"Jalur lokal sensitif tidak tercakup aturan Git ignore: {record['path']}")
        if record["present"] and not record["deploymentExcluded"]:
            problems.append(f"Jalur lokal sensitif tidak dikecualikan dari deployment: {record['path']}")

    return {
        "inventoryVersion": 1,
        "kind": "redacted-local-path-inventory",
        "redactionProfile": "path-and-exclusion-metadata-only",
        "paths": records,
        "validation": {
            "valid": not problems,
            "allPresentPathsUntracked": all(not item["present"] or not item["gitTracked"] for item in records),
            "allPresentPathsGitIgnored": all(not item["present"] or item["gitIgnored"] for item in records),
            "allPresentPathsDeploymentExcluded": all(
                not item["present"] or item["deploymentExcluded"] for item in records
            ),
            "problems": problems,
        },
        "safety": {
            "sensitiveFileContentsRead": False,
            "sensitiveHashesSizesAndTimestampsRecorded": False,
            "directoryContentsEnumerated": False,
            "filesWrittenOrDeleted": False,
        },
    }


def inventory_local_assets(root: Path) -> dict[str, Any]:
    return {
        "inventoryVersion": 1,
        "kind": "migration-local-assets",
        "media": inventory_media(root),
        "localSensitivePaths": inventory_local_sensitive_paths(root),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("section", choices=("all", "media", "local"), nargs="?", default="all")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--pretty", action="store_true")
    arguments = parser.parse_args()
    if arguments.section == "media":
        payload = inventory_media(arguments.root)
    elif arguments.section == "local":
        payload = inventory_local_sensitive_paths(arguments.root)
    else:
        payload = inventory_local_assets(arguments.root)
    emit_json(payload, pretty=arguments.pretty)
    if arguments.section == "all":
        valid = payload["media"]["validation"]["valid"] and payload["localSensitivePaths"]["validation"]["valid"]
    else:
        valid = payload["validation"]["valid"]
    return 0 if valid else 2


if __name__ == "__main__":
    raise SystemExit(main())
