/**
 * Release-manifest allow/deny policy evaluation.
 *
 * Decisions are deliberate and total: a path is either included by an allow
 * rule, excluded by a deny rule, or reported as `unclassified` so that unknown
 * content can never reach a release payload by accident.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { matchesAnyPattern, normalizePath } from './path-glob.mjs';

export const POLICY_URL = new URL('./release-manifest-policy.json', import.meta.url);

const INVALID_PATH = {
  id: 'invalid-path',
  category: 'invalid-path',
  reason: 'Path is empty, absolute, or escapes the payload root.',
};

export async function loadPolicy(policyPath = POLICY_URL) {
  return JSON.parse(await readFile(policyPath, 'utf8'));
}

export function validatePolicy(policy) {
  const violations = [];
  if (typeof policy?.policyVersion !== 'string') violations.push('policyVersion must be a string');
  if (policy?.defaultDecision !== 'unclassified') violations.push('defaultDecision must fail closed as "unclassified"');

  const seen = new Set();
  for (const [kind, rules] of [
    ['deny', policy?.deny],
    ['allow', policy?.allow],
  ]) {
    if (!Array.isArray(rules) || rules.length === 0) {
      violations.push(`${kind} rules must be a non-empty array`);
      continue;
    }
    for (const rule of rules) {
      const key = `${kind}:${rule.id}`;
      if (seen.has(key)) violations.push(`duplicate ${kind} rule id: ${rule.id}`);
      seen.add(key);
      if (!rule.id) violations.push(`${kind} rule is missing an id`);
      if (!rule.category) violations.push(`${kind} rule ${rule.id} is missing a category`);
      if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) {
        violations.push(`${kind} rule ${rule.id} must declare at least one pattern`);
      }
      if (!rule.reason) violations.push(`${kind} rule ${rule.id} must document a reason`);
      if (rule.except && !rule.exceptReason) {
        violations.push(`${kind} rule ${rule.id} must document exceptReason for its exceptions`);
      }
    }
  }

  if (!Array.isArray(policy?.requirements) || policy.requirements.length === 0) {
    violations.push('requirements must list the required runtime assets');
  }
  for (const requirement of policy?.requirements ?? []) {
    if (!requirement.pattern) violations.push(`requirement ${requirement.id} is missing a pattern`);
    if (!Number.isInteger(requirement.minimumCount) || requirement.minimumCount < 1) {
      violations.push(`requirement ${requirement.id} must declare a positive minimumCount`);
    }
    if (!requirement.reason) violations.push(`requirement ${requirement.id} must document a reason`);
  }

  if (!Array.isArray(policy?.localExclusionTargets) || policy.localExclusionTargets.length === 0) {
    violations.push('localExclusionTargets must list the sensitive local paths that stay out of payloads');
  }

  return violations;
}

export function classifyPath(candidatePath, policy) {
  const path = normalizePath(candidatePath);
  if (path === '' || path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.split('/').includes('..')) {
    return { path, decision: 'exclude', ruleId: INVALID_PATH.id, category: INVALID_PATH.category, reason: INVALID_PATH.reason };
  }

  for (const rule of policy.deny) {
    if (!matchesAnyPattern(path, rule.patterns)) continue;
    if (matchesAnyPattern(path, rule.except)) continue;
    return { path, decision: 'exclude', ruleId: rule.id, category: rule.category, reason: rule.reason };
  }

  for (const rule of policy.allow) {
    if (!matchesAnyPattern(path, rule.patterns)) continue;
    return { path, decision: 'include', ruleId: rule.id, category: rule.category, reason: rule.reason };
  }

  return {
    path,
    decision: 'unclassified',
    ruleId: null,
    category: 'unclassified',
    reason: 'No allow or deny rule matched; the release policy fails closed.',
  };
}

export function inspectManifest(paths, policy) {
  const classifications = paths.map((path) => classifyPath(path, policy));
  const violations = [];

  for (const item of classifications) {
    if (item.decision === 'exclude') {
      violations.push({ type: 'denied-content', path: item.path, category: item.category, ruleId: item.ruleId, reason: item.reason });
    } else if (item.decision === 'unclassified') {
      violations.push({ type: 'unclassified-path', path: item.path, category: item.category, ruleId: null, reason: item.reason });
    }
  }

  const includedPaths = classifications.filter((item) => item.decision === 'include').map((item) => item.path);
  for (const requirement of policy.requirements) {
    const actual = includedPaths.filter((path) => matchesAnyPattern(path, [requirement.pattern])).length;
    if (actual < requirement.minimumCount) {
      violations.push({
        type: 'missing-required-asset',
        path: requirement.pattern,
        category: 'required-runtime-asset',
        ruleId: requirement.id,
        reason: `${requirement.reason} Expected at least ${requirement.minimumCount}, found ${actual}.`,
      });
    }
  }

  return {
    policyVersion: policy.policyVersion,
    inspected: classifications.length,
    included: includedPaths.length,
    excluded: classifications.filter((item) => item.decision === 'exclude').length,
    unclassified: classifications.filter((item) => item.decision === 'unclassified').length,
    violations,
  };
}

export function inspectLocalExclusions(policy) {
  const checked = policy.localExclusionTargets.map((target) => {
    const classification = classifyPath(target.path, policy);
    return { ...classification, expectedCategory: target.category };
  });

  const violations = checked
    .filter((item) => item.decision !== 'exclude' || item.category !== item.expectedCategory)
    .map((item) => ({
      type: 'sensitive-path-not-excluded',
      path: item.path,
      category: item.category,
      ruleId: item.ruleId,
      reason: `Expected exclusion category "${item.expectedCategory}" but policy returned decision "${item.decision}" with category "${item.category}".`,
    }));

  return { checked, violations };
}

export async function listPayloadFiles(directory) {
  const rootDirectory = resolve(directory);
  const files = [];

  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(normalizePath(absolute.slice(rootDirectory.length + 1)));
    }
  }

  await walk(rootDirectory);
  return files.sort();
}
