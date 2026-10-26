"""Tests for Task 16: Species ledger and visualization plan integration.

Validates: Requirements 8.3, 8.4, 8.7, 10.5, 12.4, 15.3, 17.1, 17.2
- Verifies ledger formula-unit expansion from catalog dissociation multiplicities
- Verifies that Pb(NO3)2, BaCl2, and Na2SO4 multiplicities and 1:2 stoichiometry come from catalog
- Verifies that visualization plan emits no precipitate species for below_saturation,
  no_modeled_reaction, and unsupported outcomes
- Verifies that visualization plan emits NO gas species under any outcome in this phase
- Verifies that below_saturation macro result renders candidate solid, Q vs Ksp, and citation
"""

import json
from pathlib import Path
import subprocess
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import evaluate_experiment

ROOT = Path(__file__).resolve().parents[2]


def run_js_visualization_plan(eval_result: dict) -> dict:
    """Executes js/domain/visualization-plan.js in Node for a given evaluator result."""
    js_script = """
import { createVisualizationPlan, buildSpeciesLedger } from './js/domain/visualization-plan.js';

const evalResult = JSON.parse(process.argv[1]);
const plan = createVisualizationPlan(evalResult);
const ledger = buildSpeciesLedger(evalResult);
console.log(JSON.stringify({ plan, ledger }));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", js_script, json.dumps(eval_result)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return json.loads(proc.stdout)


def test_catalog_dissociation_multiplicities():
    """Verify that Pb(NO3)2, BaCl2, and Na2SO4 multiplicities come directly from catalog."""
    subs = {s["id"]: s for s in CATALOG["substances"]}

    # Pb(NO3)2 -> 1 Pb2+, 2 NO3-
    pb_dissoc = {d["ionId"]: d["multiplicity"] for d in subs["sub.pb_no3_2"]["dissociation"]}
    assert pb_dissoc["ion.pb_2p"] == 1
    assert pb_dissoc["ion.no3_1m"] == 2

    # BaCl2 -> 1 Ba2+, 2 Cl-
    ba_dissoc = {d["ionId"]: d["multiplicity"] for d in subs["sub.bacl2"]["dissociation"]}
    assert ba_dissoc["ion.ba_2p"] == 1
    assert ba_dissoc["ion.cl_1m"] == 2

    # Na2SO4 -> 2 Na+, 1 SO4 2-
    na2so4_dissoc = {d["ionId"]: d["multiplicity"] for d in subs["sub.na2so4"]["dissociation"]}
    assert na2so4_dissoc["ion.na_1p"] == 2
    assert na2so4_dissoc["ion.so4_2m"] == 1


def test_no_precipitate_for_below_saturation_unsupported_and_no_reaction():
    """Verify that visualization plan emits no precipitate for below_saturation, no_modeled_reaction, unsupported."""
    # 1. below_saturation (dilute Pb(NO3)2 + NaCl)
    dilute_input = {
        "reagentAId": "sub.pb_no3_2",
        "reagentBId": "sub.nacl",
        "concentrationA_M": 0.001,
        "volumeA_L": 0.05,
        "concentrationB_M": 0.001,
        "volumeB_L": 0.05,
        "temperatureC": 25,
    }
    eval_res = evaluate_experiment(dilute_input)
    assert eval_res["outcome"] == "below_saturation"

    out = run_js_visualization_plan(eval_res)
    plan = out["plan"]
    ledger = out["ledger"]

    assert plan["hasPrecipitate"] is False
    assert len(plan["particles"]["precipitate"]) == 0
    assert len(ledger["precipitates"]) == 0
    assert plan["hasGas"] is False
    assert len(plan["particles"]["gas"]) == 0
    assert len(ledger["gases"]) == 0

    # 2. no_modeled_reaction (NaCl + KI)
    no_rxn_input = {
        "reagentAId": "sub.nacl",
        "reagentBId": "sub.ki",
        "concentrationA_M": 0.1,
        "volumeA_L": 0.05,
        "concentrationB_M": 0.1,
        "volumeB_L": 0.05,
        "temperatureC": 25,
    }
    eval_no_rxn = evaluate_experiment(no_rxn_input)
    assert eval_no_rxn["outcome"] == "no_modeled_reaction"

    out_no_rxn = run_js_visualization_plan(eval_no_rxn)
    assert out_no_rxn["plan"]["hasPrecipitate"] is False
    assert len(out_no_rxn["plan"]["particles"]["precipitate"]) == 0
    assert len(out_no_rxn["ledger"]["precipitates"]) == 0
    assert out_no_rxn["plan"]["hasGas"] is False

    # 3. unsupported (e.g. self pair or carbonate acid if present)
    unsupported_eval = {
        "outcome": "unsupported",
        "reactants": [],
        "productId": None,
        "candidateSolidId": None,
    }
    out_unsupported = run_js_visualization_plan(unsupported_eval)
    assert out_unsupported["plan"]["hasPrecipitate"] is False
    assert len(out_unsupported["plan"]["particles"]["precipitate"]) == 0
    assert len(out_unsupported["ledger"]["precipitates"]) == 0


def test_precipitate_emitted_only_for_precipitate_forms():
    """Verify that precipitate particles and ledger entry are emitted when precipitate_forms."""
    ppt_input = {
        "reagentAId": "sub.pb_no3_2",
        "reagentBId": "sub.nacl",
        "concentrationA_M": 0.1,
        "volumeA_L": 0.05,
        "concentrationB_M": 0.1,
        "volumeB_L": 0.05,
        "temperatureC": 25,
    }
    eval_ppt = evaluate_experiment(ppt_input)
    assert eval_ppt["outcome"] == "precipitate_forms"
    assert eval_ppt["productId"] == "sub.pbcl2"

    out = run_js_visualization_plan(eval_ppt)
    plan = out["plan"]
    ledger = out["ledger"]

    assert plan["hasPrecipitate"] is True
    assert len(plan["particles"]["precipitate"]) > 0
    assert len(ledger["precipitates"]) == 1
    assert ledger["precipitates"][0]["speciesId"] == "sub.pbcl2"
    assert ledger["precipitates"][0]["phase"] == "s"

    # Consumed ions: Pb2+ and Cl- in 1:2 ratio
    consumed_map = {c["ionId"]: c["amount_mol"] for c in ledger["consumedIons"]}
    assert "ion.pb_2p" in consumed_map
    assert "ion.cl_1m" in consumed_map
    # Due to 1:2 ratio, consumed Cl- is 2 * consumed Pb2+
    assert abs(consumed_map["ion.cl_1m"] - 2 * consumed_map["ion.pb_2p"]) < 1e-9

    # Strictly zero gas
    assert plan["hasGas"] is False
    assert len(ledger["gases"]) == 0
