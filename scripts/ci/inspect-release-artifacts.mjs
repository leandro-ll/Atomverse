/**
 * CI artifact inspection.
 *
 * Classifies every file in the built payload against the release-manifest
 * policy and re-checks that the sensitive local paths (secrets, caches,
 * bytecode, local metadata, semantic-review output, unapproved media) remain
 * excluded. Exits non-zero on any violation; prints a JSON summary with paths
 * only, never file contents.
 */

import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  inspectLocalExclusions,
  inspectManifest,
  listPayloadFiles,
  loadPolicy,
  validatePolicy,
} from './release-manifest-policy.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function inspectReleaseArtifacts(rootDirectory) {
  const policy = await loadPolicy();
  const policyViolations = validatePolicy(policy).map((message) => ({
    type: 'invalid-policy',
    path: 'scripts/ci/release-manifest-policy.json',
    category: 'policy',
    ruleId: null,
    reason: message,
  }));

  const payloadDirectory = resolve(rootDirectory, policy.payloadRoot);
  if (!(await exists(payloadDirectory))) {
    throw new Error(`Release payload "${policy.payloadRoot}" is missing. Run "npm run build" before artifact inspection.`);
  }

  const payloadFiles = await listPayloadFiles(payloadDirectory);
  const manifest = inspectManifest(payloadFiles, policy);
  const localExclusions = inspectLocalExclusions(policy);

  const presentSensitivePaths = [];
  for (const target of policy.localExclusionTargets) {
    if (await exists(resolve(rootDirectory, target.path))) presentSensitivePaths.push(target.path);
  }

  return {
    policyVersion: policy.policyVersion,
    payloadRoot: policy.payloadRoot,
    payloadFiles: payloadFiles.length,
    included: manifest.included,
    excludedFromPayload: manifest.excluded,
    unclassified: manifest.unclassified,
    sensitivePathsChecked: localExclusions.checked.length,
    sensitivePathsPresentLocally: presentSensitivePaths,
    violations: [...policyViolations, ...manifest.violations, ...localExclusions.violations],
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const report = await inspectReleaseArtifacts(rootDirectory);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.violations.length > 0) {
    process.stderr.write(`Release artifact inspection failed with ${report.violations.length} violation(s).\n`);
    process.exitCode = 1;
  }
}
