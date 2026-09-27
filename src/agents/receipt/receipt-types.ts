/**
 * Run receipt types (spec: docs/specs/run-receipt-v0.md).
 * Shared by the writer, verifier and viewer.
 */

export const RECEIPT_VERSION = '0';
/** `prev` of the first event: 64 zeros. */
export const GENESIS_HASH = '0'.repeat(64);

export interface RunStartData {
  goal: string;
  verifyCommand: string;
  repoHead: string | null;
  branch: string;
  tool: { name: string; version: string };
}
export interface AttemptStartData {
  attempt: number;
  model?: string;
}
export interface ToolCallData {
  attempt: number;
  name: string;
  argsSummary: string;
  redacted: boolean;
  durationMs: number;
  ok: boolean;
}
export type FileChangeKind = 'created' | 'modified' | 'deleted';
export interface FileChangeData {
  path: string;
  status: FileChangeKind;
  beforeSha256: string | null;
  afterSha256: string | null;
  diffSha256: string;
  diff?: string;
  diffTruncated?: boolean;
}
export interface VerifierResultData {
  attempt: number;
  command: string;
  exitCode: number | null;
  passed: boolean;
  output: string;
  failureScore: number;
  durationMs?: number;
  timedOut?: boolean;
}
export interface UsageData {
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  model?: string;
}
export interface RollbackData {
  attempt: number;
  reason: string;
}
export type ReceiptOutcome = 'verified' | 'improved' | 'unchanged' | 'worse' | 'agent_error';
export interface AttemptEndData {
  attempt: number;
  outcome: ReceiptOutcome;
  rolledBack: boolean;
}
export interface RunEndData {
  stopReason: string;
  verified: boolean;
  totals: { attempts: number; totalTokens: number; costUsd: number; filesChanged: number };
}

export interface ReceiptDataMap {
  run_start: RunStartData;
  attempt_start: AttemptStartData;
  tool_call: ToolCallData;
  file_change: FileChangeData;
  verifier_result: VerifierResultData;
  usage: UsageData;
  rollback: RollbackData;
  attempt_end: AttemptEndData;
  run_end: RunEndData;
}

export type ReceiptEventType = keyof ReceiptDataMap;

export const RECEIPT_EVENT_TYPES: readonly ReceiptEventType[] = [
  'run_start',
  'attempt_start',
  'tool_call',
  'file_change',
  'verifier_result',
  'usage',
  'rollback',
  'attempt_end',
  'run_end',
];

export interface ReceiptSignature {
  alg: 'ed25519';
  /** base64 SPKI DER */
  publicKey: string;
  /** base64 Ed25519 signature over the UTF-8 bytes of the run_end hash */
  sig: string;
}

interface EventBase {
  v: typeof RECEIPT_VERSION;
  seq: number;
  ts: string;
  prev: string;
  hash: string;
}

export type ReceiptEvent = {
  [K in ReceiptEventType]: EventBase & {
    type: K;
    data: ReceiptDataMap[K];
    signature?: ReceiptSignature;
  };
}[ReceiptEventType];

/** Anything that can record receipt events. runVerifiedGoal only needs this. */
export interface ReceiptSink {
  append<K extends ReceiptEventType>(type: K, data: ReceiptDataMap[K]): ReceiptEvent;
}

export type VerifyFailureReason =
  | 'unreadable'
  | 'empty'
  | 'invalid_json'
  | 'invalid_event'
  | 'seq_mismatch'
  | 'prev_mismatch'
  | 'hash_mismatch'
  | 'bad_first_event'
  | 'event_after_run_end'
  | 'truncated'
  | 'bad_signature'
  | 'unsigned'
  | 'untrusted_key';

export interface SignatureStatus {
  present: boolean;
  valid?: boolean;
  publicKey?: string;
}

export interface VerifyResult {
  ok: boolean;
  eventCount: number;
  /** seq of the first bad event, or the seq where an event was expected (truncation) */
  firstBadSeq?: number;
  reason?: VerifyFailureReason;
  message: string;
  signature: SignatureStatus;
  /** Hash of the last event read, when the chain was readable that far */
  lastHash?: string;
}
