#!/usr/bin/env python3
"""Validation for hand-authored chemistry seed files.

Loads and validates catalog/seed/ions.json, solubility-rules.json, ksp.json,
and presentation.json. Reports every offending entry with file, JSON pointer,
and reason in a single run.

Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 16.2, 16.3, 16.5
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from typing import Any, Mapping, Sequence

KSP_PATTERN = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$")
KSP_MIN = 1e-60
KSP_MAX = 1.0
SEED_ROW_CEILING = 70
VALID_SOLUBILITY_CLASSES = {"soluble", "slightly_soluble", "insoluble"}
VALID_ORIGINS = {"hand", "ai_draft"}


@dataclass(frozen=True)
class SeedViolation:
    file: str
    pointer: str
    reason: str

    def __str__(self) -> str:
        return f"{self.file} [{self.pointer}]: {self.reason}"


class SeedValidationError(Exception):
    def __init__(self, violations: Sequence[SeedViolation]):
        self.violations = list(violations)
        details = "\n  - ".join(str(v) for v in self.violations)
        super().__init__(f"Seed validation failed with {len(self.violations)} error(s):\n  - {details}")


@dataclass(frozen=True)
class Provenance:
    origin: str
    reviewer: str
    reviewedOn: str


@dataclass(frozen=True)
class ElementSeed:
    symbol: str
    indonesianName: str
    knownOxidationStates: tuple[int, ...]


@dataclass(frozen=True)
class SeedIon:
    id: str
    formulaToken: str
    charge: int
    nameFragment: str
    aqueousSupported: bool
    kind: str  # "cation" or "anion"
    element: str | None
    polyatomic: bool
    displayColor: str
    provenance: Provenance
    acidBaseRole: str | None = None


@dataclass(frozen=True)
class RuleException:
    substanceId: str
    solubilityClass: str


@dataclass(frozen=True)
class SolubilityRule:
    order: int
    id: str
    match: Mapping[str, Any]
    solubilityClass: str
    exceptions: tuple[RuleException, ...]
    note: str | None = None


@dataclass(frozen=True)
class KspSource:
    id: str
    citation: str
    retrievedOn: str
    transcribedBy: str
    checkedBy: str


@dataclass(frozen=True)
class KspEntry:
    substanceId: str
    value: str
    temperatureC: int
    ionPowers: Mapping[str, int]
    source: KspSource
    provenance: Provenance


@dataclass(frozen=True)
class ReagentGroup:
    id: str
    labelId: str
    label: str
    match: Mapping[str, Any]
    order: int


@dataclass(frozen=True)
class NomenclatureOverride:
    substanceId: str
    name: str
    reason: str


@dataclass(frozen=True)
class PresentationSeed:
    reagentGroups: tuple[ReagentGroup, ...]
    nomenclatureOverrides: tuple[NomenclatureOverride, ...]
    substanceColors: Mapping[str, str]
    explanations: Mapping[str, str]


@dataclass(frozen=True)
class SeedBundle:
    ions: tuple[SeedIon, ...]
    rules: tuple[SolubilityRule, ...]
    ksp: Mapping[str, KspEntry]
    presentation: PresentationSeed
    elements: Mapping[str, ElementSeed]


def _validate_provenance(prov_data: Any, file: str, pointer: str, violations: list[SeedViolation]) -> Provenance | None:
    if not isinstance(prov_data, dict):
        violations.append(SeedViolation(file, pointer, "missing or malformed provenance block"))
        return None

    origin = prov_data.get("origin")
    reviewer = prov_data.get("reviewer")
    reviewed_on = prov_data.get("reviewedOn")

    if origin not in VALID_ORIGINS:
        violations.append(SeedViolation(file, f"{pointer}/origin", f"invalid origin '{origin}', must be 'hand' or 'ai_draft'"))

    if origin == "ai_draft":
        if not reviewer or not isinstance(reviewer, str) or not reviewer.strip():
            violations.append(SeedViolation(file, f"{pointer}/reviewer", "ai_draft provenance requires non-empty reviewer"))
        if not reviewed_on or not isinstance(reviewed_on, str) or not reviewed_on.strip():
            violations.append(SeedViolation(file, f"{pointer}/reviewedOn", "ai_draft provenance requires non-empty reviewedOn date"))

    return Provenance(
        origin=str(origin or ""),
        reviewer=str(reviewer or ""),
        reviewedOn=str(reviewed_on or ""),
    )


def validate_seed(seed_dir: Path) -> SeedBundle:
    violations: list[SeedViolation] = []
    ions_file = seed_dir / "ions.json"
    rules_file = seed_dir / "solubility-rules.json"
    ksp_file = seed_dir / "ksp.json"
    pres_file = seed_dir / "presentation.json"

    for required_file in (ions_file, rules_file, ksp_file, pres_file):
        if not required_file.is_file():
            violations.append(SeedViolation(required_file.name, "", f"required seed file '{required_file.name}' not found"))

    if violations:
        raise SeedValidationError(violations)

    try:
        ions_raw = json.loads(ions_file.read_text(encoding="utf-8"))
    except Exception as e:
        violations.append(SeedViolation("ions.json", "", f"invalid JSON: {e}"))
        ions_raw = {}

    try:
        rules_raw = json.loads(rules_file.read_text(encoding="utf-8"))
    except Exception as e:
        violations.append(SeedViolation("solubility-rules.json", "", f"invalid JSON: {e}"))
        rules_raw = {}

    try:
        ksp_raw = json.loads(ksp_file.read_text(encoding="utf-8"))
    except Exception as e:
        violations.append(SeedViolation("ksp.json", "", f"invalid JSON: {e}"))
        ksp_raw = {}

    try:
        pres_raw = json.loads(pres_file.read_text(encoding="utf-8"))
    except Exception as e:
        violations.append(SeedViolation("presentation.json", "", f"invalid JSON: {e}"))
        pres_raw = {}

    if violations:
        raise SeedValidationError(violations)

    # 1. Validate elements
    elements_map: dict[str, ElementSeed] = {}
    elements_raw = ions_raw.get("elements", {})
    if not isinstance(elements_raw, dict) or not elements_raw:
        violations.append(SeedViolation("ions.json", "/elements", "missing or empty elements map"))
    else:
        for symbol, elem_data in elements_raw.items():
            pointer = f"/elements/{symbol}"
            if not isinstance(elem_data, dict):
                violations.append(SeedViolation("ions.json", pointer, "element entry must be an object"))
                continue
            name = elem_data.get("indonesianName")
            ox_states = elem_data.get("knownOxidationStates")
            if not name or not isinstance(name, str):
                violations.append(SeedViolation("ions.json", f"{pointer}/indonesianName", "missing or non-string indonesianName"))
            if not isinstance(ox_states, list) or not ox_states or not all(isinstance(x, int) and not isinstance(x, bool) for x in ox_states):
                violations.append(SeedViolation("ions.json", f"{pointer}/knownOxidationStates", "knownOxidationStates must be non-empty list of integers"))
            elements_map[symbol] = ElementSeed(
                symbol=symbol,
                indonesianName=str(name or ""),
                knownOxidationStates=tuple(ox_states or ()),
            )

    # 2. Validate ions
    all_ion_ids: set[str] = set()
    parsed_ions: list[SeedIon] = []
    cations_raw = ions_raw.get("cations", [])
    anions_raw = ions_raw.get("anions", [])

    if not isinstance(cations_raw, list) or not cations_raw:
        violations.append(SeedViolation("ions.json", "/cations", "missing or empty cations list"))
    if not isinstance(anions_raw, list) or not anions_raw:
        violations.append(SeedViolation("ions.json", "/anions", "missing or empty anions list"))

    row_count = len(cations_raw) + len(anions_raw)
    if row_count > SEED_ROW_CEILING:
        violations.append(SeedViolation("ions.json", "", f"hand-authored row count {row_count} exceeds {SEED_ROW_CEILING}-row ceiling"))

    def check_ion(ion_data: Any, kind: str, index: int):
        pointer = f"/{kind}s/{index}"
        if not isinstance(ion_data, dict):
            violations.append(SeedViolation("ions.json", pointer, "ion entry must be an object"))
            return

        ion_id = ion_data.get("id")
        formula_token = ion_data.get("formulaToken")
        charge = ion_data.get("charge")
        name_frag = ion_data.get("nameFragment")
        aq_supp = ion_data.get("aqueousSupported")
        prov_data = ion_data.get("provenance")

        if not ion_id or not isinstance(ion_id, str) or not ion_id.startswith("ion."):
            violations.append(SeedViolation("ions.json", f"{pointer}/id", f"invalid ion id '{ion_id}'"))
        elif ion_id in all_ion_ids:
            violations.append(SeedViolation("ions.json", f"{pointer}/id", f"duplicate ion id '{ion_id}'"))
        else:
            all_ion_ids.add(ion_id)

        if not formula_token or not isinstance(formula_token, str):
            violations.append(SeedViolation("ions.json", f"{pointer}/formulaToken", "missing or empty formulaToken"))

        if not isinstance(charge, int) or isinstance(charge, bool):
            violations.append(SeedViolation("ions.json", f"{pointer}/charge", f"charge must be an integer, got {charge!r}"))
        else:
            if kind == "cation" and charge <= 0:
                violations.append(SeedViolation("ions.json", f"{pointer}/charge", f"cation charge must be positive, got {charge}"))
            elif kind == "anion" and charge >= 0:
                violations.append(SeedViolation("ions.json", f"{pointer}/charge", f"anion charge must be negative, got {charge}"))

        if not name_frag or not isinstance(name_frag, str):
            violations.append(SeedViolation("ions.json", f"{pointer}/nameFragment", "missing or empty nameFragment"))

        if not isinstance(aq_supp, bool):
            violations.append(SeedViolation("ions.json", f"{pointer}/aqueousSupported", "aqueousSupported must be a boolean"))

        prov = _validate_provenance(prov_data, "ions.json", f"{pointer}/provenance", violations)
        element = ion_data.get("element")
        if element and element not in elements_map:
            violations.append(SeedViolation("ions.json", f"{pointer}/element", f"references undeclared element '{element}'"))

        if prov and ion_id:
            parsed_ions.append(SeedIon(
                id=ion_id,
                formulaToken=str(formula_token or ""),
                charge=int(charge) if isinstance(charge, int) and not isinstance(charge, bool) else 0,
                nameFragment=str(name_frag or ""),
                aqueousSupported=bool(aq_supp),
                kind=kind,
                element=element,
                polyatomic=bool(ion_data.get("polyatomic", False)),
                displayColor=str(ion_data.get("displayColor", "#94a3b8")),
                provenance=prov,
                acidBaseRole=ion_data.get("acidBaseRole"),
            ))

    if isinstance(cations_raw, list):
        for i, c in enumerate(cations_raw):
            check_ion(c, "cation", i)
    if isinstance(anions_raw, list):
        for i, a in enumerate(anions_raw):
            check_ion(a, "anion", i)

    # 3. Validate solubility rules
    parsed_rules: list[SolubilityRule] = []
    default_class = rules_raw.get("defaultClass")
    if default_class not in VALID_SOLUBILITY_CLASSES:
        violations.append(SeedViolation("solubility-rules.json", "/defaultClass", f"invalid defaultClass '{default_class}'"))

    rules_list = rules_raw.get("rules", [])
    if not isinstance(rules_list, list) or not rules_list:
        violations.append(SeedViolation("solubility-rules.json", "/rules", "rules must be non-empty list"))
    else:
        seen_orders: set[int] = set()
        seen_rule_ids: set[str] = set()

        for i, rule in enumerate(rules_list):
            pointer = f"/rules/{i}"
            if not isinstance(rule, dict):
                violations.append(SeedViolation("solubility-rules.json", pointer, "rule must be an object"))
                continue

            order = rule.get("order")
            rule_id = rule.get("id")
            match_scope = rule.get("match")
            r_class = rule.get("class")
            exceptions_raw = rule.get("exceptions", [])

            if not isinstance(order, int) or isinstance(order, bool):
                violations.append(SeedViolation("solubility-rules.json", f"{pointer}/order", f"order must be integer, got {order!r}"))
            elif order in seen_orders:
                violations.append(SeedViolation("solubility-rules.json", f"{pointer}/order", f"duplicate rule order {order}"))
            else:
                seen_orders.add(order)

            if not rule_id or not isinstance(rule_id, str) or not rule_id.startswith("rule."):
                violations.append(SeedViolation("solubility-rules.json", f"{pointer}/id", f"invalid rule id '{rule_id}'"))
            elif rule_id in seen_rule_ids:
                violations.append(SeedViolation("solubility-rules.json", f"{pointer}/id", f"duplicate rule id '{rule_id}'"))
            else:
                seen_rule_ids.add(rule_id)

            if r_class not in VALID_SOLUBILITY_CLASSES:
                violations.append(SeedViolation("solubility-rules.json", f"{pointer}/class", f"invalid class '{r_class}'"))

            if not isinstance(match_scope, dict) or not match_scope:
                violations.append(SeedViolation("solubility-rules.json", f"{pointer}/match", "match must be non-empty object"))
            else:
                # Check for dangling ion references
                for match_key, val in match_scope.items():
                    if match_key in ("cationId", "anionId"):
                        if val not in all_ion_ids:
                            violations.append(SeedViolation("solubility-rules.json", f"{pointer}/match/{match_key}", f"dangling ion reference '{val}'"))
                    elif match_key in ("cationIdIn", "anionIdIn"):
                        if isinstance(val, list):
                            for ion_ref in val:
                                if ion_ref not in all_ion_ids:
                                    violations.append(SeedViolation("solubility-rules.json", f"{pointer}/match/{match_key}", f"dangling ion reference '{ion_ref}'"))

            parsed_exceptions: list[RuleException] = []
            if not isinstance(exceptions_raw, list):
                violations.append(SeedViolation("solubility-rules.json", f"{pointer}/exceptions", "exceptions must be list"))
            else:
                for j, exc in enumerate(exceptions_raw):
                    exc_ptr = f"{pointer}/exceptions/{j}"
                    if not isinstance(exc, dict):
                        violations.append(SeedViolation("solubility-rules.json", exc_ptr, "exception must be an object"))
                        continue
                    sub_id = exc.get("substanceId")
                    exc_class = exc.get("class")
                    if not sub_id or not isinstance(sub_id, str) or not sub_id.startswith("sub."):
                        violations.append(SeedViolation("solubility-rules.json", f"{exc_ptr}/substanceId", f"invalid substanceId '{sub_id}'"))
                    if exc_class not in VALID_SOLUBILITY_CLASSES:
                        violations.append(SeedViolation("solubility-rules.json", f"{exc_ptr}/class", f"invalid class '{exc_class}'"))
                    if sub_id and exc_class in VALID_SOLUBILITY_CLASSES:
                        parsed_exceptions.append(RuleException(substanceId=sub_id, solubilityClass=exc_class))

            if isinstance(order, int) and rule_id and r_class in VALID_SOLUBILITY_CLASSES:
                parsed_rules.append(SolubilityRule(
                    order=order,
                    id=rule_id,
                    match=match_scope or {},
                    solubilityClass=r_class,
                    exceptions=tuple(parsed_exceptions),
                    note=rule.get("note"),
                ))

    # 4. Validate Ksp
    ksp_map: dict[str, KspEntry] = {}
    ksp_entries_raw = ksp_raw.get("entries", [])
    if not isinstance(ksp_entries_raw, list) or not ksp_entries_raw:
        violations.append(SeedViolation("ksp.json", "/entries", "entries must be non-empty list"))
    else:
        for i, entry in enumerate(ksp_entries_raw):
            pointer = f"/entries/{i}"
            if not isinstance(entry, dict):
                violations.append(SeedViolation("ksp.json", pointer, "entry must be an object"))
                continue

            sub_id = entry.get("substanceId")
            value_str = entry.get("value")
            temp_c = entry.get("temperatureC")
            ion_powers = entry.get("ionPowers")
            source_data = entry.get("source")
            prov_data = entry.get("provenance")

            if not sub_id or not isinstance(sub_id, str) or not sub_id.startswith("sub."):
                violations.append(SeedViolation("ksp.json", f"{pointer}/substanceId", f"invalid substanceId '{sub_id}'"))

            if not isinstance(value_str, str) or not KSP_PATTERN.match(value_str):
                violations.append(SeedViolation("ksp.json", f"{pointer}/value", f"Ksp value must be authored decimal string, got {value_str!r}"))
            else:
                try:
                    num_val = float(value_str)
                    if not (KSP_MIN < num_val < KSP_MAX):
                        violations.append(SeedViolation("ksp.json", f"{pointer}/value", f"Ksp {num_val} outside sanity band ({KSP_MIN} < Ksp < {KSP_MAX})"))
                except ValueError:
                    violations.append(SeedViolation("ksp.json", f"{pointer}/value", f"unparsable float from '{value_str}'"))

            if not isinstance(temp_c, int) or isinstance(temp_c, bool):
                violations.append(SeedViolation("ksp.json", f"{pointer}/temperatureC", f"temperatureC must be integer, got {temp_c!r}"))

            if not isinstance(ion_powers, dict) or not ion_powers:
                violations.append(SeedViolation("ksp.json", f"{pointer}/ionPowers", "ionPowers must be non-empty map"))
            else:
                for ion_id_ref, power in ion_powers.items():
                    if ion_id_ref not in all_ion_ids:
                        violations.append(SeedViolation("ksp.json", f"{pointer}/ionPowers/{ion_id_ref}", f"dangling ion reference '{ion_id_ref}'"))
                    if not isinstance(power, int) or isinstance(power, bool) or power <= 0:
                        violations.append(SeedViolation("ksp.json", f"{pointer}/ionPowers/{ion_id_ref}", f"ion power must be positive integer, got {power!r}"))

            ksp_source = None
            if not isinstance(source_data, dict):
                violations.append(SeedViolation("ksp.json", f"{pointer}/source", "missing source citation block"))
            else:
                citation = source_data.get("citation")
                transcribed_by = source_data.get("transcribedBy")
                checked_by = source_data.get("checkedBy")
                if not citation or not isinstance(citation, str) or not citation.strip():
                    violations.append(SeedViolation("ksp.json", f"{pointer}/source/citation", "citation must be non-empty string"))
                if not transcribed_by or not isinstance(transcribed_by, str) or not transcribed_by.strip():
                    violations.append(SeedViolation("ksp.json", f"{pointer}/source/transcribedBy", "transcribedBy must be non-empty string"))
                if not checked_by or not isinstance(checked_by, str) or not checked_by.strip():
                    violations.append(SeedViolation("ksp.json", f"{pointer}/source/checkedBy", "checkedBy must be non-empty string"))
                if transcribed_by and checked_by and transcribed_by == checked_by:
                    violations.append(SeedViolation("ksp.json", f"{pointer}/source/checkedBy", "transcribedBy and checkedBy reviewers must be distinct"))

                ksp_source = KspSource(
                    id=str(source_data.get("id", "")),
                    citation=str(citation or ""),
                    retrievedOn=str(source_data.get("retrievedOn", "")),
                    transcribedBy=str(transcribed_by or ""),
                    checkedBy=str(checked_by or ""),
                )

            prov = _validate_provenance(prov_data, "ksp.json", f"{pointer}/provenance", violations)

            if sub_id and isinstance(value_str, str) and ksp_source and prov:
                ksp_map[sub_id] = KspEntry(
                    substanceId=sub_id,
                    value=value_str,
                    temperatureC=int(temp_c) if isinstance(temp_c, int) else 25,
                    ionPowers=dict(ion_powers) if isinstance(ion_powers, dict) else {},
                    source=ksp_source,
                    provenance=prov,
                )

    # 5. Validate presentation
    reagent_groups: list[ReagentGroup] = []
    groups_raw = pres_raw.get("reagentGroups", [])
    if not isinstance(groups_raw, list) or not groups_raw:
        violations.append(SeedViolation("presentation.json", "/reagentGroups", "missing or empty reagentGroups list"))
    else:
        for i, grp in enumerate(groups_raw):
            pointer = f"/reagentGroups/{i}"
            if not isinstance(grp, dict):
                violations.append(SeedViolation("presentation.json", pointer, "group entry must be an object"))
                continue
            grp_id = grp.get("id")
            label = grp.get("label")
            order = grp.get("order")
            match_s = grp.get("match")
            if not grp_id or not isinstance(grp_id, str):
                violations.append(SeedViolation("presentation.json", f"{pointer}/id", "missing group id"))
            if not label or not isinstance(label, str):
                violations.append(SeedViolation("presentation.json", f"{pointer}/label", "missing group label"))
            if not isinstance(order, int) or isinstance(order, bool):
                violations.append(SeedViolation("presentation.json", f"{pointer}/order", "group order must be integer"))
            if not isinstance(match_s, dict) or not match_s:
                violations.append(SeedViolation("presentation.json", f"{pointer}/match", "group match must be non-empty object"))
            else:
                anion_id = match_s.get("anionId")
                if anion_id and anion_id not in all_ion_ids:
                    violations.append(SeedViolation("presentation.json", f"{pointer}/match/anionId", f"dangling ion reference '{anion_id}'"))

            if grp_id and label and isinstance(order, int):
                reagent_groups.append(ReagentGroup(
                    id=grp_id,
                    labelId=str(grp.get("labelId", "")),
                    label=label,
                    match=match_s or {},
                    order=order,
                ))

    overrides_list: list[NomenclatureOverride] = []
    overrides_raw = pres_raw.get("nomenclatureOverrides", [])
    if isinstance(overrides_raw, list):
        for i, ov in enumerate(overrides_raw):
            pointer = f"/nomenclatureOverrides/{i}"
            if not isinstance(ov, dict):
                continue
            sub_id = ov.get("substanceId")
            name = ov.get("name")
            reason = ov.get("reason")
            if not sub_id or not isinstance(sub_id, str):
                violations.append(SeedViolation("presentation.json", f"{pointer}/substanceId", "missing substanceId"))
            if not name or not isinstance(name, str):
                violations.append(SeedViolation("presentation.json", f"{pointer}/name", "missing override name"))
            if not reason or not isinstance(reason, str) or not reason.strip():
                violations.append(SeedViolation("presentation.json", f"{pointer}/reason", "override requires a non-empty reason"))
            if sub_id and name and reason:
                overrides_list.append(NomenclatureOverride(substanceId=sub_id, name=name, reason=reason))

    substance_colors = pres_raw.get("substanceColors", {})
    if not isinstance(substance_colors, dict):
        violations.append(SeedViolation("presentation.json", "/substanceColors", "substanceColors must be an object"))

    explanations = pres_raw.get("explanations", {})
    if not isinstance(explanations, dict):
        violations.append(SeedViolation("presentation.json", "/explanations", "explanations must be an object"))
    else:
        for required_exp in (
            "below_saturation",
            "no_modeled_reaction",
            "unsupported.gas_evolution",
            "unsupported.redox",
            "unsupported.weak_equilibrium",
        ):
            if required_exp not in explanations:
                violations.append(SeedViolation("presentation.json", f"/explanations/{required_exp}", f"missing required explanation '{required_exp}'"))

    if violations:
        raise SeedValidationError(violations)

    # Sort members for determinism
    sorted_ions = tuple(sorted(parsed_ions, key=lambda ion: ion.id))
    sorted_rules = tuple(sorted(parsed_rules, key=lambda rule: rule.order))
    sorted_ksp = {k: ksp_map[k] for k in sorted(ksp_map.keys())}
    sorted_groups = tuple(sorted(reagent_groups, key=lambda g: g.order))
    sorted_overrides = tuple(sorted(overrides_list, key=lambda o: o.substanceId))
    sorted_elements = {k: elements_map[k] for k in sorted(elements_map.keys())}

    presentation_seed = PresentationSeed(
        reagentGroups=sorted_groups,
        nomenclatureOverrides=sorted_overrides,
        substanceColors=dict(sorted(substance_colors.items())),
        explanations=dict(sorted(explanations.items())),
    )

    return SeedBundle(
        ions=sorted_ions,
        rules=sorted_rules,
        ksp=sorted_ksp,
        presentation=presentation_seed,
        elements=sorted_elements,
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    seed_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else repo_root / "catalog" / "seed"

    try:
        bundle = validate_seed(seed_dir)
        print(f"PASS: Seed valid ({len(bundle.ions)} ions, {len(bundle.rules)} rules, {len(bundle.ksp)} Ksp entries, {len(bundle.elements)} elements)")
        return 0
    except SeedValidationError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
