# Chemistry Species Expansion — Final Checkpoint & Owner Sign-Off

**Specification:** `chemistry-species-expansion`  
**Catalog Version:** `2.0.0`  
**Schema Version:** `2.0.0`  
**Catalog Digest:** `5ec94be5c1112c62f1127b33347b38a6b652505e35d96d9d0ce98a988285351e`  
**Date:** 2026-10-16  
**Status:** **APPROVED & VERIFIED**

---

## 1. Executive Summary

The `chemistry-species-expansion` milestone transitions Atomverse from a fragile, hand-coded 8-reagent demonstration prototype to a scalable, scientifically rigorous chemistry platform with 52 selectable soluble reagents, 96 total binary substances, and 1,378 pairwise reaction pathways.

All 23 tasks specified in `.kiro/specs/chemistry-species-expansion/tasks.md` have been fully executed and verified through automated test suites and continuous-integration gates.

---

## 2. Formal Sign-Off Items

### 2.1 Seed Citations and Two-Person Review Governance
- **Requirement:** 1.4, 1.6, 16.1, 16.2, 16.3, 16.5
- **Verification:** All quantitative solubility records in `catalog/seed/ksp.json` are authored decimal strings with verifiable bibliographic citations (e.g., *CRC Handbook of Chemistry and Physics*, 97th Edition).
- **Two-Person Rule:** Automated tests enforce that each entry includes both a `transcribedBy` and a distinct `checkedBy` reviewer.
- **Sign-Off:** **APPROVED** — No unverified or single-author $K_{sp}$ values exist in the seed library.

### 2.2 Intentional $\text{PbCl}_2$ Saturation Behavior Change
- **Requirement:** 9.5, 9.6, 17.6
- **Verification:**
  - $\text{PbCl}_2$ ($K_{sp} = 1.7 \times 10^{-5}$) has an equal-volume mixing threshold of $c_{threshold} \approx 0.0515\text{ M}$.
  - At default concentrations ($0.1\text{ M}, 50\text{ mL}$ each), $Q \approx 1.25 \times 10^{-4} > K_{sp}$, forming white $\text{PbCl}_2$ precipitate (`precipitate_forms`).
  - At dilute concentrations ($0.002\text{ M}, 50\text{ mL}$ each), $Q \approx 1.0 \times 10^{-9} \le K_{sp}$, remaining clear aqueous solution (`below_saturation`).
  - The UI and tutor present an educational explanation citing $Q$ vs $K_{sp}$ rather than failing silently.
- **Sign-Off:** **APPROVED** — The physical threshold is mathematically derived, documented in `docs/chemistry/model-boundaries.md`, and validated by unit and property-based regression fixtures.

### 2.3 Four Declared Non-Goals
- **Requirement:** 9.6, 17.1, 17.3, 17.4, 17.5
- **Verification:**
  1. **Gas Evolution Reactions**: Acid reacting with carbonates ($\text{CO}_3^{2-}$) or sulfides ($\text{S}^{2-}$) are flagged with `unsupported.gas_evolution` rather than incorrectly forced into hypothetical aqueous salts.
  2. **Redox / Single Displacement**: Electron transfer reactions and metal displacements return typed reason code `unsupported.redox`.
  3. **Weak-Acid / Weak-Base Equilibria**: Buffer calculations and partial dissociation are flagged `unsupported.weak_equilibrium`.
  4. **Runtime Database Migration**: The chemistry catalog is compiled and frozen at build time; runtime dependencies on databases or dynamic migration systems are eliminated.
- **Sign-Off:** **APPROVED** — The domain boundaries are closed, typed, and reject out-of-scope chemistry truthfully.

### 2.4 Audit Amendments
- **Requirement:** 4.1, 4.2, 4.3, 4.4, 4.5
- **Verification:**
  - **Audit Task 3.1 Amendment**: Hand-authoring ~99 substances and ~1000 reactions into `chemistry.catalog.json` is formally replaced with deterministic seed compilation (`scripts/catalog/generate.py`).
  - **Audit Requirement 2.5 Amendment**: Outcome categories are expanded to include `below_saturation`, preventing dilute solutions from collapsing into `no_modeled_reaction`.
  - **Reused Infrastructure**: Catalog validation, SHA-256 sidecars, and four-way binding parity are preserved and reused.
- **Sign-Off:** **APPROVED** — Documented in `docs/chemistry/audit-amendments.md`.

---

## 3. Metric and Quality Verification

| Metric | Required Band / Target | Verified Result | Status |
|---|---|---|---|
| Selectable Soluble Reagents | 40 – 55 | 52 | **PASS** |
| Total Derived Substances | ~99 | 96 (3 excluded weak acids) | **PASS** |
| Pairwise Reaction Records | > 900 | 1,378 | **PASS** |
| Canonical Reaction Fixtures | 6 | 6 frozen, verified | **PASS** |
| Formal Correctness Properties | 37 | 37 / 37 passed | **PASS** |
| Drift Check & 4-Way Parity | Byte & digest identical | Exact match | **PASS** |
| Forbidden Literals in Engine | 0 | 0 (All 5 removed) | **PASS** |
| Hardcoded Tutor Explanations | 0 | 0 (Removed from main.py) | **PASS** |
| Malformed Formula Strings | 0 | 0 (AgNO(aq), Pb(NO)₂ eradicated) | **PASS** |
| Hand-typed Unicode Notation | 0 outside catalog | 0 (CI scan verified) | **PASS** |
| Build Toolchain Runtime Leak | 0 | 0 in dist/ or backend/app/ | **PASS** |
| WAI-ARIA Combobox Accessibility | WCAG 2.1 AA | 0 axe-core violations | **PASS** |
| Pytest Test Suite | 100% | 86 / 86 passed | **PASS** |
| Vitest Frontend Suite | 100% | 13 / 13 passed | **PASS** |

---

## 4. Certification Statement

The chemistry species expansion milestone is complete, deterministic, and sealed. All acceptance criteria and safety constraints are verified.
