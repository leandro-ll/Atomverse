# CI scaffolding

Baseline continuous-integration entry points. Everything here is read-only with
respect to the repository: nothing stages, rewrites, or deletes files.

| File | Purpose |
| --- | --- |
| `test-suites.json` | Registry of test suites, their commands, include globs, and explicit empty-suite policy. |
| `test-suite-registry.mjs` | Pure registry validation, empty-suite resolution, and exit-code interpretation. |
| `run-test-suites.mjs` | Resolves and runs the registered suites (`--dry-run` prints the plan only). |
| `release-manifest-policy.json` | Allow/deny policy and required-asset list for the release manifest. |
| `release-manifest-policy.mjs` | Pure path classification and manifest inspection. |
| `inspect-release-artifacts.mjs` | Classifies the built payload and re-checks sensitive local exclusions. |

## Commands

```bash
npm run ci:suites -- --dry-run   # resolution plan, no suite execution
npm run ci:suites                # run every non-empty registered suite
npm run build && npm run ci:artifacts
npm run ci:baseline              # catalog validation, binding parity, suites, artifact inspection
```

## Empty-suite handling

A suite that matches zero test files is never silently successful:

- `emptyPolicy: "fail"` reports an `empty-suite` violation and the run exits non-zero.
- `emptyPolicy: "allow"` requires a written `emptyReason`, reports the suite as
  `declared-empty`, and never invokes the command.
- `pytest` exit code 5 ("no tests collected") maps to the `empty` outcome, not `passed`.

## Release-manifest policy

Deny rules are evaluated before allow rules, and any path matching neither is
reported as `unclassified` so the policy fails closed. Denied categories cover
secrets, caches, Python bytecode, local metadata (`.vercel`, `.git`, `.kiro`,
editor state), logs, source maps, semantic-review output, and unapproved media.
`requirements` lists the runtime assets that must be present, so required assets
are included deliberately rather than by accident.
