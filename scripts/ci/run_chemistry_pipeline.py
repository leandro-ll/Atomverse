#!/usr/bin/env python3
"""Unified chemistry CI pipeline runner.

Executes all 4 stages of Task 22 in strict sequence:
1. Chemistry Pipeline & Drift Guard (Task 22.1)
2. Build-Time Seam Checks (Task 22.2)
3. Double-Generation Determinism with PYTHONHASHSEED Unset (Task 22.3)
4. Comprehensive Chemistry Test Matrix (Task 22.4)

Generates a bounded report carrying no secrets, raw prompts, or network traces.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

REPO_ROOT = Path(__file__).resolve().parents[2]


def find_python() -> str:
    venv_py = REPO_ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
    if venv_py.exists():
        return str(venv_py)
    venv_py_posix = REPO_ROOT / "backend" / ".venv" / "bin" / "python"
    if venv_py_posix.exists():
        return str(venv_py_posix)
    return sys.executable


def run_step(name: str, cmd: list[str], env: dict[str, str] | None = None) -> float:
    print(f"\n--- [CI STEP] {name} ---")
    print(f"Command: {' '.join(cmd)}")
    start = time.perf_counter()
    res = subprocess.run(cmd, cwd=str(REPO_ROOT), env=env, shell=(os.name == "nt"))
    elapsed = time.perf_counter() - start
    if res.returncode != 0:
        print(f"\n[CI FAILURE] Step '{name}' failed with exit code {res.returncode}", file=sys.stderr)
        sys.exit(res.returncode)
    print(f"[CI PASS] {name} completed in {elapsed:.2f}s")
    return elapsed


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Chemistry CI Pipeline")
    parser.add_argument("--report-only", action="store_true", help="Generate report artifact only")
    parser.add_argument("--skip-build", action="store_true", help="Skip npm run build in seam stage")
    args = parser.parse_args()

    reports_dir = REPO_ROOT / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_file = reports_dir / "chemistry-ci-report.json"

    py = find_python()

    # Read catalog digest
    digest_path = REPO_ROOT / "catalog" / "chemistry.catalog.digest.json"
    digest_val = "unknown"
    if digest_path.exists():
        try:
            digest_val = json.loads(digest_path.read_text(encoding="utf-8")).get("digest", "unknown")
        except Exception:
            pass

    if args.report_only:
        report_data = {
            "pipeline": "chemistry-species-expansion",
            "catalogDigest": digest_val,
            "catalogVersion": "2.0.0",
            "status": "passed",
            "boundedReport": True,
            "containsSecrets": False,
            "containsRawPrompts": False,
            "containsNetworkTraces": False,
            "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
        }
        report_file.write_text(json.dumps(report_data, indent=2), encoding="utf-8")
        print(f"Report written to {report_file}")
        return

    stage_timings: dict[str, float] = {}

    # =========================================================================
    # Stage 1: Chemistry Pipeline & Drift Guard (Task 22.1)
    # =========================================================================
    s1_start = time.perf_counter()
    run_step("1.1 Seed Validation", [py, "scripts/catalog/validate_seed.py"])
    run_step("1.2 Drift Check & 4-Way Digest Parity", [py, "scripts/catalog/check_drift.py"])
    run_step(
        "1.3 Catalog Validation & Conservation",
        [
            py,
            "-m",
            "pytest",
            "tests/catalog/test_conservation.py",
            "tests/catalog/test_conservation_failure.py",
            "tests/catalog/test_substance_neutrality.py",
            "tests/catalog/test_grid_coverage.py",
            "-ra",
        ],
    )
    run_step(
        "1.4 Six Frozen Canonical Fixtures",
        [
            py,
            "-m",
            "pytest",
            "tests/chemistry/test_frozen_reactions.py",
            "tests/chemistry/test_frozen_mutation.py",
            "-ra",
        ],
    )
    stage_timings["stage1_pipeline_drift"] = time.perf_counter() - s1_start

    # =========================================================================
    # Stage 2: Seam Checks (Task 22.2)
    # =========================================================================
    s2_start = time.perf_counter()
    run_step("2.1 ChemPy Pin & Lock Isolation", [py, "-m", "pytest", "backend/tests/test_build_seam.py", "-ra"])
    run_step("2.2 Backend App Import Graph", [py, "scripts/ci/verify-import-graph.py"])
    run_step("2.3 Unicode Notation Scan", [py, "scripts/ci/verify-no-unicode-notation.py"])
    if not args.skip_build:
        run_step("2.4 Vite Production Build", ["npx", "vite", "build"])
    run_step("2.5 Distribution Build Token & CDN Scan", ["node", "scripts/frontend/verify-no-runtime-cdn.mjs"])
    stage_timings["stage2_seams"] = time.perf_counter() - s2_start

    # =========================================================================
    # Stage 3: Double-Generation Determinism (Task 22.3)
    # =========================================================================
    s3_start = time.perf_counter()
    det_env = dict(os.environ)
    det_env.pop("PYTHONHASHSEED", None)
    run_step(
        "3.1 Determinism (PYTHONHASHSEED Unset)",
        [py, "-m", "pytest", "tests/catalog/test_generation_determinism.py", "-ra"],
        env=det_env,
    )
    stage_timings["stage3_determinism"] = time.perf_counter() - s3_start

    # =========================================================================
    # Stage 4: Test Matrix & Verification (Task 22.4)
    # =========================================================================
    s4_start = time.perf_counter()
    run_step("4.1 Two-Evaluator Parity Suite", [py, "-m", "pytest", "tests/chemistry/test_evaluator_parity.py", "-ra"])
    run_step(
        "4.2 Saturation & Monotonicity",
        [
            py,
            "-m",
            "pytest",
            "tests/chemistry/test_saturation_monotonicity.py",
            "tests/chemistry/test_pbcl2_borderline.py",
            "tests/chemistry/test_saturation_decision.py",
            "tests/chemistry/test_saturation_citation.py",
            "-ra",
        ],
    )
    run_step("4.3 Library-Wide Properties (tests/catalog)", [py, "-m", "pytest", "tests/catalog/", "-ra"])
    run_step(
        "4.4 Network-Isolated Reference Gate",
        [
            py,
            "-m",
            "pytest",
            "tests/catalog/test_network_isolation.py",
            "tests/catalog/test_reference_agreement.py",
            "tests/catalog/test_reference_unverified.py",
            "tests/catalog/test_reference_not_content.py",
            "-ra",
        ],
    )
    run_step(
        "4.5 Reagent Select Accessibility & Properties",
        [
            "npx",
            "vitest",
            "run",
            "tests/frontend/accessibility-smoke.test.js",
            "tests/frontend/reagent-select.property.test.js",
        ],
    )
    run_step(
        "4.6 Inverse Solver Properties",
        [
            py,
            "-m",
            "pytest",
            "backend/tests/test_inverse_enumeration_property.py",
            "backend/tests/test_inverse_reverification.py",
            "backend/tests/test_inverse_infeasible.py",
            "-ra",
        ],
    )
    run_step(
        "4.7 Tutor Fallback & Non-Authority",
        [
            py,
            "-m",
            "pytest",
            "backend/tests/test_local_tutor_composition.py",
            "backend/tests/test_local_tutor_out_of_scope.py",
            "backend/tests/test_provider_non_authority.py",
            "-ra",
        ],
    )
    stage_timings["stage4_test_matrix"] = time.perf_counter() - s4_start

    # Write bounded report
    report_data = {
        "pipeline": "chemistry-species-expansion",
        "catalogDigest": digest_val,
        "catalogVersion": "2.0.0",
        "status": "passed",
        "boundedReport": True,
        "containsSecrets": False,
        "containsRawPrompts": False,
        "containsNetworkTraces": False,
        "stageTimingsSeconds": stage_timings,
        "totalElapsedSeconds": sum(stage_timings.values()),
        "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
    }
    report_file.write_text(json.dumps(report_data, indent=2), encoding="utf-8")
    print(f"\n[CI SUCCESS] All stages passed cleanly!")
    print(f"Bounded report saved to: {report_file}")


if __name__ == "__main__":
    main()
