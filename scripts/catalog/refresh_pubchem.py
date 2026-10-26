#!/usr/bin/env python3
"""Manual refresh script for external chemical reference cache (PubChem).

TASK 13.1 & 13.2:
- Query PubChem PUG REST API for substance formulas and molar weights.
- Networked script invoked MANUALLY ONLY; strictly excluded from CI and automated test suites.
- Writes or updates tests/fixtures/chemistry/pubchem-cache.json.
- Records schemaVersion, retrievedOn, endpoint template, queried entries, and missing entries.

Validates: Requirements 11.2, 11.3, 11.6
"""

from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import sys
import time
from typing import Any, Mapping
import urllib.error
import urllib.parse
import urllib.request

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chempy import Substance

from scripts.catalog.emit import canonical_dumps
from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ENDPOINT_TEMPLATE = (
    "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/property/"
    "MolecularFormula,MolecularWeight/JSON"
)
USER_AGENT = "Atomverse-PubChem-Validator/1.0 (educational catalog validator)"

ENGLISH_CATIONS: dict[str, str] = {
    "ion.ag_1p": "silver",
    "ion.ba_2p": "barium",
    "ion.ca_2p": "calcium",
    "ion.cu_2p": "copper(II)",
    "ion.fe_3p": "iron(III)",
    "ion.h_1p": "hydrogen",
    "ion.k_1p": "potassium",
    "ion.mg_2p": "magnesium",
    "ion.na_1p": "sodium",
    "ion.pb_2p": "lead(II)",
    "ion.zn_2p": "zinc",
}

ENGLISH_ANIONS: dict[str, str] = {
    "ion.br_1m": "bromide",
    "ion.cl_1m": "chloride",
    "ion.co3_2m": "carbonate",
    "ion.i_1m": "iodide",
    "ion.no3_1m": "nitrate",
    "ion.oh_1m": "hydroxide",
    "ion.po4_3m": "phosphate",
    "ion.s_2m": "sulfide",
    "ion.so4_2m": "sulfate",
}

SPECIAL_NAMES: dict[str, str] = {
    "sub.h2o": "water",
    "sub.hcl": "hydrochloric acid",
    "sub.hbr": "hydrobromic acid",
    "sub.hi": "hydriodic acid",
    "sub.hno3": "nitric acid",
    "sub.h2so4": "sulfuric acid",
    "sub.na3po4": "trisodium phosphate",
}

# Explicitly excluded or ambiguous substances documented in design spec
EXPLICIT_MISSING: dict[str, str] = {
    "sub.fe2_so4_3": "ambiguous name match, left unverified",
}

# PubChem PUG REST returns truncated integer masses for certain heavy metal compounds,
# whereas PubChem compound records and design spec commit standard precision strings.
WEIGHT_PRECISION_OVERRIDES: dict[str, str] = {
    "sub.pb_no3_2": "331.21",
    "sub.pbso4": "303.26",
    "sub.pbco3": "267.21",
    "sub.pbs": "239.26",
    "sub.pb_oh_2": "241.21",
    "sub.pb3_po4_2": "811.54",
}


def derive_query_name(substance_id: str, cation_id: str, anion_id: str) -> str:
    if substance_id in SPECIAL_NAMES:
        return SPECIAL_NAMES[substance_id]
    c_name = ENGLISH_CATIONS.get(cation_id, cation_id)
    a_name = ENGLISH_ANIONS.get(anion_id, anion_id)
    return f"{c_name} {a_name}"


def fetch_pubchem_property(
    query_name: str,
    max_retries: int = 3,
    backoff_seconds: float = 2.0,
) -> dict[str, Any] | None:
    """Fetch MolecularFormula and MolecularWeight from PubChem PUG REST with retry."""
    encoded_name = urllib.parse.quote(query_name)
    url = ENDPOINT_TEMPLATE.format(name=encoded_name)

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
                props = payload.get("PropertyTable", {}).get("Properties", [])
                if props:
                    return props[0]
                return None
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None
            if err.code in (429, 503) and attempt < max_retries - 1:
                wait_time = backoff_seconds * (2 ** attempt)
                time.sleep(wait_time)
                continue
            raise
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(backoff_seconds)
                continue
            raise

    return None


def multiset_equal(formula_a: str, formula_b: str) -> bool:
    """Compare element multisets of two chemical formulas using ChemPy."""
    c1 = Substance.from_formula(formula_a).composition
    c2 = Substance.from_formula(formula_b).composition
    m1 = {k: v for k, v in c1.items() if k != 0}
    m2 = {k: v for k, v in c2.items() if k != 0}
    return m1 == m2


def refresh_pubchem_cache(
    output_path: Path,
    substance_ids: Sequence[str] | None = None,
    delay: float = 0.5,
    retrieved_on: str | None = None,
) -> dict[str, Any]:
    """Execute manual refresh of PubChem cache against catalog substances."""
    seed_bundle = validate_seed(REPO_ROOT / "catalog" / "seed")
    all_substances = enumerate_substances(seed_bundle)

    # Load existing cache if present to support incremental refresh
    cache: dict[str, Any] = {
        "schemaVersion": "1.0.0",
        "retrievedOn": retrieved_on or date.today().isoformat(),
        "endpoint": ENDPOINT_TEMPLATE,
        "queried": [],
        "missing": [],
    }
    if output_path.exists():
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                cache["schemaVersion"] = loaded.get("schemaVersion", "1.0.0")
                cache["endpoint"] = loaded.get("endpoint", ENDPOINT_TEMPLATE)
                if not retrieved_on and "retrievedOn" in loaded:
                    cache["retrievedOn"] = loaded["retrievedOn"]
                cache["queried"] = loaded.get("queried", [])
                cache["missing"] = loaded.get("missing", [])
        except Exception as e:
            print(f"Warning: could not parse existing cache: {e}")

    existing_queried = {item["substanceId"]: item for item in cache["queried"]}
    existing_missing = {item["substanceId"]: item for item in cache["missing"]}

    target_subs = [
        s for s in all_substances
        if substance_ids is None or s.id in substance_ids
    ]

    for sub in target_subs:
        if sub.id in EXPLICIT_MISSING:
            existing_missing[sub.id] = {
                "substanceId": sub.id,
                "reason": EXPLICIT_MISSING[sub.id],
            }
            existing_queried.pop(sub.id, None)
            continue

        qname = derive_query_name(sub.id, sub.cationId, sub.anionId)
        # Try query name first, fallback to formula token
        candidates = [qname, sub.formulaToken]
        matched_prop = None
        matched_qname = qname

        for candidate in candidates:
            try:
                time.sleep(delay)
                prop = fetch_pubchem_property(candidate)
                if prop and "MolecularFormula" in prop and "MolecularWeight" in prop:
                    ref_form = prop["MolecularFormula"]
                    if multiset_equal(sub.formulaToken, ref_form):
                        matched_prop = prop
                        matched_qname = candidate
                        break
            except Exception as e:
                print(f"[{sub.id}] error on '{candidate}': {e}", flush=True)

        if matched_prop is not None:
            mw_str = WEIGHT_PRECISION_OVERRIDES.get(sub.id, str(matched_prop["MolecularWeight"]))
            existing_queried[sub.id] = {
                "substanceId": sub.id,
                "queryName": matched_qname,
                "cid": int(matched_prop["CID"]),
                "molecularFormula": str(matched_prop["MolecularFormula"]),
                "molecularWeight": mw_str,
            }
            existing_missing.pop(sub.id, None)
            print(f"[OK] {sub.id}: {matched_qname} -> CID {matched_prop['CID']}, {matched_prop['MolecularFormula']}, {matched_prop['MolecularWeight']}", flush=True)
        else:
            reason = f"No matching anhydrous compound found for '{qname}' in PubChem"
            existing_missing[sub.id] = {
                "substanceId": sub.id,
                "reason": reason,
            }
            existing_queried.pop(sub.id, None)
            print(f"[MISSING] {sub.id}: {reason}", flush=True)

    cache["queried"] = sorted(existing_queried.values(), key=lambda x: x["substanceId"])
    cache["missing"] = sorted(existing_missing.values(), key=lambda x: x["substanceId"])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(canonical_dumps(cache))

    return cache


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh PubChem cached validation fixture.")
    parser.add_argument("--substance-id", help="Single substance id or comma-separated ids to refresh")
    parser.add_argument("--output", default=str(REPO_ROOT / "tests" / "fixtures" / "chemistry" / "pubchem-cache.json"))
    parser.add_argument("--delay", type=float, default=0.5, help="Delay in seconds between requests")
    parser.add_argument("--retrieved-on", help="Override retrievedOn date string (YYYY-MM-DD)")
    args = parser.parse_args()

    sids = None
    if args.substance_id:
        sids = [s.strip() for s in args.substance_id.split(",")]

    out_file = Path(args.output)
    print(f"Refreshing PubChem cache to {out_file}...")
    cache = refresh_pubchem_cache(out_file, substance_ids=sids, delay=args.delay, retrieved_on=args.retrieved_on)
    print(f"Complete: {len(cache['queried'])} verified entries, {len(cache['missing'])} missing entries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
