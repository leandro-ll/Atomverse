# Chemistry Catalog Regeneration Runbook

This runbook outlines the operational procedures for compiling, validating, and verifying the Atomverse chemistry catalog.

---

## 1. Build-Time vs Runtime Architecture

To guarantee high runtime performance, zero network overhead, and small deployment bundles, heavy symbolic chemistry toolkits are isolated to **build-time generation**:

- **Build-Only Dependencies**: `chempy`, `sympy`, `scipy`. These packages are declared in `backend/requirements-build.txt` (or dev dependencies) and must **never** be imported in `backend/app/` or bundled into client distribution assets.
- **Runtime Environment**: Consumes only precompiled, static JSON/JS artifacts (`catalog/chemistry.catalog.json`, `js/generated/chemistry-catalog.js`, and `backend/app/domain/chemistry_catalog.py`).

---

## 2. Standard Generation Sequence

Whenever seed files in `catalog/seed/` are modified, execute the three-phase compilation and verification sequence:

### Phase 1: Generate Catalog and Bindings
Run the deterministic generator script:
```bash
python scripts/catalog/generate.py
```
This performs the following steps:
1. Loads `catalog/seed/{ions,solubility-rules,ksp,presentation}.json`.
2. Generates ~99 substance records and calculates masses quantized to 6 decimal places.
3. Classifies solubility and calculates stoichiometry for cross-combinations.
4. Generates balanced equations and net ionic representations using ChemPy.
5. Emits `catalog/chemistry.catalog.json`, `catalog/chemistry.catalog.json.sha256`, `catalog/coverage-report.json`, `js/generated/chemistry-catalog.js`, and `backend/app/domain/chemistry_catalog.py`.

### Phase 2: Validate Generated Catalog
Run schema, conservation, and integrity checks:
```bash
python scripts/catalog/validate-catalog.py
```
This verifies:
- Charge neutrality for all ionic compounds.
- Mass and atom conservation across all reaction equations.
- Non-empty localized names (Indonesian and English).
- Valid $K_{sp}$ formatting (authored decimal strings).

### Phase 3: Drift Verification
Run the automated drift guard:
```bash
python scripts/catalog/verify-drift.py
```
The drift check regenerates the catalog in memory and asserts that every emitted file matches the committed filesystem copy byte-for-byte. If any divergence or byte offset mismatch occurs, CI fails fast.

---

## 3. Emitted Artifacts and Digest Integrity

The generation pipeline maintains four-way synchronized artifacts:

1. `catalog/chemistry.catalog.json`: Canonical JSON catalog.
2. `catalog/chemistry.catalog.json.sha256`: SHA-256 sidecar hash.
3. `js/generated/chemistry-catalog.js`: Browser ES5-compatible runtime export.
4. `backend/app/domain/chemistry_catalog.py`: Python runtime module with frozen types.
5. `catalog/coverage-report.json`: Metrics tracking substance counts, reaction counts, and modeled coverage.

All runtime bindings contain the exact SHA-256 catalog digest embedded at generation time. Both frontend and backend verify this digest at startup.

---

## 4. PubChem Cache Maintenance

To guarantee deterministic, offline builds without external API dependencies:
- Compound metadata, IUPAC names, and SMILES strings are cached in `catalog/cache/pubchem_cache.json`.
- Normal generation operates strictly from this offline cache with zero outbound HTTP calls.

### Refreshing the Cache
If new ions or species require fresh PubChem metadata:
1. Run the cache update script with an explicit network flag:
   ```bash
   python scripts/catalog/refresh-pubchem-cache.py --online
   ```
2. Inspect the `git diff` on `catalog/cache/pubchem_cache.json`.
3. Verify that new records conform to existing schema before re-running generation.

---

## 5. Catalog Version Bump Procedure

When atomic weights are updated by IUPAC or new reactions/species are incorporated:

1. **Update Version**:
   Increment the semantic version string in `catalog/seed/version.json` (or generator header).
2. **Execute Full Regeneration**:
   Follow Section 2 (Generate $\to$ Validate $\to$ Verify Drift).
3. **Verify Frozen Fixtures**:
   Run `pytest tests/catalog/test_frozen_fixtures.py`.
   - If legitimate mass or constant updates alter fixture numbers, review the diff with domain leads before updating fixture snapshots.
4. **Run Full Test Matrix**:
   ```bash
   pytest
   npm run test:unit
   ```
5. **Commit with Audit Trail**:
   Commit the seed changes, generated files, sidecars, and updated test expectations together with the reviewer sign-off documented in the commit message.
