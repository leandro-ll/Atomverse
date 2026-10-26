"""Safety and compatibility tests for the read-only migration inventory tools."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_SCRIPTS = ROOT / "scripts" / "migration"
sys.path.insert(0, str(MIGRATION_SCRIPTS))

from compatibility_inventory import inventory_compatibility  # noqa: E402
from git_inventory import inventory_git  # noqa: E402
from hash_inventory import inventory_hashes  # noqa: E402
from local_asset_inventory import (  # noqa: E402
    EXPECTED_MEDIA_NAMES,
    inventory_local_sensitive_paths,
    inventory_media,
)


def run(command: list[str], cwd: Path) -> str:
    environment = os.environ.copy()
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    completed = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
        timeout=20,
    )
    return completed.stdout


def git(cwd: Path, *arguments: str) -> str:
    return run(["git", "--no-optional-locks", *arguments], cwd).rstrip("\n")


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def tree_snapshot(root: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink():
            snapshot[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return snapshot


def repository_status(repo: Path) -> str:
    return git(repo, "status", "--porcelain=v2", "--branch", "--no-ahead-behind", "--untracked-files=all")


class GitInventoryTests(unittest.TestCase):
    def _initialize_repository(self, path: Path, tracked_name: str) -> None:
        path.mkdir(parents=True, exist_ok=True)
        git(path, "init", "--initial-branch=main")
        git(path, "config", "user.name", "Inventory Test")
        git(path, "config", "user.email", "inventory@example.invalid")
        git(path, "config", "commit.gpgsign", "false")
        write(path / tracked_name, "committed\n")
        git(path, "add", tracked_name)
        git(path, "commit", "-m", "fixture")

    def test_dirty_root_and_nested_repository_are_reported_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._initialize_repository(root, "root.txt")
            nested = root / "backend"
            self._initialize_repository(nested, "nested.txt")

            write(root / "root.txt", "dirty root\n")
            write(root / "untracked.txt", "untracked root\n")
            write(nested / "nested.txt", "dirty nested\n")
            write(nested / "nested-untracked.txt", "untracked nested\n")

            before_tree = tree_snapshot(root)
            before_statuses = (repository_status(root), repository_status(nested))
            before_indexes = (
                hashlib.sha256((root / ".git" / "index").read_bytes()).hexdigest(),
                hashlib.sha256((nested / ".git" / "index").read_bytes()).hexdigest(),
            )

            result = inventory_git(root)

            self.assertEqual(2, result["repositoryCount"])
            self.assertEqual(["backend"], result["nestedRepositories"])
            self.assertTrue(result["overlappingOwnershipDetected"])
            self.assertTrue(all(repo["dirty"] for repo in result["repositories"]))
            self.assertEqual(before_tree, tree_snapshot(root))
            self.assertEqual(before_statuses, (repository_status(root), repository_status(nested)))
            self.assertEqual(
                before_indexes,
                (
                    hashlib.sha256((root / ".git" / "index").read_bytes()).hexdigest(),
                    hashlib.sha256((nested / ".git" / "index").read_bytes()).hexdigest(),
                ),
            )


class CompatibilityInventoryTests(unittest.TestCase):
    def test_current_approved_api_and_dom_contract_is_captured(self) -> None:
        before = tree_snapshot(ROOT / "backend") | {"index.html": hashlib.sha256((ROOT / "index.html").read_bytes()).hexdigest()}

        result = inventory_compatibility(ROOT)

        self.assertTrue(result["validation"]["compatible"], result["validation"]["problems"])
        self.assertEqual(
            {("GET", "/api/health"), ("POST", "/api/chat"), ("POST", "/api/inverse-experiment")},
            {(route["method"], route["path"]) for route in result["api"]["routes"]},
        )
        self.assertEqual(["lab", "inverse", "env"], [tab["dataTab"] for tab in result["dom"]["moduleTabs"]])
        self.assertGreaterEqual(len(result["dom"]["inlineHandlers"]), 2)
        after = tree_snapshot(ROOT / "backend") | {"index.html": hashlib.sha256((ROOT / "index.html").read_bytes()).hexdigest()}
        self.assertEqual(before, after)


class HashInventoryTests(unittest.TestCase):
    def test_hash_inventory_is_deterministic_and_does_not_rewrite_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write(root / "app.js", "const answer = 42;\n")
            write(root / "backend" / "main.py", "print('safe')\n")
            write(root / "assets" / "audio.mp3", "not real media")
            write(root / ".env.local", "SECRET=must-not-be-read\n")
            before = tree_snapshot(root)

            first = inventory_hashes(root)
            second = inventory_hashes(root)

            self.assertEqual(first, second)
            self.assertEqual(["app.js", "backend/main.py"], [item["path"] for item in first["files"]])
            self.assertEqual(before, tree_snapshot(root))

    def test_explicit_sensitive_paths_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            secret = root / "backend" / ".env"
            write(secret, "TOKEN=not-for-inventory\n")
            with self.assertRaisesRegex(ValueError, "Jalur sensitif ditolak"):
                inventory_hashes(root, [secret])


class LocalAssetInventoryTests(unittest.TestCase):
    def _initialize_fixture(self, root: Path) -> None:
        git(root, "init", "--initial-branch=main")
        write(root / ".gitignore", ".env*\n.vercel\nbackend/.env\n")
        write(root / ".vercelignore", ".env*\n.vercel\nbackend\nbackend/.env\nassets/*.mp3\n")
        backend = root / "backend"
        backend.mkdir()
        git(backend, "init", "--initial-branch=main")
        write(backend / ".gitignore", ".env\n")
        write(root / ".env.local", "SECRET=must-not-be-read\n")
        write(backend / ".env", "TOKEN=must-not-be-read\n")
        write(root / ".vercel" / "project.json", '{"token":"must-not-be-read"}\n')
        for index, name in enumerate(EXPECTED_MEDIA_NAMES):
            write(root / "assets" / name, f"fixture-media-{index}\n")

    def test_media_inventory_hashes_exact_set_and_preserves_untracked_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._initialize_fixture(root)
            before = tree_snapshot(root)

            first = inventory_media(root)
            second = inventory_media(root)

            self.assertEqual(first, second)
            self.assertTrue(first["validation"]["valid"], first["validation"]["problems"])
            self.assertEqual(9, first["fileCount"])
            self.assertEqual(
                set(EXPECTED_MEDIA_NAMES),
                {Path(record["path"]).name for record in first["files"]},
            )
            self.assertTrue(all(not record["gitTracked"] for record in first["files"]))
            self.assertTrue(all(record["deploymentExcluded"] for record in first["files"]))
            self.assertEqual(before, tree_snapshot(root))

    def test_sensitive_inventory_is_content_independent_and_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._initialize_fixture(root)
            before = tree_snapshot(root)

            first = inventory_local_sensitive_paths(root)
            write(root / ".env.local", "SECRET=a-completely-different-value\n")
            write(root / "backend" / ".env", "TOKEN=another-value\n")
            second = inventory_local_sensitive_paths(root)

            self.assertEqual(first, second)
            self.assertTrue(first["validation"]["valid"], first["validation"]["problems"])
            serialized = json.dumps(first, sort_keys=True)
            for prohibited in ("must-not-be-read", "completely-different", "another-value", "token"):
                self.assertNotIn(prohibited, serialized.lower())
            self.assertTrue(all(not record["contentInspected"] for record in first["paths"]))
            after = tree_snapshot(root)
            for relative, digest in before.items():
                if relative not in {".env.local", "backend/.env"}:
                    self.assertEqual(digest, after[relative])

    def test_committed_redacted_manifests_match_current_workspace(self) -> None:
        media_manifest = json.loads((ROOT / "docs" / "migration" / "media-inventory.json").read_text(encoding="utf-8"))
        local_manifest = json.loads((ROOT / "docs" / "migration" / "local-exclusions.json").read_text(encoding="utf-8"))

        self.assertEqual(inventory_media(ROOT), media_manifest)
        self.assertEqual(inventory_local_sensitive_paths(ROOT), local_manifest)


class InventoryCliTests(unittest.TestCase):
    def test_git_cli_emits_json_without_changing_current_worktrees_or_media(self) -> None:
        protected_paths = [ROOT / "css" / "style.css", ROOT / "index.html", ROOT / "js" / "main.js"]
        protected_paths.extend(sorted((ROOT / "assets").glob("*.mp3")))
        before_hashes = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in protected_paths}
        before_statuses = (repository_status(ROOT), repository_status(ROOT / "backend"))

        output = run(
            [sys.executable, str(MIGRATION_SCRIPTS / "inventory.py"), "git", "--root", str(ROOT)],
            ROOT,
        )
        payload = json.loads(output)

        self.assertEqual("git-topology-status", payload["git"]["kind"])
        self.assertIn("backend", payload["git"]["nestedRepositories"])
        self.assertEqual(before_statuses, (repository_status(ROOT), repository_status(ROOT / "backend")))
        after_hashes = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in protected_paths}
        self.assertEqual(before_hashes, after_hashes)


if __name__ == "__main__":
    unittest.main()
