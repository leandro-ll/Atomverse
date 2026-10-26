#!/usr/bin/env python3
"""Build-time chemistry catalog generator.

Expands the reviewed chemistry seed into the canonical chemistry catalog artifact.
Handles charge-neutral formula derivation, ChemPy toolkit resolution,
ordered solubility classification, and compositional Indonesian nomenclature.

Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 5.3, 5.5, 7.1, 7.2, 7.3, 7.6, 10.4, 10.5
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from decimal import Decimal
import json
import math
from pathlib import Path
import re
import sys
from typing import Any, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chempy import Substance

from scripts.catalog.validate_seed import (
    PresentationSeed,
    SeedBundle,
    SeedIon,
    SolubilityRule,
    validate_seed,
)

MASS_DECIMALS = 6
ROMAN_NUMERALS = {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V"}
DECLARED_EXCLUSIONS = {
    "sub.h2co3": "weak_acid_outside_model",
    "sub.h2s": "weak_acid_outside_model",
    "sub.h3po4": "weak_acid_outside_model",
}


def derive_subscripts(z_cation: int, z_anion: int) -> tuple[int, int]:
    """Given positive cation charge and negative anion charge, return smallest charge-neutral counts via gcd."""
    if z_cation <= 0:
        raise ValueError(f"cation charge must be positive, got {z_cation}")
    if z_anion >= 0:
        raise ValueError(f"anion charge must be negative, got {z_anion}")

    a = abs(z_cation)
    b = abs(z_anion)
    g = math.gcd(a, b)
    n_cat = b // g
    n_an = a // g

    assert n_cat * z_cation + n_an * z_anion == 0, f"Subscripts not neutral: {n_cat}*{z_cation} + {n_an}*{z_anion} != 0"
    return n_cat, n_an


def strip_charge_suffix(formula_token: str) -> str:
    """Strip trailing charge like '+', '+2', '-', '-2' from formulaToken."""
    return re.sub(r"[+-]\d*$", "", formula_token)


def build_formula_token(
    cation_token: str,
    cation_polyatomic: bool,
    n_cat: int,
    anion_token: str,
    anion_polyatomic: bool,
    n_an: int,
) -> str:
    """Assemble charge-neutral formula token, parenthesizing polyatomic groups only when subscript > 1."""
    cat_core = strip_charge_suffix(cation_token)
    an_core = strip_charge_suffix(anion_token)

    # Special case H+ with OH- to H2O
    if cat_core == "H" and an_core == "OH" and n_cat == 1 and n_an == 1:
        return "H2O"

    def format_part(core: str, poly: bool, count: int) -> str:
        if count == 1:
            return core
        if poly:
            return f"({core}){count}"
        return f"{core}{count}"

    return format_part(cat_core, cation_polyatomic, n_cat) + format_part(an_core, anion_polyatomic, n_an)


def substance_id_from_token(token: str) -> str:
    """Generate canonical substance identifier slug from formula token."""
    slug = re.sub(r"\(([^)]+)\)", r"_\1_", token).lower()
    slug = re.sub(r"_+", "_", slug).strip("_")
    return f"sub.{slug}"


def canonical_mass(value: float) -> float:
    """Quantize molar mass to 6 decimal places."""
    return float(Decimal(str(round(value, MASS_DECIMALS))).quantize(Decimal("0.000001")))


@dataclass(frozen=True)
class SolubilityVerdict:
    solubilityClass: str
    ruleId: str | None
    viaException: bool


def matches_rule(match: Mapping[str, Any], cation: SeedIon, anion: SeedIon) -> bool:
    if match.get("fallback"):
        return True
    if "cationId" in match and cation.id != match["cationId"]:
        return False
    if "cationIdIn" in match and cation.id not in match["cationIdIn"]:
        return False
    if "anionId" in match and anion.id != match["anionId"]:
        return False
    if "anionIdIn" in match and anion.id not in match["anionIdIn"]:
        return False
    if match.get("acidBaseRoleAny"):
        return bool(cation.acidBaseRole or anion.acidBaseRole)
    return True


def classify_solubility(
    substance_id: str,
    cation: SeedIon,
    anion: SeedIon,
    rules: Sequence[SolubilityRule],
    default_class: str = "insoluble",
) -> SolubilityVerdict:
    """Classify substance solubility with ascending order, first-match-wins, and in-rule exceptions."""
    for rule in rules:
        if not matches_rule(rule.match, cation, anion):
            continue
        for exc in rule.exceptions:
            if exc.substanceId == substance_id:
                return SolubilityVerdict(solubilityClass=exc.solubilityClass, ruleId=rule.id, viaException=True)
        return SolubilityVerdict(solubilityClass=rule.solubilityClass, ruleId=rule.id, viaException=False)

    return SolubilityVerdict(solubilityClass=default_class, ruleId=None, viaException=False)


def classify_presentation_group(
    cation: SeedIon,
    anion: SeedIon,
    presentation: PresentationSeed,
) -> str:
    """Find matching presentation group id from presentation.reagentGroups."""
    for group in presentation.reagentGroups:
        if matches_rule(group.match, cation, anion):
            return group.id
    return "grp.other"


def substance_name(
    substance_id: str,
    cation: SeedIon,
    anion: SeedIon,
    elements: Mapping[str, Any],
    overrides: Mapping[str, str],
) -> tuple[str, str]:
    """Compute Indonesian substance name and provenance (override or compositional)."""
    if substance_id in overrides:
        return overrides[substance_id], "override"

    cat_element = elements.get(cation.element or "")
    if cat_element and len(cat_element.knownOxidationStates) > 1:
        roman = ROMAN_NUMERALS.get(cation.charge, str(cation.charge))
        name = f"{cation.nameFragment}({roman}) {anion.nameFragment}"
    else:
        name = f"{cation.nameFragment} {anion.nameFragment}"

    return name, "compositional"


@dataclass(frozen=True)
class SubstanceRecord:
    id: str
    formulaToken: str
    cationId: str
    anionId: str
    cationCount: int
    anionCount: int
    composition: dict[str, int]
    netCharge: int
    molarMassGPerMol: float
    notation: dict[str, str]
    indonesianName: str
    nameProvenance: str
    solubilityClass: str
    solubilityRuleId: str | None
    selectable: bool
    presentationGroupId: str
    displayColor: str
    dissociation: list[dict[str, Any]]
    ksp: dict[str, Any] | None = None
    referenceValidation: dict[str, Any] | None = None


def enumerate_substances(
    seed: SeedBundle,
    cache: Mapping[str, Any] | Path | str | bool | None = None,
) -> list[SubstanceRecord]:
    """Stage 2-4: enumerate charge-neutral substances across cation/anion grid."""
    cations = [ion for ion in seed.ions if ion.kind == "cation"]
    anions = [ion for ion in seed.ions if ion.kind == "anion"]

    overrides = {ov.substanceId: ov.name for ov in seed.presentation.nomenclatureOverrides}
    substances: list[SubstanceRecord] = []
    seen_names: dict[str, str] = {}  # normalized name -> substance_id

    for cation in sorted(cations, key=lambda c: c.id):
        for anion in sorted(anions, key=lambda a: a.id):
            n_cat, n_an = derive_subscripts(cation.charge, anion.charge)
            token = build_formula_token(
                cation.formulaToken,
                cation.polyatomic,
                n_cat,
                anion.formulaToken,
                anion.polyatomic,
                n_an,
            )
            sid = substance_id_from_token(token)

            if sid in DECLARED_EXCLUSIONS:
                continue

            try:
                sub = Substance.from_formula(token)
            except Exception as e:
                raise ValueError(f"Unparsable formula token '{token}' for {cation.id}+{anion.id}: {e}") from e

            net_charge = sub.composition.get(0, 0)
            if net_charge != 0:
                raise ValueError(f"Formula '{token}' is not charge-neutral: net charge {net_charge}")

            verdict = classify_solubility(sid, cation, anion, seed.rules)
            selectable = (
                (verdict.solubilityClass == "soluble")
                and cation.aqueousSupported
                and anion.aqueousSupported
                and sid != "sub.h2o"
            )

            name, name_prov = substance_name(sid, cation, anion, seed.elements, overrides)
            norm_name = " ".join(name.strip().lower().split())

            if norm_name in seen_names:
                colliding_id = seen_names[norm_name]
                raise ValueError(f"Substance name collision on '{name}': {sid} and {colliding_id}")
            seen_names[norm_name] = sid

            group_id = classify_presentation_group(cation, anion, seed.presentation)
            display_color = seed.presentation.substanceColors.get(sid, cation.displayColor)

            ksp_data = None
            if sid in seed.ksp:
                ksp_entry = seed.ksp[sid]
                ksp_data = {
                    "value": ksp_entry.value,
                    "temperatureC": ksp_entry.temperatureC,
                    "sourceId": ksp_entry.source.id,
                }

            substances.append(SubstanceRecord(
                id=sid,
                formulaToken=token,
                cationId=cation.id,
                anionId=anion.id,
                cationCount=n_cat,
                anionCount=n_an,
                composition={str(k): v for k, v in sorted(sub.composition.items()) if k != 0},
                netCharge=0,
                molarMassGPerMol=canonical_mass(sub.mass),
                notation={
                    "unicode": sub.unicode_name,
                    "latex": sub.latex_name,
                    "html": sub.html_name,
                },
                indonesianName=name,
                nameProvenance=name_prov,
                solubilityClass=verdict.solubilityClass,
                solubilityRuleId=verdict.ruleId,
                selectable=selectable,
                presentationGroupId=group_id,
                displayColor=display_color,
                dissociation=[
                    {"ionId": cation.id, "multiplicity": n_cat, "charge": cation.charge},
                    {"ionId": anion.id, "multiplicity": n_an, "charge": anion.charge},
                ],
                ksp=ksp_data,
                referenceValidation={
                    "status": "unverified",
                    "source": "pubchem",
                    "cid": None,
                    "referenceFormula": None,
                    "referenceMassGPerMol": None,
                    "massDeltaPpm": None,
                },
            ))

    sorted_substances = sorted(substances, key=lambda s: s.id)

    # Stage 10: cached reference cross-check
    if cache is not False:
        cache_target = cache
        if cache_target is None:
            default_cache = REPO_ROOT / "tests" / "fixtures" / "chemistry" / "pubchem-cache.json"
            if default_cache.exists():
                cache_target = default_cache
        if cache_target is not None:
            sorted_substances = cross_check(sorted_substances, cache_target)

    return sorted_substances


def formulas_equivalent(our_formula: str, ref_formula: str) -> bool:
    """Compare element multisets of two chemical formulas using ChemPy."""
    c1 = Substance.from_formula(our_formula).composition
    c2 = Substance.from_formula(ref_formula).composition
    m1 = {k: v for k, v in c1.items() if k != 0}
    m2 = {k: v for k, v in c2.items() if k != 0}
    return m1 == m2


def cross_check(
    substances: Sequence[SubstanceRecord],
    cache: Mapping[str, Any] | Path | str | None,
    tol_ppm: float = 500.0,
) -> list[SubstanceRecord]:
    """Stage 10: cached reference cross-check.

    Compares element multisets rather than literal formula strings.
    Enforces declared mass tolerance (default 500 ppm).
    Sets sub.referenceValidation to verified or unverified.
    Raises ValueError identifying the substance id and both values on mismatch.
    Import no reference names and no reference solubility data into the catalog.
    """
    if cache is None:
        return list(substances)

    if isinstance(cache, (str, Path)):
        cache_path = Path(cache)
        if not cache_path.exists():
            return list(substances)
        with open(cache_path, "r", encoding="utf-8") as f:
            cache_data = json.load(f)
    else:
        cache_data = cache

    queried_map = {item["substanceId"]: item for item in cache_data.get("queried", [])}
    missing_map = {item["substanceId"]: item for item in cache_data.get("missing", [])}

    checked_substances: list[SubstanceRecord] = []
    for sub in substances:
        if sub.id not in queried_map:
            reason = missing_map.get(sub.id, {}).get("reason", "no_cached_entry")
            ref_val = {
                "cid": None,
                "massDeltaPpm": None,
                "reason": reason,
                "referenceFormula": None,
                "referenceMassGPerMol": None,
                "source": "pubchem",
                "status": "unverified",
            }
            checked_substances.append(replace(sub, referenceValidation=ref_val))
            continue

        entry = queried_map[sub.id]
        ref_formula = entry["molecularFormula"]
        if not formulas_equivalent(sub.formulaToken, ref_formula):
            raise ValueError(
                f"Reference formula mismatch for {sub.id}: "
                f"catalog {sub.formulaToken} vs reference {ref_formula}"
            )

        ref_mass_str = str(entry["molecularWeight"])
        ref_mass = float(ref_mass_str)
        our_mass = float(sub.molarMassGPerMol)
        ppm = abs(ref_mass - our_mass) / ref_mass * 1e6
        if ppm > tol_ppm:
            raise ValueError(
                f"Reference mass mismatch for {sub.id}: "
                f"catalog {sub.molarMassGPerMol} vs reference {ref_mass_str} ({ppm:.1f} ppm > {tol_ppm} ppm)"
            )

        ref_val = {
            "cid": entry["cid"],
            "massDeltaPpm": round(ppm),
            "referenceFormula": ref_formula,
            "referenceMassGPerMol": ref_mass,
            "source": "pubchem",
            "status": "verified",
        }
        checked_substances.append(replace(sub, referenceValidation=ref_val))

    return checked_substances


from collections import Counter
from itertools import combinations
from chempy import balance_stoichiometry


def canonical_pair_key(id_a: str, id_b: str) -> str:
    """Order-independent reaction key over codepoint-sorted ASCII identifiers."""
    lo, hi = sorted((id_a, id_b))
    return f"{lo}|{hi}"


def reaction_id_from_pair(id_a: str, id_b: str) -> str:
    """Order-independent reaction ID from canonical pair key."""
    lo, hi = sorted((id_a, id_b))
    lo_slug = lo.split(".")[1]
    hi_slug = hi.split(".")[1]
    return f"rxn.{lo_slug}__{hi_slug}"


@dataclass(frozen=True)
class ReactionRecord:
    id: str
    canonicalKey: str
    reactantIds: list[str]
    outcome: str | None = None
    reasonCode: str | None = None
    explanationId: str | None = None
    reactants: dict[str, int] | None = None
    products: dict[str, int] | None = None
    phases: dict[str, str] | None = None
    molecularEquation: str | None = None
    molecularEquationLatex: str | None = None
    netIonicEquation: str | None = None
    netIonicEquationLatex: str | None = None
    spectatorIonIds: list[str] | None = None
    candidateSolidId: str | None = None
    reactionClass: str | None = None
    kspRef: dict[str, Any] | None = None
    outcomeCategories: list[str] | None = None
    energyLabel: str | None = None
    conservation: dict[str, Any] | None = None


def balance_reaction(
    reactants: Sequence[SubstanceRecord],
    products: Sequence[SubstanceRecord],
) -> tuple[dict[str, int], dict[str, int]]:
    """Wrap ChemPy balance_stoichiometry, validating positive integer coefficients and sorting keys."""
    r_map = {s.formulaToken: s.id for s in reactants}
    p_map = {s.formulaToken: s.id for s in products}

    try:
        r_coef, p_coef = balance_stoichiometry(set(r_map.keys()), set(p_map.keys()))
    except Exception as e:
        r_ids = [s.id for s in reactants]
        p_ids = [s.id for s in products]
        raise ValueError(f"Stoichiometric balancing failed for {r_ids} -> {p_ids}: {e}") from e

    r_res: dict[str, int] = {}
    p_res: dict[str, int] = {}

    for token, coef in r_coef.items():
        val = int(coef)
        if val <= 0:
            raise ValueError(f"Non-positive integer coefficient {coef} for {token}")
        r_res[r_map[token]] = val

    for token, coef in p_coef.items():
        val = int(coef)
        if val <= 0:
            raise ValueError(f"Non-positive integer coefficient {coef} for {token}")
        p_res[p_map[token]] = val

    return dict(sorted(r_res.items())), dict(sorted(p_res.items()))


def format_term(coef: int, notation: str, phase: str, is_latex: bool = False) -> str:
    """Format single reaction term with coefficient and phase."""
    sep = "\\," if is_latex else " "
    coef_str = f"{coef}{sep}" if coef > 1 else ""
    return f"{coef_str}{notation}({phase})"


def derive_net_ionic(
    r_coef: dict[str, int],
    p_coef: dict[str, int],
    phases: dict[str, str],
    substances: Mapping[str, SubstanceRecord],
    seed: SeedBundle,
) -> tuple[str, str, str, str, list[str]]:
    """Derive balanced molecular and net-ionic equations using catalog notations and min() spectator cancellation."""
    ion_map = {ion.id: ion for ion in seed.ions}
    left: Counter[str] = Counter()
    right: Counter[str] = Counter()

    for sid, c in r_coef.items():
        sub = substances[sid]
        for part in sub.dissociation:
            left[part["ionId"]] += c * part["multiplicity"]

    for sid, c in p_coef.items():
        sub = substances[sid]
        if phases[sid] == "aq":
            for part in sub.dissociation:
                right[part["ionId"]] += c * part["multiplicity"]
        else:
            right[sid] += c

    spectators: list[str] = []
    for species in sorted(set(left.keys()) & set(right.keys())):
        shared = min(left[species], right[species])
        if shared > 0:
            left[species] -= shared
            right[species] -= shared
            if species.startswith("ion."):
                spectators.append(species)

    # Molecular equations
    mol_r_u = [format_term(c, substances[sid].notation["unicode"], phases[sid], False) for sid, c in r_coef.items()]
    mol_p_u = [format_term(c, substances[sid].notation["unicode"], phases[sid], False) for sid, c in p_coef.items()]
    mol_eq_u = " + ".join(mol_r_u) + " → " + " + ".join(mol_p_u)

    mol_r_l = [format_term(c, substances[sid].notation["latex"], phases[sid], True) for sid, c in r_coef.items()]
    mol_p_l = [format_term(c, substances[sid].notation["latex"], phases[sid], True) for sid, c in p_coef.items()]
    mol_eq_l = " + ".join(mol_r_l) + " \\rightarrow " + " + ".join(mol_p_l)

    # Net ionic equations
    net_left_u = []
    net_left_l = []
    for ion_id in sorted(k for k, v in left.items() if v > 0):
        c = left[ion_id]
        ion_obj = ion_map[ion_id]
        ion_sub = Substance.from_formula(ion_obj.formulaToken)
        net_left_u.append(format_term(c, ion_sub.unicode_name, "aq", False))
        net_left_l.append(format_term(c, ion_sub.latex_name, "aq", True))

    net_right_u = []
    net_right_l = []
    for sid in sorted(k for k, v in right.items() if v > 0):
        c = right[sid]
        if sid.startswith("ion."):
            ion_obj = ion_map[sid]
            ion_sub = Substance.from_formula(ion_obj.formulaToken)
            net_right_u.append(format_term(c, ion_sub.unicode_name, "aq", False))
            net_right_l.append(format_term(c, ion_sub.latex_name, "aq", True))
        else:
            net_right_u.append(format_term(c, substances[sid].notation["unicode"], phases[sid], False))
            net_right_l.append(format_term(c, substances[sid].notation["latex"], phases[sid], True))

    net_eq_u = " + ".join(net_left_u) + " → " + " + ".join(net_right_u)
    net_eq_l = " + ".join(net_left_l) + " \\rightarrow " + " + ".join(net_right_l)

    return mol_eq_u, mol_eq_l, net_eq_u, net_eq_l, sorted(spectators)


def verify_conservation(
    reaction_id: str,
    r_coef: dict[str, int],
    p_coef: dict[str, int],
    substances: Mapping[str, SubstanceRecord],
    element_tol: float = 1e-9,
    charge_tol: float = 1e-9,
) -> dict[str, Any]:
    """Verify element and charge conservation from substance compositions."""
    left_elems: Counter[str] = Counter()
    right_elems: Counter[str] = Counter()
    left_charge = 0
    right_charge = 0

    for sid, c in r_coef.items():
        comp = substances[sid].composition
        left_charge += c * substances[sid].netCharge
        for z, n in comp.items():
            left_elems[z] += c * n

    for sid, c in p_coef.items():
        comp = substances[sid].composition
        right_charge += c * substances[sid].netCharge
        for z, n in comp.items():
            right_elems[z] += c * n

    max_delta = 0.0
    for z in sorted(set(left_elems.keys()) | set(right_elems.keys())):
        d = abs(left_elems[z] - right_elems[z])
        if d > max_delta:
            max_delta = float(d)
        if d > element_tol:
            raise ValueError(f"{reaction_id}: element Z={z} unbalanced by {d}")

    charge_delta = abs(left_charge - right_charge)
    if charge_delta > charge_tol:
        raise ValueError(f"{reaction_id}: charge unbalanced by {charge_delta}")

    verified_elements = sorted(left_elems.keys())
    return {
        "elementsVerified": verified_elements,
        "chargeDelta": 0.0,
        "maxElementDelta": 0.0,
    }


def enumerate_reactions(
    substances: Sequence[SubstanceRecord],
    seed: SeedBundle,
) -> list[ReactionRecord]:
    """Enumerate reactions across all selectable reagents with gates, balancing, and conservation."""
    substance_map = {s.id: s for s in substances}
    selectable = [s for s in substances if s.selectable]
    pair_map = {(s.cationId, s.anionId): s for s in substances}

    records: list[ReactionRecord] = []

    # 1. Enumerate canonical pairs (lo, hi with lo != hi)
    for lo, hi in combinations(sorted(selectable, key=lambda s: s.id), 2):
        key = canonical_pair_key(lo.id, hi.id)
        rxn_id = reaction_id_from_pair(lo.id, hi.id)
        reactants = [lo.id, hi.id]

        # Gate 1: Acid with carbonate or sulfide -> gas_evolution_not_modeled
        has_acid = lo.cationId == "ion.h_1p" or hi.cationId == "ion.h_1p"
        has_gas_anion = (lo.anionId in ("ion.co3_2m", "ion.s_2m")) or (hi.anionId in ("ion.co3_2m", "ion.s_2m"))
        if has_acid and has_gas_anion:
            records.append(ReactionRecord(
                id=rxn_id,
                canonicalKey=key,
                reactantIds=reactants,
                outcome="unsupported",
                reasonCode="gas_evolution_not_modeled",
                explanationId="unsupported.gas_evolution",
            ))
            continue

        # Gate 2: Redox / metal displacement
        cations = {lo.cationId, hi.cationId}
        anions = {lo.anionId, hi.anionId}
        if (cations & {"ion.fe_3p", "ion.cu_2p"}) and ("ion.i_1m" in anions):
            records.append(ReactionRecord(
                id=rxn_id,
                canonicalKey=key,
                reactantIds=reactants,
                outcome="unsupported",
                reasonCode="redox_not_modeled",
                explanationId="unsupported.redox",
            ))
            continue

        # Gate 3: Strong acid / strong base neutralization
        is_lo_acid = lo.cationId == "ion.h_1p"
        is_hi_acid = hi.cationId == "ion.h_1p"
        is_lo_base = lo.anionId == "ion.oh_1m"
        is_hi_base = hi.anionId == "ion.oh_1m"

        if (is_lo_acid and is_hi_base) or (is_hi_acid and is_lo_base):
            water = substance_map["sub.h2o"]
            salt_cation = lo.cationId if is_hi_acid else hi.cationId
            salt_anion = hi.anionId if is_hi_acid else lo.anionId
            salt = pair_map.get((salt_cation, salt_anion))
            if not salt:
                raise ValueError(f"Could not find neutralization salt for {salt_cation}+{salt_anion}")

            r_coef, p_coef = balance_reaction([lo, hi], [water, salt])
            phases = {lo.id: "aq", hi.id: "aq", water.id: "l", salt.id: "aq"}
            mol_u, mol_l, net_u, net_l, specs = derive_net_ionic(r_coef, p_coef, phases, substance_map, seed)
            cons = verify_conservation(rxn_id, r_coef, p_coef, substance_map)

            records.append(ReactionRecord(
                id=rxn_id,
                canonicalKey=key,
                reactantIds=reactants,
                reactants=r_coef,
                products=p_coef,
                phases=phases,
                molecularEquation=mol_u,
                molecularEquationLatex=mol_l,
                netIonicEquation=net_u,
                netIonicEquationLatex=net_l,
                spectatorIonIds=specs,
                outcome="neutralization",
                reactionClass="neutralization",
                outcomeCategories=["neutralization"],
                energyLabel="Eksoterm (Panas)",
                conservation=cons,
            ))
            continue

        # Double displacement: cross partner swap
        p1 = pair_map.get((lo.cationId, hi.anionId))
        p2 = pair_map.get((hi.cationId, lo.anionId))

        if not p1 or not p2:
            records.append(ReactionRecord(
                id=rxn_id,
                canonicalKey=key,
                reactantIds=reactants,
                outcome="no_modeled_reaction",
                reasonCode="all_products_soluble",
                explanationId="no_modeled_reaction",
            ))
            continue

        solids = [p for p in (p1, p2) if p.solubilityClass in ("insoluble", "slightly_soluble")]
        if not solids:
            records.append(ReactionRecord(
                id=rxn_id,
                canonicalKey=key,
                reactantIds=reactants,
                outcome="no_modeled_reaction",
                reasonCode="all_products_soluble",
                explanationId="no_modeled_reaction",
            ))
            continue

        # Tie-break: (ksp_value, id)
        solid = min(
            solids,
            key=lambda p: (float(seed.ksp[p.id].value) if p.id in seed.ksp else float("inf"), p.id),
        )

        if solid.id not in seed.ksp:
            records.append(ReactionRecord(
                id=rxn_id,
                canonicalKey=key,
                reactantIds=reactants,
                outcome="no_modeled_reaction",
                reasonCode="no_cited_ksp",
                explanationId="no_modeled_reaction",
            ))
            continue

        other_product = p2 if solid.id == p1.id else p1
        r_coef, p_coef = balance_reaction([lo, hi], [solid, other_product])
        phases = {lo.id: "aq", hi.id: "aq", solid.id: "s", other_product.id: "aq"}
        mol_u, mol_l, net_u, net_l, specs = derive_net_ionic(r_coef, p_coef, phases, substance_map, seed)
        cons = verify_conservation(rxn_id, r_coef, p_coef, substance_map)

        ksp_entry = seed.ksp[solid.id]
        ksp_ref = {
            "substanceId": solid.id,
            "value": ksp_entry.value,
            "temperatureC": ksp_entry.temperatureC,
            "ionPowers": dict(ksp_entry.ionPowers),
            "sourceId": ksp_entry.source.id,
        }

        records.append(ReactionRecord(
            id=rxn_id,
            canonicalKey=key,
            reactantIds=reactants,
            reactants=r_coef,
            products=p_coef,
            phases=phases,
            molecularEquation=mol_u,
            molecularEquationLatex=mol_l,
            netIonicEquation=net_u,
            netIonicEquationLatex=net_l,
            spectatorIonIds=specs,
            candidateSolidId=solid.id,
            reactionClass="double_displacement",
            kspRef=ksp_ref,
            outcomeCategories=["precipitate_forms", "below_saturation"],
            conservation=cons,
        ))

    # 2. Self-pairs: same reagent
    for s in selectable:
        key = canonical_pair_key(s.id, s.id)
        rxn_id = reaction_id_from_pair(s.id, s.id)
        records.append(ReactionRecord(
            id=rxn_id,
            canonicalKey=key,
            reactantIds=[s.id, s.id],
            outcome="no_modeled_reaction",
            reasonCode="same_reagent",
            explanationId="no_modeled_reaction",
        ))

    return sorted(records, key=lambda r: r.canonicalKey)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    seed_dir = repo_root / "catalog" / "seed"
    bundle = validate_seed(seed_dir)
    substances = enumerate_substances(bundle)
    selectable = [s for s in substances if s.selectable]
    reactions = enumerate_reactions(substances, bundle)
    precipitating = [r for r in reactions if r.candidateSolidId]
    neutralizations = [r for r in reactions if r.reactionClass == "neutralization"]
    unsupported = [r for r in reactions if r.outcome == "unsupported"]
    no_reaction = [r for r in reactions if r.outcome == "no_modeled_reaction"]

    print(f"PASS: Enumerated {len(substances)} substances ({len(selectable)} selectable soluble reagents)")
    print(f"PASS: Enumerated {len(reactions)} total reaction records:")
    print(f"  - Precipitating (double displacement): {len(precipitating)}")
    print(f"  - Neutralization: {len(neutralizations)}")
    print(f"  - Declared unsupported: {len(unsupported)}")
    print(f"  - No modeled reaction: {len(no_reaction)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

