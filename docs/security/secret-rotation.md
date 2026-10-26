# Credential Rotation and Revocation Record

## Purpose and scope

This runbook records the out-of-band remediation required for credential classes identified by the Atomverse audit. Rotation and revocation happen only in the relevant provider or deployment console and approved server-side secret store. They are never performed through source control.

The record is deliberately value-free. It may contain only non-secret record identifiers, credential classes, non-secret aliases, action/status values, dates, verifier identifiers, and access-controlled evidence identifiers. It must never contain a credential value or any material that could help reconstruct or recognize one.

This runbook covers these audited credential classes:

- AI provider credential, tracked here as alias `AI-PROVIDER-PRIMARY`.
- Vercel deployment credential, tracked here as alias `DEPLOYMENT-VERCEL-PRIMARY`.

The aliases above are documentation labels only. They are not environment-variable names, provider-generated identifiers, fingerprints, or credential fragments.

## Non-disclosure rules

Before updating this file, confirm all of the following:

- Do not open, inspect, copy, print, hash, or otherwise process local credential values for this record.
- Do not record full or partial values, prefixes, suffixes, hashes, fingerprints, recovery codes, authorization headers, cookies, environment-file content, or screenshots containing sensitive data.
- Do not record secret-store paths, console URLs, query strings, raw command output, request/response bodies, or provider error details.
- Use only the non-secret aliases defined in this document. If another credential class is discovered, assign a descriptive alias that is not derived from the credential.
- Store detailed evidence in the approved access-controlled operational system. Record only its opaque, non-secret evidence identifier here.
- If a proposed identifier contains credential material or was derived from a credential, do not add it. Escalate through the security incident process instead.

## Allowed record values

Use these closed values so the record stays reviewable:

- **Action:** `ROTATE_AND_REVOKE`, `REVOKE`, or `NO_ACTION_REQUIRED`.
- **Status:** `NOT_STARTED`, `IN_PROGRESS`, `ROTATED`, `REVOKED`, `VERIFIED`, or `BLOCKED`.
- **Date:** an ISO `YYYY-MM-DD` date or `PENDING`.
- **Verifier ID:** a non-secret organization identifier or `PENDING`; do not use personal contact details.
- **Evidence ID:** an opaque identifier from the approved restricted evidence system or `PENDING`; do not include a URL.

`VERIFIED` is allowed only after the old credential has been made unusable, replacement injection has been verified where required, and rollback checks have passed. `NO_ACTION_REQUIRED` requires owner approval and an evidence identifier.

## Out-of-band checklist

Complete this checklist separately for each record in the verification table.

1. **Assign ownership.** Confirm an authorized owner for the relevant provider console and production secret store. Do not put names, email addresses, or contact details in this file.
2. **Confirm scope in the console.** Using the provider's access-controlled console, identify the credential represented by the documentation alias. Do not compare, export, or paste its value into local tools, tickets, chat, logs, or this repository.
3. **Prepare replacement access.** Create a replacement credential with the least privileges and shortest practical lifetime. Store it directly in the approved server-side secret store; never place it in frontend configuration or source files.
4. **Update deployments.** Point every authorized backend/deployment integration at the replacement through secret-store injection. Keep credential values out of build arguments, artifacts, diagnostics, and browser bundles.
5. **Verify replacement operation.** Perform a bounded service smoke check that reports only success/failure and a correlation or evidence identifier. Do not capture headers, bodies, environment output, or credential-shaped diagnostics.
6. **Revoke the audited credential.** Revoke or delete the superseded credential in the provider console. If immediate revocation is unsafe, set `BLOCKED`, record a non-secret evidence ID, and escalate; do not mark the item verified.
7. **Verify revocation.** Confirm through the provider console that the superseded credential is disabled or absent. When safe, verify that an authentication attempt using the provider's controlled verification mechanism is denied without exposing the old value to logs or command history.
8. **Check all environments.** Confirm production, preview, development, CI, and deployment integrations no longer depend on the superseded credential. Record detailed findings only in the restricted evidence system.
9. **Check rollback safety.** Confirm rollback selects a previously verified frontend/backend/catalog release while retaining the current secret-store injection. A release rollback must not restore a revoked credential or reverse rotation, sanitization, redaction, or abuse controls.
10. **Close the record.** Set the action, status, completion date, verifier ID, and evidence ID. A second authorized reviewer must confirm that this repository record contains metadata only.

## Verification record

The current state is intentionally `NOT_STARTED` until an authorized operator completes the out-of-band console actions. Documentation work alone does not prove rotation or revocation.

| Record ID | Credential class | Non-secret alias | Required action | Status | Completion date | Verifier ID | Evidence ID |
|---|---|---|---|---|---|---|---|
| `ROT-AI-001` | AI provider | `AI-PROVIDER-PRIMARY` | `ROTATE_AND_REVOKE` | `NOT_STARTED` | `PENDING` | `PENDING` | `PENDING` |
| `ROT-DEPLOY-001` | Deployment provider | `DEPLOYMENT-VERCEL-PRIMARY` | `ROTATE_AND_REVOKE` | `NOT_STARTED` | `PENDING` | `PENDING` | `PENDING` |

## Reviewer sign-off

Before changing either row to `VERIFIED`, the reviewer must answer all checks with `YES` in the restricted evidence system. This repository stores only the resulting status metadata.

- Old credential revoked or otherwise made unusable.
- Replacement stored only through approved server-side injection, if replacement is required.
- Authorized services pass bounded smoke checks without sensitive diagnostics.
- Rollback cannot restore the superseded credential.
- No credential value, fragment, hash, fingerprint, secret-store path, URL, personal data, or sensitive evidence was added to source, history, logs, artifacts, or this record.
- Evidence and verifier identifiers are non-secret and resolve only inside the approved access-controlled operational system.

## Incident handling

If credential material is accidentally pasted into this file or any tracked artifact, do not preserve it as evidence and do not repeat it in an issue or chat. Stop publication, notify the security owner through the approved private channel, rotate or revoke the affected credential out of band, and follow the repository-history and artifact-remediation procedure. A normal file deletion does not by itself remediate an exposed credential.