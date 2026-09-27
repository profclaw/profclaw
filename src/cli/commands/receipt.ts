/**
 * profclaw receipt: verify, view and key generation for run receipts.
 * Spec: docs/specs/run-receipt-v0.md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { verifyReceiptText, parseReceiptText } from '../../agents/receipt/receipt-verify.js';
import { renderHtml, renderTerminalSummary } from '../../agents/receipt/receipt-view.js';
import { generateKeyPairFiles } from '../../agents/receipt/receipt-cli.js';
import { error, info, success } from '../utils/output.js';

interface VerifyOpts {
  pubkey?: string;
  requireSignature?: boolean;
}
interface ViewOpts {
  html?: string;
}

function readOrExit(file: string): string | null {
  try {
    return readFileSync(file, 'utf-8');
  } catch (err: unknown) {
    error(`Cannot read ${file}: ${err instanceof Error ? err.message : 'unknown error'}`);
    process.exitCode = 1;
    return null;
  }
}

export function receiptCommand(): Command {
  const cmd = new Command('receipt').description('Verify, view and sign tamper-evident run receipts');

  cmd
    .command('verify')
    .description('Check a receipt: exit 0 if intact, 1 if tampered, truncated or invalid')
    .argument('<file>', 'Path to receipt.jsonl')
    .option('--pubkey <file>', 'Trusted Ed25519 public key (PEM); the receipt must be signed by it')
    .option('--require-signature', 'Fail if the receipt is not signed')
    .action((file: string, opts: VerifyOpts) => {
      const text = readOrExit(file);
      if (text === null) return;
      let expectedPublicKey: string | undefined;
      if (opts.pubkey) {
        const key = readOrExit(opts.pubkey);
        if (key === null) return;
        expectedPublicKey = key;
      }
      const result = verifyReceiptText(text, { expectedPublicKey, requireSignature: opts.requireSignature });
      if (result.ok) {
        success(result.message);
        info('This shows the receipt was not altered after it was written. It does not prove the run happened.');
        process.exitCode = 0;
      } else {
        error(`TAMPERED or invalid at seq ${result.firstBadSeq ?? 0} (${result.reason ?? 'unknown'}): ${result.message}`);
        process.exitCode = 1;
      }
    });

  cmd
    .command('view')
    .description('Print a summary, or write a self-contained HTML viewer with --html')
    .argument('<file>', 'Path to receipt.jsonl')
    .option('--html <out>', 'Write a single-file HTML viewer to this path')
    .action((file: string, opts: ViewOpts) => {
      const text = readOrExit(file);
      if (text === null) return;
      const verify = verifyReceiptText(text);
      const events = parseReceiptText(text);
      if (opts.html) {
        writeFileSync(opts.html, renderHtml(events, verify), 'utf-8');
        info(`Wrote ${opts.html}`);
      } else {
        process.stdout.write(renderTerminalSummary(events, verify));
      }
      if (!verify.ok) process.exitCode = 1;
    });

  cmd
    .command('keygen')
    .description('Write an Ed25519 keypair for signing receipts (private key mode 0600)')
    .argument('<dir>', 'Directory to write receipt-key.pem and receipt-key.pub.pem into')
    .action((dir: string) => {
      try {
        const files = generateKeyPairFiles(dir);
        success(`Private key: ${files.privateKeyPath} (keep it off the machine that runs agents if you can)`);
        info(`Public key:  ${files.publicKeyPath}`);
        info('Sign with --sign-key <private key> or env PROFCLAW_RECEIPT_KEY; check with: profclaw receipt verify <file> --pubkey <public key>');
      } catch (err: unknown) {
        error(err instanceof Error ? err.message : 'Key generation failed');
        process.exitCode = 1;
      }
    });

  return cmd;
}
