"""Canonical emission pipeline for Atomverse chemistry catalog.

Task 5.1 & 5.2 implementation:
- sort_keys=True at every depth
- ensure_ascii=False
- indent=2
- separators=(",", ": ")
- UTF-8 with no BOM
- LF-only via newline="\n"
- exactly one trailing newline
- canonical_ksp regex validation and byte pass-through
- canonical_mass Decimal quantization to 6 dp
- atomic write in memory to temp file then replace
"""

from __future__ import annotations

import dataclasses
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from typing import Any, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import chempy

from scripts.catalog.generate import (
    DECLARED_EXCLUSIONS,
    MASS_DECIMALS,
    ReactionRecord,
    SubstanceRecord,
    canonical_mass,
    enumerate_reactions,
    enumerate_substances,
)
from scripts.catalog.validate_seed import SeedBundle, validate_seed

KSP_PATTERN = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$")


def canonical_ksp(raw: str) -> str:
    """Validate shape and pass through byte-for-byte. No float round-trip."""
    if not KSP_PATTERN.match(raw):
        raise ValueError(f"Malformed Ksp literal: {raw!r}")
    float(raw)  # parseability check only; result discarded
    return raw


def canonical_dumps(obj: Any) -> str:
    """Emit canonical JSON string with sorted keys, 2 spaces indent, LF trailing newline."""
    return json.dumps(
        obj,
        sort_keys=True,
        ensure_ascii=False,
        indent=2,
        separators=(",", ": "),
    ) + "\n"


def atomic_write(target_path: Path, content: str) -> None:
    """Write text atomically with UTF-8 encoding and LF newline."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_name(f"{target_path.name}.tmp.{os.getpid()}")
    with open(temp_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    os.replace(temp_path, target_path)


def serialize_substance(sub: SubstanceRecord) -> dict[str, Any]:
    """Serialize a SubstanceRecord to canonical dictionary."""
    d = dataclasses.asdict(sub)
    # Ensure composition keys are stringified
    d["composition"] = {str(k): v for k, v in sorted(d["composition"].items())}
    return d


def serialize_reaction(rxn: ReactionRecord) -> dict[str, Any]:
    """Serialize a ReactionRecord to canonical dictionary omitting None fields."""
    d = dataclasses.asdict(rxn)
    return {k: v for k, v in d.items() if v is not None}


def build_catalog_bundle(
    substances: Sequence[SubstanceRecord],
    reactions: Sequence[ReactionRecord],
    seed: SeedBundle,
    repo_root: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Assemble the catalog envelope, digest record, and coverage report in memory."""
    cations = [ion for ion in seed.ions if ion.kind == "cation"]
    anions = [ion for ion in seed.ions if ion.kind == "anion"]
    selectable = [s for s in substances if s.selectable]

    # Model definition
    model = {
        "neutralPh": 7.0,
        "nonGoals": [
            "gas_evolution",
            "redox_displacement",
            "weak_acid_base_equilibria",
            "runtime_database",
        ],
        "pKw": 14.0,
        "temperatureC": 25,
        "tolerances": {
            "charge": 1e-09,
            "element": 1e-09,
            "massPpm": 500,
        },
    }

    # Presentation
    presentation = {
        "explanations": dict(seed.presentation.explanations),
        "nomenclatureOverrides": sorted(
            [dataclasses.asdict(o) for o in seed.presentation.nomenclatureOverrides],
            key=lambda x: x["substanceId"],
        ),
        "reagentGroups": sorted(
            [dataclasses.asdict(g) for g in seed.presentation.reagentGroups],
            key=lambda x: x["order"],
        ),
        "substanceColors": dict(seed.presentation.substanceColors),
    }

    # Elements
    elements = {
        sym: {
            "indonesianName": el.indonesianName,
            "knownOxidationStates": list(el.knownOxidationStates),
        }
        for sym, el in sorted(seed.elements.items())
    }

    # Sources
    sources = {
        entry.source.id: {
            "citation": entry.source.citation,
            "id": entry.source.id,
        }
        for entry in seed.ksp.values()
    }

    # Ions
    ions_list = sorted([dataclasses.asdict(ion) for ion in seed.ions], key=lambda x: x["id"])

    # Solubility Rules
    rules_list = sorted([dataclasses.asdict(r) for r in seed.rules], key=lambda x: x["order"])

    # Substances
    substances_list = sorted([serialize_substance(s) for s in substances], key=lambda x: x["id"])

    # Reactions
    reactions_list = sorted([serialize_reaction(r) for r in reactions], key=lambda x: x["canonicalKey"])

    catalog_dict = {
        "catalogVersion": "2.0.0",
        "elements": elements,
        "generator": {
            "algorithmVersion": "1",
            "name": "scripts/catalog/generate.py",
        },
        "ions": ions_list,
        "model": model,
        "outcomeCategories": [
            "precipitate_forms",
            "below_saturation",
            "no_modeled_reaction",
            "neutralization",
            "unsupported",
        ],
        "presentation": presentation,
        "reactions": reactions_list,
        "schemaVersion": "2.0.0",
        "solubilityRules": rules_list,
        "sources": sources,
        "substances": substances_list,
        "toolkit": {
            "name": "chempy",
            "version": getattr(chempy, "__version__", "0.10.2"),
        },
    }

    # Compute digest
    catalog_bytes = canonical_dumps(catalog_dict).encode("utf-8")
    digest = hashlib.sha256(catalog_bytes).hexdigest()

    digest_dict = {
        "algorithm": "sha256",
        "bytes": len(catalog_bytes),
        "catalogVersion": "2.0.0",
        "digest": digest,
        "schemaVersion": "2.0.0",
    }

    # Coverage report
    coverage_dict = {
        "anionCount": len(anions),
        "canonicalPairCount": len(reactions),
        "cationCount": len(cations),
        "declaredExclusions": [
            {"reason": reason, "substanceId": sid}
            for sid, reason in sorted(DECLARED_EXCLUSIONS.items())
        ],
        "reactionRecordCount": len(reactions),
        "selectablePairCount": len(selectable) * (len(selectable) - 1) // 2,
        "selectableReagentBand": {"max": 55, "min": 40},
        "selectableReagentCount": len(selectable),
        "substanceCount": len(substances),
    }

    return catalog_dict, digest_dict, coverage_dict


def emit_all(repo_root: Path) -> dict[str, str]:
    """Generate and emit all catalog artifacts atomically."""
    seed_dir = repo_root / "catalog" / "seed"
    seed = validate_seed(seed_dir)
    substances = enumerate_substances(seed)
    reactions = enumerate_reactions(substances, seed)

    catalog_dict, digest_dict, coverage_dict = build_catalog_bundle(
        substances, reactions, seed, repo_root
    )

    catalog_str = canonical_dumps(catalog_dict)
    digest_str = canonical_dumps(digest_dict)
    coverage_str = canonical_dumps(coverage_dict)

    catalog_path = repo_root / "catalog" / "chemistry.catalog.json"
    digest_path = repo_root / "catalog" / "chemistry.catalog.digest.json"
    coverage_path = repo_root / "catalog" / "coverage-report.json"

    atomic_write(catalog_path, catalog_str)
    atomic_write(digest_path, digest_str)
    atomic_write(coverage_path, coverage_str)

    return {
        "catalog": catalog_str,
        "digest": digest_str,
        "coverage": coverage_str,
    }


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    result = emit_all(repo_root)
    digest_data = json.loads(result["digest"])
    cov_data = json.loads(result["coverage"])
    print(f"PASS: Catalog emitted successfully.")
    print(f"  - Catalog bytes: {digest_data['bytes']}, sha256: {digest_data['digest']}")
    print(f"  - Substances: {cov_data['substanceCount']}")
    print(f"  - Selectable reagents: {cov_data['selectableReagentCount']} (band: {cov_data['selectableReagentBand']})")
    print(f"  - Reaction records: {cov_data['reactionRecordCount']}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
