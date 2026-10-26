"""Property 11: Generated names are compositional, correctly numbered, and correctly attributed.

Validates: Requirements 7.1, 7.2, 7.3, 12.6
"""

from __future__ import annotations

from pathlib import Path
import random
import pytest

from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"

ROMAN_NUMERALS = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
    7: "VII",
    8: "VIII",
}


# Feature: chemistry-species-expansion, Property 11: Generated names are compositional, correctly numbered, and correctly attributed
def test_nomenclature_property() -> None:
    """For all substances: if in overrides -> override name + 'override' provenance;
    otherwise -> 'compositional', starts with cation fragment, ends with anion fragment,
    and includes roman(charge) iff cation element has >1 known oxidation state.
    """
    seed = validate_seed(SEED_DIR)
    substances = enumerate_substances(seed)
    assert len(substances) > 0, "Expected non-empty enumerated substances"

    ion_map = {ion.id: ion for ion in seed.ions}
    element_map = seed.elements
    override_map = {ov.substanceId: ov.name for ov in seed.presentation.nomenclatureOverrides}

    def verify_substance_name(sub) -> None:
        cation = ion_map[sub.cationId]
        anion = ion_map[sub.anionId]
        cat_element = element_map.get(cation.element or "")

        if sub.id in override_map:
            assert sub.indonesianName == override_map[sub.id], (
                f"{sub.id}: expected override name '{override_map[sub.id]}', got '{sub.indonesianName}'"
            )
            assert sub.nameProvenance == "override", (
                f"{sub.id}: expected provenance 'override', got '{sub.nameProvenance}'"
            )
        else:
            assert sub.nameProvenance == "compositional", (
                f"{sub.id}: expected provenance 'compositional', got '{sub.nameProvenance}'"
            )
            # Starts with cation nameFragment
            assert sub.indonesianName.startswith(cation.nameFragment), (
                f"{sub.id}: name '{sub.indonesianName}' must start with cation fragment '{cation.nameFragment}'"
            )
            # Ends with anion nameFragment
            assert sub.indonesianName.endswith(anion.nameFragment), (
                f"{sub.id}: name '{sub.indonesianName}' must end with anion fragment '{anion.nameFragment}'"
            )

            has_multiple_ox_states = bool(cat_element and len(cat_element.knownOxidationStates) > 1)
            roman = ROMAN_NUMERALS.get(cation.charge, str(cation.charge))
            roman_token = f"({roman})"

            if has_multiple_ox_states:
                assert roman_token in sub.indonesianName, (
                    f"{sub.id}: cation element {cation.element} has multiple oxidation states; "
                    f"expected '{roman_token}' in '{sub.indonesianName}'"
                )
            else:
                assert roman_token not in sub.indonesianName, (
                    f"{sub.id}: cation element {cation.element} does not have multiple oxidation states; "
                    f"'{roman_token}' must not appear in '{sub.indonesianName}'"
                )

    # 1. Deterministic verification across all enumerated substances
    for sub in substances:
        verify_substance_name(sub)

    # 2. Randomized sampling over at least 100 iterations (Requirement 12.6)
    rng = random.Random(42)
    for _ in range(100):
        sample = rng.sample(substances, k=min(15, len(substances)))
        for sub in sample:
            verify_substance_name(sub)
