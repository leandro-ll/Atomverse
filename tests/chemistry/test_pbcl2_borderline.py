"""Example tests pinning the PbCl2 borderline case and threshold.

Validates: Requirements 9.3, 9.4
- Pb(NO3)2 + NaCl at 0.1 M / 50 mL defaults yields 'precipitate_forms' with
  Q ≈ 1.25e-4 and Q/Ksp ≈ 7.35 against cited 1.7e-5.
- Same pair at 0.002 M / 50 mL yields 'below_saturation' with Q ≈ 1.0e-9.
- Derives and validates the equal-volume threshold ~0.0515 M ((c/2)^3 = 1.7e-5).
"""

from __future__ import annotations

import math
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment


def test_pbcl2_default_quantities_precipitate():
    """Pb(NO3)2 + NaCl at default quantities (0.1 M, 50 mL each) forms precipitate."""
    inp = {
        "reagentAId": "sub.pb_no3_2",
        "reagentBId": "sub.nacl",
        "concentrationA_M": 0.1,
        "concentrationB_M": 0.1,
        "volumeA_mL": 50.0,
        "volumeB_mL": 50.0,
    }
    res = evaluate_experiment(CATALOG, inp)

    assert res["outcome"] == "precipitate_forms"
    assert res["productId"] == "sub.pbcl2"
    assert res["candidateSolidId"] == "sub.pbcl2"

    sat = res["saturation"]
    assert sat is not None
    assert sat["ksp"] == 1.7e-5
    assert sat["ksp_literal"] == "1.7e-5"
    assert sat["Q"] == pytest.approx(1.25e-4, rel=1e-3)
    assert sat["ratio"] == pytest.approx(7.3529, rel=1e-2)


def test_pbcl2_dilute_quantities_below_saturation():
    """Pb(NO3)2 + NaCl at dilute quantities (0.002 M, 50 mL each) is below saturation."""
    inp = {
        "reagentAId": "sub.pb_no3_2",
        "reagentBId": "sub.nacl",
        "concentrationA_M": 0.002,
        "concentrationB_M": 0.002,
        "volumeA_mL": 50.0,
        "volumeB_mL": 50.0,
    }
    res = evaluate_experiment(CATALOG, inp)

    assert res["outcome"] == "below_saturation"
    assert res["productId"] is None
    assert res["candidateSolidId"] == "sub.pbcl2"

    sat = res["saturation"]
    assert sat is not None
    assert sat["ksp"] == 1.7e-5
    assert sat["Q"] == pytest.approx(1.0e-9, rel=1e-3)
    assert sat["ratio"] == pytest.approx(1.0e-9 / 1.7e-5, rel=1e-3)
    assert res["explanation"] is not None
    assert "1.7e-5" in res["explanation"]


def test_pbcl2_threshold_boundary():
    """Equal-volume threshold is derived as c_thresh = 2 * (1.7e-5)^(1/3) ≈ 0.051426 M ≈ 0.0515 M."""
    ksp = 1.7e-5
    # (c / 2)^3 = Ksp -> c = 2 * Ksp^(1/3)
    c_thresh = 2.0 * math.pow(ksp, 1.0 / 3.0)
    assert c_thresh == pytest.approx(0.051426, rel=1e-3)

    # Just above threshold -> precipitate
    c_above = c_thresh * 1.01
    res_above = evaluate_experiment(CATALOG, {
        "reagentAId": "sub.pb_no3_2",
        "reagentBId": "sub.nacl",
        "concentrationA_M": c_above,
        "concentrationB_M": c_above,
        "volumeA_mL": 50.0,
        "volumeB_mL": 50.0,
    })
    assert res_above["outcome"] == "precipitate_forms"
    assert res_above["saturation"]["Q"] > ksp

    # Just below threshold -> below saturation
    c_below = c_thresh * 0.99
    res_below = evaluate_experiment(CATALOG, {
        "reagentAId": "sub.pb_no3_2",
        "reagentBId": "sub.nacl",
        "concentrationA_M": c_below,
        "concentrationB_M": c_below,
        "volumeA_mL": 50.0,
        "volumeB_mL": 50.0,
    })
    assert res_below["outcome"] == "below_saturation"
    assert res_below["saturation"]["Q"] < ksp
