# Shared chemistry fixtures

Golden vectors for the canonical chemistry catalog. They are written by hand and
state expected chemistry independently of `catalog/chemistry.catalog.json`, so a
wrong catalog value cannot satisfy both the catalog and the fixture.

| Fixture | Contents |
| --- | --- |
| `formula-composition.json` | Element composition and net charge of every species and ion, plus the ASCII formula each one must read as. |
| `reaction-balance.json` | Elemental totals and net charge for both sides of every molecular and net ionic equation, and for every reagent dissociation. |
| `reagent-pair-keys.json` | Normalized order-independent lookup key and modeled reaction (or `null`) for all 28 unordered reagent pairs. |
| `display-formatting.json` | Unicode formulas, reagent control labels, dissociation equations, balanced molecular and net ionic equations, and localized model-boundary messages that the frontend and backend formatters must both produce. |
| `experiment-vectors.json` | End-to-end evaluation vectors: concrete in-bounds quantities for all six supported pairs plus representative no-reaction pairs, with the expected category, equations, limiting reactant, extent, consumed/remaining amounts, excess, product amounts, spectator ions, phase model, appearance, and energy label. Also carries the audited regression guards (malformed-formula patterns, the contradictory no-reaction text, the removed layer labels), the four preserved canonical demonstrations, and the `controlCapabilities` block: the quantity boundary cases at every declared concentration and volume bound, the bounded qualitative motion factor each temperature maps to, and the fixed 1 atm pressure state with no modeled effect. |

Each fixture declares the `catalogVersion` it was written against. Tests assert
that version still matches the committed catalog, so bumping the catalog forces
the goldens to be re-reviewed instead of silently drifting.

Load them through `tests/helpers/chemistry/catalog-fixtures.mjs`; the evaluator,
inverse solver, and binding tests are expected to reuse the same files rather
than restating these vectors.
