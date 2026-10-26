"""Property 13: Colliding names fail generation.

Validates: Requirements 7.6
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import random
import pytest

from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import (
    NomenclatureOverride,
    PresentationSeed,
    SeedBundle,
    SeedIon,
    validate_seed,
)

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"


def vary_casing_whitespace(name: str, rng: random.Random) -> str:
    """Randomly alters casing and extra whitespace while preserving normalized text."""
    words = name.split()
    altered_words = []
    for w in words:
        choice = rng.choice(["lower", "upper", "title", "keep"])
        if choice == "lower":
            altered_words.append(w.lower())
        elif choice == "upper":
            altered_words.append(w.upper())
        elif choice == "title":
            altered_words.append(w.capitalize())
        else:
            altered_words.append(w)
    sep = " " * rng.randint(1, 4)
    prefix_space = " " * rng.randint(0, 3)
    suffix_space = " " * rng.randint(0, 3)
    return f"{prefix_space}{sep.join(altered_words)}{suffix_space}"


# Feature: chemistry-species-expansion, Property 13: Colliding names fail generation
def test_name_collision_property() -> None:
    """For any pair of seeded name fragments or overrides that compose to the same
    case-folded, whitespace-normalized Indonesian name, generation fails and the
    message names both colliding identifiers.
    """
    base_seed = validate_seed(SEED_DIR)
    baseline_substances = enumerate_substances(base_seed)
    sub_map = {s.id: s for s in baseline_substances}
    sub_ids = sorted(sub_map.keys())

    rng = random.Random(42)

    # 1. Test injecting a conflicting override matching an existing substance's name (50 iterations)
    for _ in range(50):
        target_id, victim_id = rng.sample(sub_ids, 2)
        target_name = sub_map[target_id].indonesianName
        colliding_name = vary_casing_whitespace(target_name, rng)

        existing_overrides = [
            ov for ov in base_seed.presentation.nomenclatureOverrides if ov.substanceId != victim_id
        ]
        new_override = NomenclatureOverride(
            substanceId=victim_id,
            name=colliding_name,
            reason="PBT collision injection test",
        )
        mutated_presentation = replace(
            base_seed.presentation,
            nomenclatureOverrides=tuple(existing_overrides + [new_override]),
        )
        mutated_seed = replace(base_seed, presentation=mutated_presentation)

        with pytest.raises(ValueError) as exc_info:
            enumerate_substances(mutated_seed)

        msg = str(exc_info.value)
        assert "collision" in msg.lower(), f"Expected 'collision' in error message: {msg}"
        assert target_id in msg, f"Expected {target_id} in collision message: {msg}"
        assert victim_id in msg, f"Expected {victim_id} in collision message: {msg}"

    # 2. Test mutating an ion's nameFragment to collide with another ion (50 iterations)
    anions = [ion for ion in base_seed.ions if ion.kind == "anion"]
    for _ in range(50):
        a1, a2 = rng.sample(anions, 2)
        mutated_fragment = vary_casing_whitespace(a1.nameFragment, rng)

        mutated_ions = [
            replace(ion, nameFragment=mutated_fragment) if ion.id == a2.id else ion
            for ion in base_seed.ions
        ]
        mutated_seed = replace(base_seed, ions=tuple(mutated_ions))

        with pytest.raises(ValueError) as exc_info:
            enumerate_substances(mutated_seed)

        msg = str(exc_info.value)
        assert "collision" in msg.lower(), f"Expected 'collision' in error message: {msg}"
        assert "sub." in msg, f"Expected colliding substance IDs in message: {msg}"
