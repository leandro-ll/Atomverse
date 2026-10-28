# Atomverse

> **[EN]** An interactive, scientifically rigorous virtual aqueous chemistry laboratory platform featuring deterministic stoichiometric modeling, $Q$ vs $K_{sp}$ saturation thresholds, inverse target-precipitate synthesis, and an educational chemistry tutor.
>
> **[ID]** Platform laboratorium kimia larutan berair (*aqueous*) virtual yang interaktif dan akurat secara ilmiah, dilengkapi pemodelan stoikiometri deterministik, ambang batas kejenuhan $Q$ vs $K_{sp}$, sintesis endapan target terbalik (*inverse synthesis*), serta tutor kimia edukatif.

---

## Table of Contents / Daftar Isi

1. [Project Overview & Key Features / Gambaran Umum & Fitur Utama](#1-project-overview--key-features--gambaran-umum--fitur-utama)
2. [Project Architecture & Directory Structure / Arsitektur & Struktur Direktori](#2-project-architecture--directory-structure--arsitektur--struktur-direktori)
3. [Prerequisites & Installation / Prasyarat & Instalasi](#3-prerequisites--installation--prasyarat--instalasi)
4. [Development & Build Commands / Perintah Pengembangan & Build](#4-development--build-commands--perintah-pengembangan--build)
5. [Testing & CI Pipeline / Pengujian & Pipeline CI](#5-testing--ci-pipeline--pengujian--pipeline-ci)
6. [Documentation / Dokumentasi](#6-documentation--dokumentasi)

---

## 1. Project Overview & Key Features / Gambaran Umum & Fitur Utama

### English

**Atomverse** is a web-based virtual chemistry laboratory designed to bridge interactive visual experimentation with quantitative physical chemistry rigor. Built on a deterministic, seed-compiled chemistry catalog (`v2.0.0`), it guarantees exact parity between frontend and backend evaluators.

- **Expanded Chemical Domain:** Models **11 cations** and **9 anions**, yielding **52 selectable soluble reagents**, **96 derived binary substances**, and **1,378 pairwise reaction pathways**.
- **Saturation-Aware Precipitation ($Q$ vs $K_{sp}$):** Evaluates ion product $Q$ against peer-reviewed solubility product constants ($K_{sp}$) with bibliographic citations (e.g., *CRC Handbook of Chemistry and Physics*). Distinguishes between active precipitation (`precipitate_forms`) and sub-saturation dilute solutions (`below_saturation`).
- **Closed Outcome Categories:** Every reaction is deterministically classified into one of five closed outcomes:
  - `precipitate_forms` ($Q > K_{sp}$)
  - `below_saturation` ($Q \le K_{sp}$)
  - `no_modeled_reaction` (all cross-swap products soluble)
  - `neutralization` (strong acid + strong base stoichiometric tracking)
  - `unsupported` (explicitly typed non-goals: `unsupported.gas_evolution`, `unsupported.redox`, `unsupported.weak_equilibrium`)
- **Inverse Synthesis Enumeration:** Calculates feasible reagent pairs, concentrations, and volumes needed to synthesize a target mass of precipitate, re-verified through the forward chemistry engine.
- **Non-Authoritative AI & Local Tutor:** Composes structured educational explanations anchored strictly to verified catalog and engine states, preventing hallucinated formulas or unverified stoichiometry.
- **Offline-First & Accessible UI:** Bundles all fonts, KaTeX math rendering, and Tailwind CSS locally with zero runtime CDN dependencies, meeting WCAG 2.1 AA combobox accessibility standards.

### Bahasa Indonesia

**Atomverse** adalah laboratorium kimia virtual berbasis web yang dirancang untuk menjembatani eksperimen visual interaktif dengan ketelitian kimia fisik kuantitatif. Dibangun di atas katalog kimia deterministik yang dikompilasi dari *seed* (`v2.0.0`), platform ini menjamin kesamaan (*parity*) penuh antara evaluator *frontend* dan *backend*.

- **Domain Kimia yang Diperluas:** Memodelkan **11 kation** dan **9 anion**, menghasilkan **52 reagen larut yang dapat dipilih**, **96 zat biner turunan**, dan **1.378 jalur reaksi berpasangan**.
- **Pengendapan Berbasis Kejenuhan ($Q$ vs $K_{sp}$):** Mengevaluasi hasil kali ion $Q$ terhadap tetapan hasil kali kelarutan ($K_{sp}$) terverifikasi beserta sitasi bibliografi (mis. *CRC Handbook of Chemistry and Physics*). Membedakan secara akurat antara terbentuknya endapan (`precipitate_forms`) dan larutan encer di bawah kejenuhan (`below_saturation`).
- **Kategori Hasil Tertutup:** Setiap reaksi diklasifikasikan secara deterministik ke dalam salah satu dari lima hasil tertutup:
  - `precipitate_forms` ($Q > K_{sp}$)
  - `below_saturation` ($Q \le K_{sp}$)
  - `no_modeled_reaction` (semua produk pertukaran ion larut)
  - `neutralization` (pelacakan stoikiometri asam kuat + basa kuat)
  - `unsupported` (reaksi di luar cakupan yang ditandai secara eksplisit: `unsupported.gas_evolution`, `unsupported.redox`, `unsupported.weak_equilibrium`)
- **Enumerasi Sintesis Terbalik (*Inverse Synthesis*):** Menghitung pasangan reagen, konsentrasi, dan volume yang layak untuk mensintesis target massa endapan tertentu, serta memverifikasi ulang hasilnya melalui mesin kimia maju (*forward engine*).
- **Tutor Lokal & AI Non-Otoritatif:** Menyusun penjelasan edukatif terstruktur yang sepenuhnya berpedoman pada status katalog dan mesin kimia terverifikasi, mencegah halusinasi rumus kimia atau stoikiometri.
- **UI Offline-First & Aksesibel:** Membundel seluruh *font*, perender matematika KaTeX, dan Tailwind CSS secara lokal tanpa ketergantungan CDN saat *runtime*, serta memenuhi standar aksesibilitas WCAG 2.1 AA.

---

## 2. Project Architecture & Directory Structure / Arsitektur & Struktur Direktori

```text
Atomverse/
├── catalog/                     # Canonical chemistry catalog, schema, and seed data
│   ├── seed/                    # Human-reviewed seed files (ions, solubility-rules, ksp, presentation)
│   ├── chemistry.catalog.json   # Compiled canonical catalog (v2.0.0)
│   ├── chemistry.catalog.sha256 # SHA-256 digest sidecar
│   └── chemistry.schema.json    # JSON Schema for catalog validation
├── js/                          # Frontend application & pure JS chemistry evaluator
│   └── catalog/                 # Read-only generated frontend catalog bindings
├── backend/                     # FastAPI backend, Python chemistry evaluator, inverse solver & tutor
│   ├── app/                     # Runtime backend package (isolated from build-only toolchains)
│   ├── tests/                   # Backend unit & property-based pytest suites
│   ├── requirements.txt         # Runtime Python dependencies
│   └── requirements-build.lock  # Pinned build & verification dependencies
├── scripts/                     # Build, catalog generation, CI, and verification scripts
│   ├── catalog/                 # Seed validation, catalog compilation, drift & binding checks
│   ├── ci/                      # Import-graph, Unicode notation, test-suite & pipeline runners
│   ├── frontend/                # Zero-runtime-CDN bundle verification
│   └── dev_backend.py           # Cross-platform local FastAPI development runner
├── tests/                       # Cross-cutting test suites
│   ├── catalog/                 # Conservation, neutrality, determinism & reference gate tests
│   ├── chemistry/               # Evaluator parity, saturation monotonicity & frozen fixtures
│   ├── frontend/                # Vitest unit, property-based (fast-check), and axe accessibility tests
│   └── ci/                      # CI workflow and pipeline contract tests
└── docs/                        # Technical specifications, model boundaries & governance sign-off
    └── chemistry/
```

### Architectural Guarantees / Jaminan Arsitektur

- **4-Way Digest Parity / Paritas Digest 4-Arah:** The canonical `catalog/chemistry.catalog.json`, its `.sha256` sidecar, the frontend JS binding, and the backend Python binding are verified in CI to remain byte- and digest-identical.
- **Build vs. Runtime Seam Isolation / Isolasi Seam Build vs. Runtime:** Build-time symbolic chemistry libraries (such as `chempy` and `sympy`) are strictly isolated to `scripts/catalog/` and `backend/requirements-build.lock` and never leak into runtime `backend/app/` or frontend `dist/` bundles.

---

## 3. Prerequisites & Installation / Prasyarat & Instalasi

### Prerequisites / Prasyarat

- **Node.js:** `^22.22.2 || ^24.15.0 || >=26.0.0`
- **npm:** `>=11.0.0`
- **Python:** `3.11+`

### 1. Frontend Setup / Instalasi Frontend

```bash
npm install
```

### 2. Backend Setup / Instalasi Backend

**[EN]** Create a virtual environment inside `backend/.venv` (automatically detected by `scripts/dev_backend.py`) and install dependencies:

**[ID]** Buat *virtual environment* di dalam `backend/.venv` (terdeteksi otomatis oleh `scripts/dev_backend.py`) lalu instal dependensi:

```powershell
# Windows (PowerShell)
python -m venv backend/.venv
backend\.venv\Scripts\pip install --upgrade pip
backend\.venv\Scripts\pip install -r backend/requirements.txt
backend\.venv\Scripts\pip install -r backend/requirements-build.lock
```

```bash
# macOS / Linux
python3 -m venv backend/.venv
backend/.venv/bin/pip install --upgrade pip
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/pip install -r backend/requirements-build.lock
```

---

## 4. Development & Build Commands / Perintah Pengembangan & Build

| Command / Perintah | Description (EN) | Deskripsi (ID) |
| :--- | :--- | :--- |
| `npm run dev` | Start the Vite frontend dev server | Menjalankan server pengembangan *frontend* Vite |
| `npm run backend:dev` | Start the FastAPI backend on `http://localhost:8000` | Menjalankan *backend* FastAPI di `http://localhost:8000` |
| `npm run build` | Build the production frontend bundle (`dist/`) | Membangun bundel produksi *frontend* (`dist/`) |
| `npm run preview` | Preview the production frontend build locally | Meninjau hasil *build* produksi *frontend* secara lokal |
| `npm run catalog:validate` | Validate `chemistry.catalog.json` against JSON Schema | Memvalidasi `chemistry.catalog.json` terhadap JSON Schema |
| `npm run catalog:digest` | Regenerate the catalog SHA-256 digest sidecar | Membuat ulang *sidecar* digest SHA-256 katalog |
| `npm run catalog:generate` | Generate read-only JS/Python catalog bindings | Menghasilkan *binding* katalog JS/Python *read-only* |
| `npm run catalog:bindings:check` | Verify 4-way catalog binding parity | Memverifikasi kesamaan (*parity*) *binding* katalog 4-arah |

**[EN]** To recompile the canonical catalog from `catalog/seed/` and verify zero drift:

**[ID]** Untuk mengompilasi ulang katalog kanonis dari `catalog/seed/` dan memverifikasi tidak adanya *drift*:

```bash
python scripts/catalog/validate_seed.py
python scripts/catalog/generate.py
python scripts/catalog/check_drift.py
```

---

## 5. Testing & CI Pipeline / Pengujian & Pipeline CI

### Frontend & Vitest Suites / Pengujian Frontend & Vitest

```bash
# Run all Vitest suites / Jalankan seluruh pengujian Vitest
npm test

# Run frontend unit tests / Jalankan uji unit frontend
npm run test:unit

# Run WCAG 2.1 AA accessibility smoke tests (axe-core) / Jalankan uji aksesibilitas
npm run test:accessibility

# Run frontend property-based tests (fast-check) / Jalankan uji berbasis properti
npm run test:property

# Run Vitest chemistry tests / Jalankan uji kimia Vitest
npm run test:chemistry

# Run CI workflow contract tests / Jalankan uji kontrak CI
npm run test:ci
```

### Python & Chemistry Pipeline Suites / Pengujian Python & Pipeline Kimia

```bash
# Run full chemistry CI pipeline & generate bounded report (`reports/chemistry-ci-report.json`)
# Jalankan pipeline CI kimia penuh & hasilkan laporan (`reports/chemistry-ci-report.json`)
npm run ci:chemistry

# Run pytest across catalog, chemistry, and backend suites
# Jalankan pytest untuk katalog, kimia, dan backend
pytest
```

### Seam, Dependency & Pre-Commit Checks / Pemeriksaan Seam, Dependensi & Pre-Commit

```bash
# Verify zero runtime CDN usage, clean backend import graph, and no raw Unicode formulas
# Verifikasi bebas CDN runtime, grafik impor backend bersih, dan bebas notasi Unicode mentah
npm run check:seam

# Run full baseline CI validation / Jalankan validasi baseline CI lengkap
npm run ci:baseline

# Full frontend validation (dependencies, security audit, tests, build, and CDN check)
# Validasi frontend menyeluruh (dependensi, audit keamanan, pengujian, build, dan cek CDN)
npm run validate:frontend
```

---

## 6. Documentation / Dokumentasi

- **[Chemistry Audit Amendments](docs/chemistry/audit-amendments.md):**
  - **[EN]** Documents formal amendments made by `chemistry-species-expansion` to the baseline `codebase-audit-fixes` specification (deterministic seed generation replacing hand-authoring in Audit Task 3.1, and expansion of Audit Requirement 2.5 to include `below_saturation`).
  - **[ID]** Mendokumentasikan amandemen resmi dari spesifikasi `chemistry-species-expansion` terhadap spesifikasi dasar `codebase-audit-fixes` (kompilasi *seed* deterministik menggantikan penulisan manual pada Tugas Audit 3.1, serta perluasan Kebutuhan Audit 2.5 untuk mencakup kategori `below_saturation`).
- **[Chemistry Model Boundaries and Scope](docs/chemistry/model-boundaries.md):**
  - **[EN]** Specifies the 11 cations and 9 anions, the 5 closed outcome categories, the $\text{PbCl}_2$ saturation threshold ($c_{\text{threshold}} \approx 0.0515\text{ M}$), and the 4 explicit non-goals.
  - **[ID]** Menjelaskan spesifikasi 11 kation dan 9 anion, 5 kategori hasil tertutup, ambang kejenuhan $\text{PbCl}_2$ ($c_{\text{threshold}} \approx 0.0515\text{ M}$), serta 4 batasan reaksi di luar cakupan (*non-goals*).
- **[Chemistry Species Expansion — Final Checkpoint & Owner Sign-Off](docs/chemistry/sign-off.md):**
  - **[EN]** Executive summary, two-person $K_{sp}$ citation governance verification, quality metrics, and formal certification for Catalog `v2.0.0`.
  - **[ID]** Ringkasan eksekutif, verifikasi tata kelola sitasi $K_{sp}$ dua-peninjau, metrik kualitas, dan sertifikasi resmi untuk Katalog `v2.0.0`.
