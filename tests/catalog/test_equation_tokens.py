"""Property test 20: Every equation token is a parsable catalog species.

Validates: Requirements 2.3, 10.2, 10.3
For all generated reactions, every species token appearing in the molecular and net-ionic
equations parses through the chemistry toolkit and corresponds to a catalog substance or ion record.
"""

from pathlib import Path
import re
import pytest
from chempy import Substance
from scripts.catalog.validate_seed import validate_seed
from scripts.catalog.generate import enumerate_substances, enumerate_reactions

ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "catalog" / "seed"

# Term pattern: optional coefficient, species notation, phase in parentheses
# e.g., "2 AgNO₃(aq)", "Ba(NO₃)₂(aq)", "2 Ag⁺(aq)"
TERM_RE = re.compile(r"^(?:(\d+)\s+)?(.+?)\((aq|s|l|g)\)$")


def parse_equation_terms(equation: str) -> list[tuple[int, str, str]]:
    """Parse equation like '2 A(aq) + B(aq) → C(s) + 2 D(aq)' into [(coef, notation, phase), ...]."""
    arrow = "→" if "→" in equation else "\\rightarrow"
    assert arrow in equation, f"No arrow in equation: {equation}"
    sides = equation.split(arrow)
    assert len(sides) == 2, f"Equation should have exactly two sides: {equation}"

    terms: list[tuple[int, str, str]] = []
    for side in sides:
        raw_parts = [p.strip() for p in side.split("+")]
        for p in raw_parts:
            # Handle LaTeX \, spacing if present
            cleaned = p.replace("\\,", " ")
            m = TERM_RE.match(cleaned)
            assert m is not None, f"Could not parse term '{p}' from equation '{equation}'"
            coef = int(m.group(1)) if m.group(1) else 1
            notation = m.group(2).strip()
            phase = m.group(3)
            terms.append((coef, notation, phase))
    return terms


def test_every_equation_token_is_parsable_catalog_species():
    seed = validate_seed(SEED_DIR)
    substances = enumerate_substances(seed)
    reactions = enumerate_reactions(substances, seed)

    # Build notation -> record lookup tables
    sub_by_unicode = {s.notation["unicode"]: s for s in substances}
    ion_by_unicode = {}
    for ion in seed.ions:
        ion_sub = Substance.from_formula(ion.formulaToken)
        ion_by_unicode[ion_sub.unicode_name] = ion

    # Also build formulaToken sets
    sub_tokens = {s.formulaToken: s for s in substances}
    ion_tokens = {ion.formulaToken: ion for ion in seed.ions}

    reactions_with_equations = [r for r in reactions if r.molecularEquation is not None]
    assert len(reactions_with_equations) > 0

    for rxn in reactions_with_equations:
        # Check molecular equation terms
        assert rxn.molecularEquation is not None
        mol_terms = parse_equation_terms(rxn.molecularEquation)
        for coef, notation, phase in mol_terms:
            assert coef > 0, f"Non-positive coefficient {coef} in {rxn.id}"
            assert notation in sub_by_unicode, (
                f"Molecular term '{notation}' in {rxn.id} not found in catalog substances"
            )
            sub = sub_by_unicode[notation]
            # Verify parses through chemistry toolkit
            chempy_sub = Substance.from_formula(sub.formulaToken)
            assert chempy_sub is not None
            assert chempy_sub.composition.get(0, 0) == 0, f"Substance {sub.id} must be charge-neutral"

        # Check net-ionic equation terms
        assert rxn.netIonicEquation is not None
        net_terms = parse_equation_terms(rxn.netIonicEquation)
        for coef, notation, phase in net_terms:
            assert coef > 0, f"Non-positive coefficient {coef} in {rxn.id}"
            # Notation can be either an ion (aq) or a precipitate/product substance (s, l)
            if notation in ion_by_unicode:
                ion = ion_by_unicode[notation]
                chempy_ion = Substance.from_formula(ion.formulaToken)
                assert chempy_ion is not None
                assert chempy_ion.composition.get(0, 0) == ion.charge
            elif notation in sub_by_unicode:
                sub = sub_by_unicode[notation]
                chempy_sub = Substance.from_formula(sub.formulaToken)
                assert chempy_sub is not None
            else:
                pytest.fail(f"Net-ionic term '{notation}' in {rxn.id} is neither a catalog ion nor substance")
