# Run Receipt, version 0

A run receipt is a portable, tamper-evident record of what an agent run did. Any harness can emit it and any tool can verify it. This document is the whole spec. The machine-readable schema is `run-receipt-v0.schema.json`. The reference implementation lives in `src/agents/receipt/`.

Keywords MUST, SHOULD and MAY are used in the RFC 2119 sense.

## 1. File format

JSON Lines, UTF-8, one event per line, `\n` separated. A receipt is a sequence of events with `seq` 0, 1, 2, ... in file order. The conventional file name is `receipt.jsonl`.

A complete receipt starts with a `run_start` event and ends with exactly one `run_end` event. A receipt without a final `run_end` is treated as truncated.

## 2. Event envelope

Every event is a JSON object with these members:

| Member | Type | Meaning |
| --- | --- | --- |
| `v` | string | Spec version. Always `"0"` in this version. |
| `seq` | integer | 0-based position in the chain. |
| `ts` | string | ISO 8601 UTC time the event was recorded. |
| `type` | string | One of the event types in section 4. |
| `data` | object | Type specific payload. |
| `prev` | string | `hash` of the previous event. 64 zeros (`"0"` x 64) for `seq` 0. |
| `hash` | string | Lowercase hex SHA-256 of the canonical JSON of this event without `hash` and `signature` (section 3). |

Only `run_end` MAY carry a further member, `signature` (section 5).

## 3. Canonical JSON and hashing

To compute `hash` of an event:

1. Take the event object and remove `hash` and `signature`.
2. Serialize it as canonical JSON: no insignificant whitespace, object keys sorted by Unicode code point at every depth, arrays in order, strings and numbers as produced by ECMAScript `JSON.stringify`. Writers MUST NOT emit non-finite numbers, and SHOULD keep numbers to integers and plain decimals. Members whose value would be `undefined` are omitted; `null` is kept.
3. Encode as UTF-8 and take SHA-256. Write it as 64 lowercase hex characters.

The file line for an event is its canonical JSON with `hash` (and `signature`, if any) added back. Verifiers MUST NOT rely on line text, only on the parsed object and the recomputation above.

## 4. Event types

Unless noted, listed members are required. `?` marks optional members.

- `run_start`: `goal` (string), `verifyCommand` (string), `repoHead` (string or null, commit the run started from), `branch` (string), `tool` (`{name, version}` strings).
- `attempt_start`: `attempt` (integer, 1-based), `model?` (string, when known to the harness at that point).
- `tool_call`: `attempt` (integer), `name` (string), `argsSummary` (string, truncated), `redacted` (boolean, true if redaction changed anything in this event), `durationMs` (number), `ok` (boolean).
- `file_change`: `path` (string, relative to the workspace), `status` (`created`, `modified` or `deleted`), `beforeSha256` (string or null), `afterSha256` (string or null), `diffSha256` (string, SHA-256 of the unified diff text, always present), `diff?` (string, unified diff; may be omitted when large), `diffTruncated?` (boolean).
- `verifier_result`: `attempt` (integer, 0 means the baseline run before any attempt), `command` (string), `exitCode` (integer or null), `passed` (boolean), `output` (string, trimmed), `failureScore` (number, lower is better), `durationMs?` (number), `timedOut?` (boolean).
- `usage`: `attempt` (integer), `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalTokens` (non-negative integers), `costUsd` (number), `model?` (string).
- `rollback`: `attempt` (integer), `reason` (string).
- `attempt_end`: `attempt` (integer), `outcome` (string: `verified`, `improved`, `unchanged`, `worse`, `agent_error`), `rolledBack` (boolean).
- `run_end`: `stopReason` (string), `verified` (boolean), `totals` (`{attempts, totalTokens, costUsd, filesChanged}`).

Unknown event types and unknown members inside `data` MUST NOT break chain verification (they are hashed like anything else), so later versions can extend the format. Files with `v` other than `"0"` are outside this spec.

A run's events are recorded in the order they happened. `file_change` events describe the final state of the workspace and appear after the last attempt, before `run_end`.

## 5. Optional signature

Receipts are unsigned by default. A signer adds a `signature` member to the final `run_end` event:

```json
"signature": { "alg": "ed25519", "publicKey": "<base64 SPKI DER>", "sig": "<base64>" }
```

`sig` is an Ed25519 signature over the UTF-8 bytes of the `run_end` event's `hash` string (the last hash of the chain). The public key is embedded so a receipt is self-contained. Because the signature is not part of the hash input, signing does not change the chain. Since each hash covers the previous one, the signature commits to the whole chain.

A verifier that only reads the embedded key learns that the receipt is internally consistent and signed by whoever holds that key. To learn that it was signed by a key you trust, compare `publicKey` against a key you obtained separately (the reference verifier accepts an expected public key).

## 6. Redaction

Writers MUST redact secrets before hashing, so the chain covers the redacted text and a receipt is safe to share. The reference writer replaces common token shapes (provider API keys, GitHub and Slack tokens, AWS access key ids, JWTs, `Bearer` values, PEM private key blocks) and the values of env-style `NAME=value` pairs whose name contains KEY, TOKEN, SECRET, PASSWORD or CREDENTIAL, plus values under object keys with such names, with `[REDACTED]`. This is pattern based and best effort. It will miss secrets with unusual shapes, so treat receipts as sensitive until reviewed.

## 7. Verification

A verifier reads events in order and checks, for each line: it parses as a JSON object; `seq` equals its 0-based index; `prev` equals the previous event's `hash` (zeros for the first); `hash` equals the recomputed hash. It then checks the receipt is complete: the first event is `run_start`, the last is `run_end`, and no event follows `run_end`. If a `signature` is present it MUST be valid. The verifier reports the first bad `seq` and the reason.

## 8. Threat model

What the format detects, given a copy of the receipt and no other information:

- Editing any field of any event (the hash no longer matches).
- Reordering events (`seq` and `prev` no longer line up).
- Deleting an event from the middle (`seq` gap, broken `prev`).
- Deleting the tail of a receipt. Chaining alone cannot see this, since the shortened chain is still valid, so a receipt with no final `run_end` is reported as truncated. A run that crashed before writing `run_end` therefore also reads as truncated.
- With a signature: any change at all after signing, including recomputing hashes, unless the attacker has the private key.

What it does NOT do:

- It does not prove the run happened. A fabricated run can be written as a perfectly valid receipt.
- It does not stop a party who controls the whole chain from rewriting it from `seq` 0 with fresh hashes. Hashes are unkeyed. The rewritten file verifies.
- Removing the `signature` from an unsigned-by-policy receipt is undetectable unless the verifier requires a signature.
- It does not authenticate the events' content. The harness reports what it says it did. A dishonest or compromised harness produces a dishonest receipt.
- A signature made with a key stored beside the receipt proves little. Signing with a key held elsewhere (a different machine, an HSM, a CI secret), checked against a pinned public key, raises the bar: the rewriter must also hold that key. Publishing the last hash somewhere append-only (a transparency log, a signed commit, a ticket) gives a similar guarantee without keys.
- Redaction happens before hashing, so redacted text is what is committed. The original secrets cannot be recovered or checked from the receipt.
