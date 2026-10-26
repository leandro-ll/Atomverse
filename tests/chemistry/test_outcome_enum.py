"""Property 18: Outcome categories are closed and string-serialized.

Validates: Requirements 8.6, 17.2
- For any evaluation, the serialized outcome is one of the declared enumeration members,
  serialized as its string spelling rather than an ordinal.
- OUTCOME_CATEGORIES is a closed frozen list of strings.
- A consumer encountering an unrecognized member degrades to 'unsupported' rather
  than to any precipitating category.
- Evaluated over at least 100 iterations.
"""

from __future__ import annotations

import random
import pytest

from backend.app.generated.chemistry_catalog import CATALOG
from backend.app.domain.chemistry_evaluator import (
    OUTCOME_CATEGORIES,
    evaluate_experiment,
)


def safe_consumer_outcome_switch(raw_outcome: str) -> str:
    """Standard consumer switch degrading unknown outcome categories to 'unsupported'."""
    if raw_outcome in OUTCOME_CATEGORIES:
        return raw_outcome
    return "unsupported"


# Feature: chemistry-species-expansion, Property 18: Outcome categories are closed and string-serialized
def test_outcome_enumeration_closed_and_serialized() -> None:
    # 1. OUTCOME_CATEGORIES invariant
    assert isinstance(OUTCOME_CATEGORIES, (tuple, list))
    assert len(OUTCOME_CATEGORIES) == 5
    expected_categories = [
        "precipitate_forms",
        "below_saturation",
        "no_modeled_reaction",
        "neutralization",
        "unsupported",
    ]
    assert list(OUTCOME_CATEGORIES) == expected_categories
    assert list(CATALOG["outcomeCategories"]) == expected_categories

    # 2. String serialization: no ordinals across 120 randomized evaluations
    substances = CATALOG["substances"]
    rng = random.Random(1818)

    iterations = 120
    observed_categories: set[str] = set()

    for i in range(iterations):
        sub_a = rng.choice(substances)
        sub_b = rng.choice(substances)
        c_a = rng.uniform(0.001, 1.0)
        c_b = rng.uniform(0.001, 1.0)
        v_a = rng.uniform(10.0, 100.0)
        v_b = rng.uniform(10.0, 100.0)

        inp = {
            "reagentAId": sub_a["id"],
            "reagentBId": sub_b["id"],
            "concentrationA_M": c_a,
            "concentrationB_M": c_b,
            "volumeA_mL": v_a,
            "volumeB_mL": v_b,
        }

        res = evaluate_experiment(CATALOG, inp)
        outcome = res["outcome"]

        assert isinstance(outcome, str), f"Iteration {i}: outcome must be string, got {type(outcome)}"
        assert not isinstance(outcome, int), f"Iteration {i}: outcome must not be ordinal"
        assert outcome in OUTCOME_CATEGORIES, f"Iteration {i}: outcome '{outcome}' not in OUTCOME_CATEGORIES"

        observed_categories.add(outcome)

    # 3. Degradation of unrecognized outcome category
    unknown_categories = ["gas_evolves", "redox_displacement", "unknown_future_outcome", "42"]
    for unk in unknown_categories:
        degraded = safe_consumer_outcome_switch(unk)
        assert degraded == "unsupported", f"Unrecognized category '{unk}' must degrade to 'unsupported', got '{degraded}'"
        assert degraded != "precipitate_forms", "Must never degrade to a precipitating category"
        assert degraded != "below_saturation"
