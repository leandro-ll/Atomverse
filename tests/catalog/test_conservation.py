"""Property 24: Reactions conserve elements and charge.

Validates: Requirements 12.1, 12.3, 12.4
- For all generated reactions, every tracked element and the net charge balance
  between reactants and products within the declared numerical tolerance.
- Evaluated library-wide across all modeled reactions and over at least 100 iterations.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG


# Feature: chemistry-species-expansion, Property 24: Reactions conserve elements and charge
def test_reactions_conserve_elements_and_charge_property() -> None:
    substances = {s["id"]: s for s in CATALOG["substances"]}
    modeled_reactions = [r for r in CATALOG["reactions"] if "reactants" in r and "products" in r]

    assert len(modeled_reactions) > 0, "Expected modeled reactions in catalog"

    tol_element = CATALOG.get("model", {}).get("tolerances", {}).get("element", 1e-9)
    tol_charge = CATALOG.get("model", {}).get("tolerances", {}).get("charge", 1e-9)

    def verify_reaction_conservation(rxn: dict) -> None:
        rxn_id = rxn["id"]
        reactant_terms = rxn["reactants"]
        product_terms = rxn["products"]

        reactant_elements: dict[str, float] = {}
        product_elements: dict[str, float] = {}
        reactant_charge = 0.0
        product_charge = 0.0

        # Sum reactant elements and charge
        for sub_id, coeff in reactant_terms.items():
            assert sub_id in substances, f"Reaction {rxn_id}: unknown reactant {sub_id}"
            sub = substances[sub_id]
            for elem_z, count in sub["composition"].items():
                z_str = str(elem_z)
                reactant_elements[z_str] = reactant_elements.get(z_str, 0.0) + (coeff * count)
            reactant_charge += coeff * sub.get("charge", 0.0)

        # Sum product elements and charge
        for sub_id, coeff in product_terms.items():
            assert sub_id in substances, f"Reaction {rxn_id}: unknown product {sub_id}"
            sub = substances[sub_id]
            for elem_z, count in sub["composition"].items():
                z_str = str(elem_z)
                product_elements[z_str] = product_elements.get(z_str, 0.0) + (coeff * count)
            product_charge += coeff * sub.get("charge", 0.0)

        # 1. Element conservation
        all_elements = set(reactant_elements.keys()) | set(product_elements.keys())
        for elem_z in all_elements:
            r_count = reactant_elements.get(elem_z, 0.0)
            p_count = product_elements.get(elem_z, 0.0)
            diff = abs(r_count - p_count)
            assert diff <= tol_element, (
                f"Reaction {rxn_id}: element Z={elem_z} not conserved: "
                f"reactants={r_count}, products={p_count}, diff={diff} > {tol_element}"
            )

        # 2. Charge conservation
        charge_diff = abs(reactant_charge - product_charge)
        assert charge_diff <= tol_charge, (
            f"Reaction {rxn_id}: charge not conserved: "
            f"reactants={reactant_charge}, products={product_charge}, diff={charge_diff} > {tol_charge}"
        )

        # 3. Catalog conservation metadata check
        cons = rxn.get("conservation")
        if cons is not None:
            assert cons.get("maxElementDelta", 0.0) <= tol_element
            assert cons.get("chargeDelta", 0.0) <= tol_charge

    # 1. Exhaustive check across all modeled reactions in library
    for rxn in modeled_reactions:
        verify_reaction_conservation(rxn)

    # 2. Randomized sampling over 120 iterations
    rng = random.Random(2424)
    for _ in range(120):
        rxn = rng.choice(modeled_reactions)
        verify_reaction_conservation(rxn)
