/**
 * Loader for the shared golden chemistry fixtures in
 * `tests/fixtures/chemistry/`.
 *
 * Fixtures are read from disk rather than imported as modules so the committed
 * bytes are what tests assert against, with no bundler transform in between.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');

export const FIXTURES_DIRECTORY = resolve(repositoryRoot, 'tests', 'fixtures', 'chemistry');

async function loadFixture(name) {
  return JSON.parse(await readFile(resolve(FIXTURES_DIRECTORY, name), 'utf8'));
}

export function loadFormulaCompositionFixture() {
  return loadFixture('formula-composition.json');
}

export function loadReactionBalanceFixture() {
  return loadFixture('reaction-balance.json');
}

export function loadReagentPairKeyFixture() {
  return loadFixture('reagent-pair-keys.json');
}

export function loadDisplayFormattingFixture() {
  return loadFixture('display-formatting.json');
}

export function loadExperimentVectorFixture() {
  return loadFixture('experiment-vectors.json');
}

/** Loads every golden fixture in one call. */
export async function loadChemistryFixtures() {
  const [formulaComposition, reactionBalance, reagentPairKeys, displayFormatting, experimentVectors] =
    await Promise.all([
      loadFormulaCompositionFixture(),
      loadReactionBalanceFixture(),
      loadReagentPairKeyFixture(),
      loadDisplayFormattingFixture(),
      loadExperimentVectorFixture(),
    ]);
  return { formulaComposition, reactionBalance, reagentPairKeys, displayFormatting, experimentVectors };
}
