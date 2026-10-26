"""Property 12: Recorded notation round-trips through the toolkit.

Validates: Requirements 7.4, 12.6
"""

from __future__ import annotations

from pathlib import Path
import random
import re
import pytest

from chempy import Substance
import chempy.util.parsing as cup
from scripts.catalog.generate import enumerate_substances
from scripts.catalog.validate_seed import validate_seed

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"

# Build reverse mappings for Unicode sub/superscript characters to ASCII
_SUB_MAP = {v: k for k, v in cup._unicode_sub.items()}
_SUP_MAP = {v: k for k, v in cup._unicode_sup.items()}


def parse_unicode_formula_to_chempy(unicode_str: str) -> str:
    """Translates a Unicode formula containing subscripts and superscripts into an ASCII formula parsable by ChemPy."""
    body_chars: list[str] = []
    charge_chars: list[str] = []

    for ch in unicode_str:
        if ch in _SUP_MAP:
            charge_chars.append(_SUP_MAP[ch])
        elif ch in _SUB_MAP:
            body_chars.append(_SUB_MAP[ch])
        else:
            body_chars.append(ch)

    body = "".join(body_chars)
    charge = "".join(charge_chars)

    if charge:
        # Normalize trailing magnitude and sign, e.g. '2+' -> '+2', '2-' -> '-2'
        m = re.match(r"^(\d+)([+-])$", charge)
        if m:
            charge = m.group(2) + m.group(1)
        return f"{body}{charge}"
    return body


# Feature: chemistry-species-expansion, Property 12: Recorded notation round-trips through the toolkit
def test_notation_roundtrip_property() -> None:
    """For all substances and ions, parsing the recorded Unicode notation back
    through the chemistry toolkit yields a composition equal to the recorded composition.
    """
    seed = validate_seed(SEED_DIR)
    substances = enumerate_substances(seed)
    ions = seed.ions

    assert len(substances) > 0, "Expected non-empty enumerated substances"
    assert len(ions) > 0, "Expected non-empty ions"

    # 1. Verify all ions
    for ion in ions:
        orig = Substance.from_formula(ion.formulaToken)
        unicode_str = orig.unicode_name
        parsed_formula = parse_unicode_formula_to_chempy(unicode_str)
        parsed = Substance.from_formula(parsed_formula)
        assert orig.composition == parsed.composition, (
            f"Ion {ion.id}: composition mismatch between original {orig.composition} "
            f"and parsed {parsed.composition} from Unicode '{unicode_str}'"
        )

    # 2. Verify all substances
    for sub_rec in substances:
        unicode_str = sub_rec.notation["unicode"]
        parsed_formula = parse_unicode_formula_to_chempy(unicode_str)
        parsed = Substance.from_formula(parsed_formula)

        expected_comp = {int(k): v for k, v in sub_rec.composition.items()}
        actual_comp = {k: v for k, v in parsed.composition.items() if k != 0}

        assert expected_comp == actual_comp, (
            f"Substance {sub_rec.id}: composition mismatch for '{unicode_str}' -> '{parsed_formula}': "
            f"expected {expected_comp}, got {actual_comp}"
        )

    # 3. Property test over randomized subsamples across 100 iterations (Requirement 12.6)
    rng = random.Random(42)
    for _ in range(100):
        ion_sample = rng.sample(ions, k=min(5, len(ions)))
        for ion in ion_sample:
            orig = Substance.from_formula(ion.formulaToken)
            parsed = Substance.from_formula(parse_unicode_formula_to_chempy(orig.unicode_name))
            assert orig.composition == parsed.composition

        sub_sample = rng.sample(substances, k=min(10, len(substances)))
        for sub_rec in sub_sample:
            parsed = Substance.from_formula(parse_unicode_formula_to_chempy(sub_rec.notation["unicode"]))
            expected_comp = {int(k): v for k, v in sub_rec.composition.items()}
            actual_comp = {k: v for k, v in parsed.composition.items() if k != 0}
            assert expected_comp == actual_comp
