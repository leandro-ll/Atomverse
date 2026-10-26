"""Catalog-drawn test generators for chemistry property tests.

Validates: Requirements 12.3, 12.4
- arb_selectable_reagent
- arb_reagent_pair
- arb_ksp_pair
- arb_concentration (ranges straddling ~0.0515 M threshold)
- arb_volume
- arb_input
- Smoke assertion that selectable count equals coverage-report.json's selectableReagentCount (52)
- Coverage assertion that both saturation branches are observed in a sample.
"""

from __future__ import annotations

import json
from pathlib import Path
import random
from typing import Any

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment

ROOT = Path(__file__).resolve().parents[2]
COVERAGE_REPORT_PATH = ROOT / "catalog" / "coverage-report.json"

SELECTABLE_REAGENTS = [s for s in CATALOG["substances"] if s.get("selectable")]
SELECTABLE_MAP = {s["id"]: s for s in SELECTABLE_REAGENTS}

KSP_REACTIONS = [r for r in CATALOG["reactions"] if r.get("kspRef") and "candidateSolidId" in r]
KSP_REACTION_PAIRS = [r["reactantIds"] for r in KSP_REACTIONS]

PBCL2_THRESHOLD_M = 0.051426  # ~0.0515 M


def get_expected_selectable_count() -> int:
    """Reads expected selectable reagent count from catalog coverage report."""
    if COVERAGE_REPORT_PATH.exists():
        data = json.loads(COVERAGE_REPORT_PATH.read_text(encoding="utf-8"))
        return int(data.get("selectableReagentCount", 52))
    return 52


def assert_selectable_count_smoke() -> None:
    """Smoke assertion: selectable reagent count must equal coverage report."""
    expected = get_expected_selectable_count()
    actual = len(SELECTABLE_REAGENTS)
    assert actual == expected, (
        f"Selectable reagent count mismatch: catalog has {actual}, coverage-report declares {expected}"
    )


def arb_selectable_reagent(rng: random.Random) -> dict[str, Any]:
    """Generates one selectable reagent record."""
    return rng.choice(SELECTABLE_REAGENTS)


def arb_reagent_pair(rng: random.Random) -> tuple[dict[str, Any], dict[str, Any]]:
    """Generates a pair of distinct selectable reagents."""
    s1, s2 = rng.sample(SELECTABLE_REAGENTS, 2)
    return s1, s2


def arb_ksp_pair(rng: random.Random) -> tuple[str, str]:
    """Generates a reagent ID pair whose reaction has a cited Ksp."""
    pair = rng.choice(KSP_REACTION_PAIRS)
    return str(pair[0]), str(pair[1])


def arb_concentration(rng: random.Random, mode: str | None = None) -> float:
    """Generates concentration in M straddling the ~0.0515 M PbCl2 threshold.

    Modes:
    - 'dilute': 0.001 M to 0.045 M (below threshold)
    - 'concentrated': 0.055 M to 2.0 M (above threshold)
    - None: uniform across 0.001 M to 2.0 M
    """
    if mode == "dilute":
        return rng.uniform(0.001, 0.045)
    elif mode == "concentrated":
        return rng.uniform(0.055, 2.0)
    else:
        # Straddling distribution: 50% chance around threshold, 50% broad
        if rng.random() < 0.5:
            return rng.uniform(0.001, 0.1)
        return rng.uniform(0.1, 2.0)


def arb_volume(rng: random.Random) -> float:
    """Generates reagent volume in mL between 10.0 and 100.0."""
    return round(rng.uniform(10.0, 100.0), 1)


def arb_input(rng: random.Random, ksp_only: bool = False, mode: str | None = None) -> dict[str, Any]:
    """Generates a valid experiment input dict."""
    if ksp_only:
        id_a, id_b = arb_ksp_pair(rng)
    else:
        s_a, s_b = arb_reagent_pair(rng)
        id_a, id_b = s_a["id"], s_b["id"]

    return {
        "reagentAId": id_a,
        "reagentBId": id_b,
        "concentrationA_M": arb_concentration(rng, mode=mode),
        "concentrationB_M": arb_concentration(rng, mode=mode),
        "volumeA_mL": arb_volume(rng),
        "volumeB_mL": arb_volume(rng),
    }


def assert_saturation_branches_observed(rng: random.Random, sample_size: int = 50) -> None:
    """Coverage assertion: both precipitate_forms and below_saturation must be observed."""
    outcomes: set[str] = set()
    for i in range(sample_size):
        mode = "concentrated" if i % 2 == 0 else "dilute"
        inp = arb_input(rng, ksp_only=True, mode=mode)
        res = evaluate_experiment(CATALOG, inp)
        outcomes.add(res["outcome"])

    assert "precipitate_forms" in outcomes, "Expected precipitate_forms in sample"
    assert "below_saturation" in outcomes, "Expected below_saturation in sample"
