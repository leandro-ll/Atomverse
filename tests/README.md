# Test layout

| Directory | Runner | Contents |
| --- | --- | --- |
| `tests/frontend/` | vitest | Frontend toolchain, DOM, accessibility, and runtime-asset tests. |
| `tests/ci/` | vitest | Release-manifest policy and CI test-suite registry tests. |
| `tests/chemistry/` | vitest | Catalog, evaluator, conservation, and visualization-plan tests (tasks 3 to 8). |
| `tests/fixtures/chemistry/` | — | Shared golden chemistry vectors: formula composition, equation balance, and reagent pair keys. See its README. |
| `tests/helpers/chemistry/` | — | Shared chemistry test helpers: catalog definition checks and the golden fixture loader. |
| `tests/test_*.py` | pytest | Repository safety and migration-inventory tests. |
| `backend/tests/` | pytest | Backend scaffolding, configuration, generated-binding parity, and (later) contract tests. |

Reserved directories are tracked with a `.gitkeep` placeholder. They are
registered in `scripts/ci/test-suites.json` with `emptyPolicy: "allow"` and a
written reason, so an empty reserved suite is reported as `declared-empty`
instead of passing silently. Once a reserved directory receives its first test,
its suite switches to `emptyPolicy: "fail"` so a later accidental deletion is a
CI violation.

## Commands

```bash
npm test                 # every vitest suite
npm run test:unit        # tests/frontend
npm run test:chemistry   # tests/chemistry
npm run test:ci          # tests/ci
npm run ci:suites        # all registered suites, including pytest suites
npm run catalog:validate # canonical catalog schema, invariants, and digest
npm run catalog:bindings:check # frontend/backend generated binding parity
```

Python suites use the backend environment interpreter
(`backend/.venv`), or `ATOMVERSE_PYTHON` when set:

```bash
backend/.venv/Scripts/python -m pytest tests -ra --strict-markers   # repository safety
cd backend && .venv/Scripts/python -m pytest                        # backend suite
```
