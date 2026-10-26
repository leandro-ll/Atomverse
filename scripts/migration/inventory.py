"""Run the read-only migration inventories and emit one deterministic JSON document."""

from __future__ import annotations

import argparse
from pathlib import Path

from _inventory_common import emit_json
from compatibility_inventory import inventory_compatibility
from git_inventory import inventory_git
from hash_inventory import inventory_hashes
from local_asset_inventory import inventory_local_assets


def build_inventory(root: Path, section: str = "all") -> dict[str, object]:
    root = root.resolve()
    payload: dict[str, object] = {
        "inventoryVersion": 1,
        "kind": "atomverse-migration-baseline-input",
        "root": root.as_posix(),
    }
    if section in {"all", "git"}:
        payload["git"] = inventory_git(root)
    if section in {"all", "compatibility"}:
        payload["compatibility"] = inventory_compatibility(root)
    if section in {"all", "hashes"}:
        payload["hashes"] = inventory_hashes(root)
    if section in {"all", "local-assets"}:
        payload["localAssets"] = inventory_local_assets(root)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "section",
        choices=("all", "git", "compatibility", "hashes", "local-assets"),
        nargs="?",
        default="all",
    )
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--pretty", action="store_true")
    arguments = parser.parse_args()
    payload = build_inventory(arguments.root, arguments.section)
    emit_json(payload, pretty=arguments.pretty)
    compatibility = payload.get("compatibility")
    if isinstance(compatibility, dict) and not compatibility["validation"]["compatible"]:
        return 2
    local_assets = payload.get("localAssets")
    if isinstance(local_assets, dict) and not (
        local_assets["media"]["validation"]["valid"]
        and local_assets["localSensitivePaths"]["validation"]["valid"]
    ):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
