# Chemistry Audit Amendments

This document records formal amendments made by the `chemistry-species-expansion` specification to the baseline `codebase-audit-fixes` specification.

## Referenced Specifications

- **Baseline Specification:** `codebase-audit-fixes`
- **Amending Specification:** `chemistry-species-expansion`

## Principles of Alignment

1. **Prerequisite Retention (Requirement 4.1):** Audit Requirements 1 through 8 remain authoritative and are not restated or re-implemented.
2. **Reused Validation Infrastructure (Requirement 4.4):** Generated catalog validation, digest generation, binding parity, and immutability checks reuse established audit validation rather than creating duplicate paths.
3. **Explicit Identification (Requirement 4.5):** Any obligation amended from the audit specification is explicitly identified below.

---

## Amended Identifiers

### 1. Audit Task 3.1 — Canonical Chemistry Encoding & Coverage
- **Original Obligation (Audit Task 3.1):** Directed maintainers to hand-author all supported reagents, ions, dissociation multiplicities, reactions, structural equations, capabilities, presentation metadata, model bounds, and inverse tags into `catalog/chemistry.catalog.json`.
- **Amendment (Requirement 4.2):** **Audit task 3.1 MUST NOT be executed as hand-authoring.** Hand-authoring ~99 substances and 990 reaction records is error-prone and unverifiable. Instead, audit task 3.1's catalog-coverage obligation is discharged by:
  - Hand-authoring a small, human-reviewed chemistry seed under `catalog/seed/` (~70 reviewed rows across `ions.json`, `solubility-rules.json`, `ksp.json`, and `presentation.json`).
  - Expanding the seed at build time through a deterministic, byte-stable generator (`scripts/catalog/generate.py`).
  - Emitting the derived canonical catalog (`catalog/chemistry.catalog.json`), sidecar digest, coverage report, and read-only bindings.

### 2. Audit Requirement 2.5 — Outcome Categories & Saturation Model
- **Original Obligation (Audit Requirement 2.5):** Recognized only two outcome categories for supported pairs: a precipitating/modeled reaction or `no_modeled_reaction` (with all products soluble).
- **Amendment (Requirement 4.3):** The outcome set is expanded to include a third saturation-aware category:
  - `precipitate_forms`: Ion product $Q > K_{sp}$ strictly, producing an observable precipitate.
  - `below_saturation`: The solid is modeled and $K_{sp}$ is known/cited, but concentrations are sufficiently dilute that $Q \le K_{sp}$, so no precipitate forms.
  - `no_modeled_reaction`: All cross-swap products are classified as soluble, or candidates lack a cited $K_{sp}$.
  - Declared boundary statuses (`unsupported` reason codes) for systems outside scope (e.g. gas evolution, redox/metal displacement).
  
Dilute solutions are not collapsed into `no_modeled_reaction`. Instead, they produce `below_saturation` with the candidate solid named, the $Q$ vs $K_{sp}$ comparison explained, and source citations provided.

---

## Revalidated Demonstrations & Boundaries (Requirement 4.5, 9.5)

The preserved demonstrations from audit Requirement 26.3 and audit task 30.1 were re-evaluated through the saturation-aware engine with the following findings:

1. **AgCl Precipitation ($\text{AgNO}_3 + \text{NaCl}$)**:
   $K_{sp} = 1.77 \times 10^{-10}$. At default $0.1\text{ M} / 50\text{ mL}$, $Q \approx 2.5 \times 10^{-3}$, $Q / K_{sp} \approx 1.41 \times 10^7$. Persists as `precipitate_forms` far above threshold.
2. **AgI Precipitation ($\text{AgNO}_3 + \text{KI}$)**:
   $K_{sp} = 8.52 \times 10^{-17}$. At default $0.1\text{ M} / 50\text{ mL}$, $Q \approx 2.5 \times 10^{-3}$, $Q / K_{sp} \approx 2.9 \times 10^{13}$. Persists as `precipitate_forms` far above threshold.
3. **$\text{PbI}_2$ Precipitation ($\text{Pb(NO}_3)_2 + \text{KI}$)**:
   $K_{sp} = 9.8 \times 10^{-9}$. At default $0.1\text{ M} / 50\text{ mL}$, $Q \approx 1.25 \times 10^{-4}$, $Q / K_{sp} \approx 1.27 \times 10^4$. Persists as `precipitate_forms` far above threshold.
4. **$\text{BaSO}_4$ Precipitation ($\text{BaCl}_2 + \text{Na}_2\text{SO}_4$)**:
   $K_{sp} = 1.08 \times 10^{-10}$. At default $0.1\text{ M} / 50\text{ mL}$, $Q \approx 2.5 \times 10^{-3}$, $Q / K_{sp} \approx 2.3 \times 10^7$. Persists as `precipitate_forms` far above threshold.
5. **Neutralization ($\text{HCl} + \text{NaOH}$)**:
   Stays an uninhibited acid-base neutralization producing $\text{NaCl} + \text{H}_2\text{O}$ with no $K_{sp}$ block.
6. **Amended Borderline Demonstration: $\text{PbCl}_2$ ($\text{Pb(NO}_3)_2 + \text{NaCl}$)**:
   - **Original Audit Expectation**: Always formed precipitate across all selectable concentrations.
   - **Amended Saturation Expectation**: With cited $K_{sp} = 1.7 \times 10^{-5}$, an equal-volume mixture forms precipitate only above $c_{threshold} \approx 0.0515\text{ M}$. At default $0.1\text{ M}$, $Q \approx 1.25 \times 10^{-4} > K_{sp}$ (`precipitate_forms`), while at dilute concentrations such as $0.002\text{ M}$, $Q \approx 1.0 \times 10^{-9} < K_{sp}$ (`below_saturation`).
   - Full threshold details and physical derivations are maintained in [`model-boundaries.md`](./model-boundaries.md).
