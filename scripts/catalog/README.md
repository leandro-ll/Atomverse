# Catalog validation and digest generation

Scripts that guard the canonical chemistry artifacts in `catalog/`.

| Command | Purpose |
| --- | --- |
| `npm run catalog:validate` | Validates `catalog/chemistry.catalog.json` against its schema, its scientific invariants, and the committed digest. Exits non-zero on any violation. Part of `npm run ci:baseline`. |
| `npm run catalog:digest` | Regenerates `catalog/chemistry.digest.json` from the committed catalog and schema. |
| `npm run catalog:generate` | Regenerates the read-only frontend and backend bindings from the committed catalog and schema. Refuses to run on a catalog that fails validation. |
| `npm run catalog:bindings:check` | Verifies that both committed bindings match the bytes the catalog generates and agree on catalog version, digests, and supported definitions. Exits non-zero on any divergence. Part of `npm run ci:baseline`. |

## Validation layers

`validate-catalog.mjs` reports every layer in one pass so a single run shows all
problems:

1. **Compatibility** — the catalog's schema major version, the schema contract's
   own declared major version, the semantic catalog version, and the declared
   digest metadata. An incompatible schema major version is fatal: validation
   stops with `SCHEMA_MAJOR_INCOMPATIBLE` and a localized (`id-ID`) message
   instead of partially interpreting an artifact it does not understand. That
   message lives in the validator, not in the catalog message bundle, because a
   rejected artifact cannot be trusted to explain its own rejection.
2. **Structure** — JSON Schema 2020-12 execution of
   `catalog/chemistry.schema.json` (ajv), producing `SCHEMA_VIOLATION` entries.
3. **Science and references** (`catalog-invariants.mjs`) — formula composition
   agreement between structural terms, element counts, and the ASCII formula;
   elemental and charge balance of every molecular equation, net ionic equation,
   and reagent dissociation; reference integrity across species, ions, reagents,
   reactions, inverse targets, phases, phase models, and localized messages; and
   normalized, order-independent, unique reaction pair keys.
4. **Digest** — the committed digest artifact must still address exactly these
   bytes.

Every violation carries a stable `code`, a `path`, and a message, so tests and
CI can assert on causes rather than on prose.

## Digest addressing and release immutability

The digest is `sha256` over the canonical form declared by the catalog itself:
UTF-8 JSON with object keys sorted and no insignificant whitespace
(`canonical-json.mjs`). Key order therefore cannot change the digest, while any
field change does.

`catalog/chemistry.digest.json` is written in that same canonical form plus a
trailing newline, so regenerating it from unchanged artifacts reproduces
identical bytes. Because released catalog artifacts are immutable, the generator
refuses to republish an existing `catalogVersion` under a different digest:
bump `catalogVersion` instead, or pass `--allow-rewrite` for a draft that was
never released. Validation reports the same situation as
`RELEASE_IMMUTABILITY_VIOLATION`.

Other flags: `--check` (verify without writing), `--no-digest` (validate the
catalog without comparing the digest artifact), `--json` (machine-readable
report).

## Generated bindings

The frontend and the backend never read the catalog file directly. Each reads a
generated binding:

| Binding | Shape |
| --- | --- |
| `js/generated/chemistry-catalog.js` | ES module; every export is deeply `Object.freeze`d. |
| `backend/app/generated/chemistry_catalog.py` | Module constants; mappings are `MappingProxyType`, sequences are tuples. |

Both embed the catalog payload in canonical JSON form plus a *manifest*:

- `contract` — binding contract version, schema version, catalog version,
  locale, digest metadata, and the catalog, schema, and supported-definition
  digests. This is the digest-addressed identity of one catalog release.
- `supportedDefinitions` — the identity and capability facts both runtimes must
  agree on before either calculates: elements, phases, species, ion, and reagent
  IDs, reaction pair keys with their reaction ID, category, phase model and pH
  support, inverse targets, model categories, phase models, inverse goal kinds,
  pH-supported reactions, input bounds, and message locales. Every list is
  sorted, so the inventory is a pure function of catalog content.

Generation (`generate-bindings.mjs`) is a pure function of the committed catalog
and schema, so regenerating from unchanged artifacts reproduces identical bytes.
It refuses to run when `catalog:validate` fails, because a binding is what every
calculation reads.

`check-bindings.mjs` fails when a binding is missing, when its bytes differ from
what the current catalog regenerates (`BINDING_STALE` — a hand edit or a
left-behind older version), when its embedded contract disagrees with the
committed catalog (`CATALOG_VERSION_DIVERGENCE`, `CATALOG_DIGEST_DIVERGENCE`,
`SCHEMA_DIGEST_DIVERGENCE`, `SUPPORTED_DEFINITIONS_DIVERGENCE`, and friends), or
when the two bindings disagree with each other (`BINDING_PAIR_DIVERGENCE`).

The check reads the bindings as text. It never imports the frontend module and
never starts a Python interpreter, so it reports on exactly the committed bytes,
needs no runtime from either side, and does not execute a file it is inspecting.
The embedded JSON is escaped so that the same literal is valid in JavaScript,
Python, and JSON, which is what lets one textual decoder read both bindings.

Canonical serialization and digest computation stay in this Node toolchain.
Python number formatting differs from JavaScript for exponential values
(`1e-09` versus `1e-9`), so a second canonicalization implementation would drift
from the first; the Python binding embeds the digest instead of recomputing it,
and `backend/tests/test_chemistry_catalog_binding.py` compares that embedded
value against the committed digest artifact. For the same reason the generated
Python file is excluded from `ruff format` (see `backend/pyproject.toml`) while
still passing `ruff check`.

## ASCII formula readings

A trailing charge in plain ASCII is ambiguous: `NO3-` is nitrate with charge -1,
while `Pb2+` is lead(II) with charge +2. The parser returns every consistent
reading and validation requires the declared composition and charge to agree
with one of them. A space before the magnitude (`SO4 2-`) removes the ambiguity;
a malformed formula such as `AgNO` or `Pb(NO)2` matches no reading.
