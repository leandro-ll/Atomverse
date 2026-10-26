"""Network isolation test for external reference validation.

TASK 13.4:
- Run catalog validation and reference cross-check with sockets strictly blocked.
- Assert zero attempted network requests during validation and generation.
- Assert that scripts/catalog/refresh_pubchem.py is completely absent from the CI job graph.

Validates: Requirements 11.2
"""

from __future__ import annotations

import json
from pathlib import Path
import socket
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

from scripts.catalog.check_drift import check_drift
from scripts.catalog.generate import cross_check, enumerate_substances
from scripts.catalog.validate_seed import validate_seed


class NetworkAccessAttempted(RuntimeError):
    """Raised whenever a blocked network socket operation is attempted."""


def test_validation_and_generation_with_sockets_blocked(monkeypatch):
    """Assert catalog validation and cross-check execute with sockets blocked and zero requests."""
    network_attempts = []

    def guarded_socket(*args, **kwargs):
        err = NetworkAccessAttempted("Network socket creation is strictly forbidden in test and CI environments")
        network_attempts.append(str(args))
        raise err

    def guarded_connect(*args, **kwargs):
        err = NetworkAccessAttempted("Network connect is strictly forbidden in test and CI environments")
        network_attempts.append(str(args))
        raise err

    def guarded_getaddrinfo(*args, **kwargs):
        err = NetworkAccessAttempted("DNS resolution is strictly forbidden in test and CI environments")
        network_attempts.append(str(args))
        raise err

    monkeypatch.setattr(socket, "socket", guarded_socket)
    monkeypatch.setattr(socket, "create_connection", guarded_connect)
    monkeypatch.setattr(socket, "getaddrinfo", guarded_getaddrinfo)

    # 1. Run seed validation, substance enumeration, and reference cross_check
    seed = validate_seed(REPO_ROOT / "catalog" / "seed")
    cache_path = REPO_ROOT / "tests" / "fixtures" / "chemistry" / "pubchem-cache.json"
    assert cache_path.exists(), "Cached fixture must exist for offline validation"

    substances = enumerate_substances(seed, cache=cache_path)
    assert len(substances) > 0

    verified = [s for s in substances if s.referenceValidation.get("status") == "verified"]
    unverified = [s for s in substances if s.referenceValidation.get("status") == "unverified"]

    assert len(verified) > 0
    assert len(unverified) > 0

    # 2. Run full check_drift (regenerates bundle and verifies 4-way parity)
    res = check_drift(REPO_ROOT)
    assert res["catalogSha256"] == res["sidecarDigest"]

    # Assert that zero network attempts were made
    assert len(network_attempts) == 0, f"Detected network attempts: {network_attempts}"


def test_refresh_script_absent_from_ci_job_graph():
    """Assert refresh_pubchem.py is excluded from test runner configs and CI manifests."""
    # 1. Check scripts/ci/test-suites.json
    suites_path = REPO_ROOT / "scripts" / "ci" / "test-suites.json"
    if suites_path.exists():
        suites_content = suites_path.read_text(encoding="utf-8")
        assert "refresh_pubchem" not in suites_content, (
            "refresh_pubchem must be excluded from scripts/ci/test-suites.json"
        )

    # 2. Check package.json scripts
    pkg_path = REPO_ROOT / "package.json"
    if pkg_path.exists():
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        scripts = pkg.get("scripts", {})
        for script_name, script_cmd in scripts.items():
            assert "refresh_pubchem" not in script_cmd, (
                f"refresh_pubchem found in package.json script '{script_name}': {script_cmd}"
            )

    # 3. Check pre-commit configuration if present
    precommit_path = REPO_ROOT / ".pre-commit-config.yaml"
    if precommit_path.exists():
        precommit_content = precommit_path.read_text(encoding="utf-8")
        assert "refresh_pubchem" not in precommit_content, (
            "refresh_pubchem must be excluded from .pre-commit-config.yaml"
        )
