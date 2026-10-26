import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digestJson } from '../../scripts/catalog/canonical-json.mjs';
import {
  BINDING_CONTRACT_VERSION,
  BINDING_TARGETS,
  buildBindingManifest,
  buildJavaScriptBinding,
  buildPythonBinding,
  buildSupportedDefinitions,
  extractBindingManifest,
} from '../../scripts/catalog/catalog-bindings.mjs';
import {
  CATALOG_PATH,
  DIGEST_PATH,
  JAVASCRIPT_BINDING_PATH,
  JAVASCRIPT_BINDING_RELATIVE_PATH,
  PYTHON_BINDING_PATH,
  PYTHON_BINDING_RELATIVE_PATH,
  SCHEMA_PATH,
  readJsonArtifact,
} from '../../scripts/catalog/catalog-paths.mjs';
import { checkBindingSources, checkCommittedBindings } from '../../scripts/catalog/check-bindings.mjs';
import { generateBindings } from '../../scripts/catalog/generate-bindings.mjs';
import * as frontendBinding from '../../js/generated/chemistry-catalog.js';

const codesOf = (violations) => violations.map((item) => item.code);

/** Walks every node of a parsed JSON value, including the root. */
function* walk(value) {
  yield value;
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item);
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) yield* walk(value[key]);
  }
}

/** Validates: Requirements 1.1, 1.4, 27.6 */
describe('generated chemistry catalog bindings', () => {
  let catalog;
  let schema;
  let committedDigest;
  let committedSources;
  let temporaryDirectory;

  beforeAll(async () => {
    [catalog, schema, committedDigest] = await Promise.all([
      readJsonArtifact(CATALOG_PATH),
      readJsonArtifact(SCHEMA_PATH),
      readJsonArtifact(DIGEST_PATH),
    ]);
    const [javascript, python] = await Promise.all([
      readFile(JAVASCRIPT_BINDING_PATH, 'utf8'),
      readFile(PYTHON_BINDING_PATH, 'utf8'),
    ]);
    committedSources = { javascript, python };
    temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'atomverse-bindings-'));
  });

  afterAll(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const mutate = (change) => {
    const draft = structuredClone(catalog);
    change(draft);
    return draft;
  };

  /**
   * A version that is guaranteed to differ from the committed one, derived from
   * the catalog itself so the divergence survives any future version bump.
   */
  const divergentVersion = () => {
    const [major, ...rest] = String(catalog.catalogVersion).split('.');
    return [Number.parseInt(major, 10) + 1, ...rest].join('.');
  };

  /** Rebuilds both bindings from a different catalog to simulate a diverged pair. */
  const sourcesFrom = (javascriptCatalog, pythonCatalog = javascriptCatalog) => ({
    javascript: buildJavaScriptBinding(javascriptCatalog, schema),
    python: buildPythonBinding(pythonCatalog, schema),
  });

  describe('frontend binding', () => {
    it('serves the committed catalog, version, and digests from the single canonical artifact', () => {
      expect(frontendBinding.CATALOG).toEqual(catalog);
      expect(frontendBinding.CATALOG_VERSION).toBe(catalog.catalogVersion);
      expect(frontendBinding.SCHEMA_VERSION).toBe(catalog.schemaVersion);
      expect(frontendBinding.LOCALE).toBe(catalog.locale);
      expect(frontendBinding.DIGEST_ALGORITHM).toBe(catalog.digest.algorithm);
      expect(frontendBinding.CANONICALIZATION).toBe(catalog.digest.canonicalization);
      expect(frontendBinding.CATALOG_DIGEST).toBe(committedDigest.catalogDigest);
      expect(frontendBinding.SCHEMA_DIGEST).toBe(committedDigest.schemaDigest);
      expect(frontendBinding.CATALOG_DIGEST).toBe(digestJson(catalog));
      expect(frontendBinding.BINDING_CONTRACT_VERSION).toBe(BINDING_CONTRACT_VERSION);
    });

    it('exposes a supported-definition inventory that covers the catalog', () => {
      const definitions = frontendBinding.SUPPORTED_DEFINITIONS;

      expect(definitions.reagentIds).toEqual(Object.keys(catalog.reagents).sort());
      expect(definitions.ionIds).toEqual(Object.keys(catalog.ions).sort());
      expect(definitions.speciesIds).toEqual(Object.keys(catalog.species).sort());
      expect(definitions.reactions.map((reaction) => reaction.pairKey)).toEqual(Object.keys(catalog.reactions).sort());
      expect(definitions.reactions.map((reaction) => reaction.reactionId).sort()).toEqual(
        Object.values(catalog.reactions)
          .map((reaction) => reaction.id)
          .sort(),
      );
      expect(definitions.inverseTargets.map((target) => target.id)).toEqual(Object.keys(catalog.inverseTargets).sort());
      expect(definitions.categories).toEqual([...catalog.model.categories].sort());
      expect(definitions.pHSupportedReactionIds).toEqual([...catalog.model.capabilities.pH.supportedReactionIds].sort());
      expect(definitions.bounds).toEqual(catalog.model.bounds);
      expect(frontendBinding.DEFINITIONS_DIGEST).toBe(digestJson(buildSupportedDefinitions(catalog)));
    });

    it('is deeply read-only so no consumer can mutate shared chemistry data', () => {
      for (const node of walk(frontendBinding.CATALOG)) {
        if (node !== null && typeof node === 'object') expect(Object.isFrozen(node)).toBe(true);
      }
      expect(Object.isFrozen(frontendBinding.SUPPORTED_DEFINITIONS)).toBe(true);
      expect(Object.isFrozen(frontendBinding.BINDING_CONTRACT)).toBe(true);

      expect(() => {
        frontendBinding.CATALOG.reagents.AgNO3.ions[0].multiplicity = 5;
      }).toThrow(TypeError);
      expect(() => {
        frontendBinding.CATALOG.reactions['AgNO3|NaCl'].molecularProducts.push({ speciesId: 'AgI' });
      }).toThrow(TypeError);
      expect(() => {
        delete frontendBinding.CATALOG.species.AgCl;
      }).toThrow(TypeError);
      expect(frontendBinding.CATALOG.reagents.AgNO3.ions[0].multiplicity).toBe(1);
    });
  });

  describe('byte-stable generation', () => {
    it('reproduces identical bytes on repeated regeneration from unchanged artifacts', async () => {
      const paths = {
        javascriptPath: resolve(temporaryDirectory, 'chemistry-catalog.js'),
        pythonPath: resolve(temporaryDirectory, 'chemistry_catalog.py'),
      };

      const first = await generateBindings(paths);
      const firstBytes = {
        javascript: await readFile(paths.javascriptPath, 'utf8'),
        python: await readFile(paths.pythonPath, 'utf8'),
      };
      const second = await generateBindings(paths);
      const secondBytes = {
        javascript: await readFile(paths.javascriptPath, 'utf8'),
        python: await readFile(paths.pythonPath, 'utf8'),
      };

      expect(first.ok).toBe(true);
      expect(first.bindings.map((binding) => binding.written)).toEqual([true, true]);
      expect(second.ok).toBe(true);
      expect(second.bindings.map((binding) => binding.written)).toEqual([false, false]);
      expect(second.bindings.map((binding) => binding.current)).toEqual([true, true]);
      expect(secondBytes).toEqual(firstBytes);
      expect(firstBytes.javascript).toBe(committedSources.javascript);
      expect(firstBytes.python).toBe(committedSources.python);
    });

    it('keeps the committed bindings equal to the bytes the catalog generates', async () => {
      expect(committedSources.javascript).toBe(buildJavaScriptBinding(catalog, schema));
      expect(committedSources.python).toBe(buildPythonBinding(catalog, schema));

      const report = await generateBindings({ check: true });
      expect(report.ok).toBe(true);
      expect(report.bindings.map((binding) => binding.relativePath)).toEqual([
        JAVASCRIPT_BINDING_RELATIVE_PATH,
        PYTHON_BINDING_RELATIVE_PATH,
      ]);
      expect(report.bindings.every((binding) => binding.current && !binding.written)).toBe(true);
    });

    it('generates both bindings from the same manifest', () => {
      const expected = buildBindingManifest(catalog, schema);
      const javascript = extractBindingManifest(committedSources.javascript);
      const python = extractBindingManifest(committedSources.python);

      expect(javascript.value).toEqual(expected);
      expect(python.value).toEqual(expected);
      expect(python.value).toEqual(javascript.value);
      expect(BINDING_TARGETS.map((target) => target.relativePath)).toEqual([
        JAVASCRIPT_BINDING_RELATIVE_PATH,
        PYTHON_BINDING_RELATIVE_PATH,
      ]);
    });
  });

  describe('parity verification', () => {
    it('accepts the committed bindings', async () => {
      const report = await checkCommittedBindings();

      expect(report.violations).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.contract.catalogVersion).toBe(catalog.catalogVersion);
      expect(report.contract.catalogDigest).toBe(committedDigest.catalogDigest);
      expect(report.bindings.every((binding) => binding.present && binding.current)).toBe(true);
    });

    it('fails when a binding embeds a different catalog version', () => {
      const report = checkBindingSources({
        catalog,
        schema,
        sources: sourcesFrom(mutate((draft) => { draft.catalogVersion = divergentVersion(); })),
      });

      expect(report.ok).toBe(false);
      expect(codesOf(report.violations)).toEqual(
        expect.arrayContaining(['CATALOG_VERSION_DIVERGENCE', 'CATALOG_DIGEST_DIVERGENCE', 'BINDING_STALE']),
      );
      for (const relativePath of [JAVASCRIPT_BINDING_RELATIVE_PATH, PYTHON_BINDING_RELATIVE_PATH]) {
        expect(report.violations.some((item) => item.path === relativePath)).toBe(true);
      }
    });

    it('fails when a binding embeds a different catalog digest', () => {
      const report = checkBindingSources({
        catalog,
        schema,
        sources: sourcesFrom(mutate((draft) => { draft.species.AgCl.displayName = 'Perak Klorida (diubah)'; })),
      });

      expect(report.ok).toBe(false);
      const codes = codesOf(report.violations);
      expect(codes).toContain('CATALOG_DIGEST_DIVERGENCE');
      expect(codes).not.toContain('CATALOG_VERSION_DIVERGENCE');
      expect(codes).not.toContain('SUPPORTED_DEFINITIONS_DIVERGENCE');
    });

    it('fails when a binding embeds a different schema digest', () => {
      const otherSchema = structuredClone(schema);
      otherSchema.title = `${otherSchema.title ?? 'schema'} (diubah)`;

      const report = checkBindingSources({
        catalog,
        schema,
        sources: {
          javascript: buildJavaScriptBinding(catalog, otherSchema),
          python: buildPythonBinding(catalog, otherSchema),
        },
      });

      expect(report.ok).toBe(false);
      expect(codesOf(report.violations)).toContain('SCHEMA_DIGEST_DIVERGENCE');
    });

    it('fails when a binding supports a different set of definitions', () => {
      const report = checkBindingSources({
        catalog,
        schema,
        sources: sourcesFrom(
          mutate((draft) => {
            delete draft.reactions['BaCl2|Na2SO4'];
            delete draft.reagents.Na2SO4;
          }),
        ),
      });

      expect(report.ok).toBe(false);
      const definitionFailures = report.violations.filter((item) => item.code === 'SUPPORTED_DEFINITIONS_DIVERGENCE');
      expect(definitionFailures.length).toBeGreaterThan(0);
      expect(definitionFailures.map((item) => item.message).join(' ')).toMatch(/reagentIds|reactions/u);
    });

    it('fails when the two bindings disagree with each other', () => {
      const report = checkBindingSources({
        catalog,
        schema,
        sources: sourcesFrom(catalog, mutate((draft) => { draft.catalogVersion = divergentVersion(); })),
      });

      expect(report.ok).toBe(false);
      expect(codesOf(report.violations)).toContain('BINDING_PAIR_DIVERGENCE');
      const divergence = report.violations.find((item) => item.code === 'BINDING_PAIR_DIVERGENCE');
      expect(divergence.path).toContain(JAVASCRIPT_BINDING_RELATIVE_PATH);
      expect(divergence.path).toContain(PYTHON_BINDING_RELATIVE_PATH);
    });

    it('fails when a binding is hand-edited even if its manifest still matches', () => {
      const report = checkBindingSources({
        catalog,
        schema,
        sources: {
          javascript: `${committedSources.javascript}\nexport const PATCHED = true;\n`,
          python: committedSources.python,
        },
      });

      expect(report.ok).toBe(false);
      expect(codesOf(report.violations)).toEqual(['BINDING_STALE']);
      expect(report.violations[0].path).toBe(JAVASCRIPT_BINDING_RELATIVE_PATH);
    });

    it('fails when a binding is missing or its manifest cannot be read', () => {
      const missing = checkBindingSources({ catalog, schema, sources: { javascript: null, python: committedSources.python } });
      expect(codesOf(missing.violations)).toContain('BINDING_MISSING');

      const stripped = committedSources.python.replaceAll('atomverse:manifest-json', 'atomverse:removed-manifest');
      const unreadable = checkBindingSources({
        catalog,
        schema,
        sources: { javascript: committedSources.javascript, python: stripped },
      });
      expect(codesOf(unreadable.violations)).toEqual(
        expect.arrayContaining(['BINDING_STALE', 'BINDING_MANIFEST_UNREADABLE']),
      );
      expect(unreadable.violations.some((item) => item.code === 'BINDING_PAIR_DIVERGENCE')).toBe(false);
    });
  });
});
