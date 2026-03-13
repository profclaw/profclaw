/**
 * Test Run Tool
 *
 * Structured test runner with auto-detection and parsed output.
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';
import { logger } from '../../../utils/logger.js';

// Schema

const TestRunParamsSchema = z.object({
  command: z.string().optional().describe('Test command override (auto-detected if omitted)'),
  file: z.string().optional().describe('Specific test file to run'),
  grep: z.string().optional().describe('Filter by test name pattern'),
  coverage: z.boolean().optional().default(false).describe('Enable coverage reporting'),
});

export type TestRunParams = z.infer<typeof TestRunParamsSchema>;

// Constants

const TEST_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_OUTPUT_CHARS = 200_000;

// Tool Definition

export const testRunTool: ToolDefinition<TestRunParams, TestRunResult> = {
  name: 'test_run',
  description: `Run tests with structured output. Auto-detects the test framework (vitest, jest, pytest, go test, etc.) from project config.
Returns parsed results: pass/fail/skip counts, failure details with file:line locations.
Optionally filter by file or test name pattern.`,
  category: 'execution',
  securityLevel: 'moderate',
  allowedHosts: ['sandbox', 'gateway', 'local'],
  parameters: TestRunParamsSchema,
  examples: [
    { description: 'Run all tests', params: {} },
    { description: 'Run a specific file', params: { file: 'src/utils.test.ts' } },
    { description: 'Run tests matching pattern', params: { grep: 'auth' } },
    { description: 'Run with coverage', params: { coverage: true } },
  ],

  async execute(context: ToolExecutionContext, params: TestRunParams): Promise<ToolResult<TestRunResult>> {
    try {
      const framework = params.command
        ? await detectFramework(context.workdir).catch(() => ({
            name: 'manual',
            runner: 'manual',
            args: [],
          }))
        : await detectFramework(context.workdir);
      const command = params.command ?? buildTestCommand(framework, params);

      logger.debug(`[TestRun] Running: ${command} (framework: ${framework.name})`, { component: 'TestRun' });

      const rawOutput = await runCommand(command, context.workdir);
      const parsed = parseTestOutput(rawOutput, framework);

      const summary = [
        `Framework: ${framework.name}`,
        `Results: ${parsed.passed} passed, ${parsed.failed} failed, ${parsed.skipped} skipped (${parsed.total} total)`,
      ];

      if (parsed.failures.length > 0) {
        summary.push('', 'Failures:');
        for (const f of parsed.failures) {
          const location = f.file ? `  ${f.file}${f.line ? `:${f.line}` : ''}` : '';
          summary.push(`  - ${f.name}${location}`);
          if (f.message) summary.push(`    ${f.message}`);
        }
      }

      if (parsed.coverage !== undefined) {
        summary.push(`\nCoverage: ${parsed.coverage}%`);
      }

      const output = summary.join('\n');

      return {
        success: parsed.failed === 0,
        data: parsed,
        output: parsed.failed === 0
          ? output
          : `${output}\n\n--- Raw Output ---\n${rawOutput.slice(-5000)}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: { code: 'TEST_ERROR', message: `Test execution failed: ${message}` },
      };
    }
  },
};

// Framework Detection

interface TestFramework {
  name: string;
  runner: string;
  args: string[];
  env?: Record<string, string>;
}

async function detectFramework(workdir: string): Promise<TestFramework> {
  // Check package.json for Node.js projects
  try {
    const pkgPath = path.join(workdir, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;

    // Detect package manager
    const pm = await detectPackageManager(workdir);

    if (devDeps.vitest || deps.vitest) {
      return { name: 'vitest', runner: pm, args: ['test', '--reporter=verbose'] };
    }
    if (devDeps.jest || deps.jest) {
      return { name: 'jest', runner: pm, args: ['test', '--', '--verbose'] };
    }
    if (scripts.test) {
      return { name: 'npm-script', runner: pm, args: ['test'] };
    }
  } catch {
    // Not a Node.js project
  }

  // Check for Python
  try {
    await fs.access(path.join(workdir, 'pyproject.toml'));
    return { name: 'pytest', runner: 'python', args: ['-m', 'pytest', '-v'] };
  } catch {
    // Not a Python project
  }

  try {
    await fs.access(path.join(workdir, 'setup.py'));
    return { name: 'pytest', runner: 'python', args: ['-m', 'pytest', '-v'] };
  } catch {
    // Not a Python project
  }

  // Check for Go
  try {
    await fs.access(path.join(workdir, 'go.mod'));
    return { name: 'go-test', runner: 'go', args: ['test', '-v', './...'] };
  } catch {
    // Not a Go project
  }

  // Check for Rust
  try {
    await fs.access(path.join(workdir, 'Cargo.toml'));
    return { name: 'cargo-test', runner: 'cargo', args: ['test'] };
  } catch {
    // Not a Rust project
  }

  // Check for Makefile with test target
  try {
    const makefile = await fs.readFile(path.join(workdir, 'Makefile'), 'utf-8');
    if (makefile.includes('test:')) {
      return { name: 'make', runner: 'make', args: ['test'] };
    }
  } catch {
    // No Makefile
  }

  throw new Error('Could not detect test framework. Specify a command manually with the "command" parameter.');
}

async function detectPackageManager(workdir: string): Promise<string> {
  try {
    await fs.access(path.join(workdir, 'pnpm-lock.yaml'));
    return 'pnpm';
  } catch {
    // Not pnpm
  }
  try {
    await fs.access(path.join(workdir, 'yarn.lock'));
    return 'yarn';
  } catch {
    // Not yarn
  }
  try {
    await fs.access(path.join(workdir, 'bun.lockb'));
    return 'bun';
  } catch {
    // Not bun
  }
  return 'npm';
}

// Command Building

function buildTestCommand(framework: TestFramework, params: TestRunParams): string {
  const args = [...framework.args];

  if (params.file) {
    if (framework.name === 'vitest' || framework.name === 'jest') {
      args.push(params.file);
    } else if (framework.name === 'pytest') {
      args.push(params.file);
    } else if (framework.name === 'go-test') {
      // Replace ./... with specific package
      const idx = args.indexOf('./...');
      if (idx !== -1) args[idx] = `./${path.dirname(params.file)}/...`;
    } else {
      args.push(params.file);
    }
  }

  if (params.grep) {
    if (framework.name === 'vitest' || framework.name === 'jest') {
      args.push('-t', params.grep);
    } else if (framework.name === 'pytest') {
      args.push('-k', params.grep);
    } else if (framework.name === 'go-test') {
      args.push('-run', params.grep);
    }
  }

  if (params.coverage) {
    if (framework.name === 'vitest') {
      args.push('--coverage');
    } else if (framework.name === 'jest') {
      args.push('--coverage');
    } else if (framework.name === 'pytest') {
      args.push('--cov');
    } else if (framework.name === 'go-test') {
      args.push('-cover');
    }
  }

  return `${framework.runner} ${args.join(' ')}`;
}

// Command Execution

function runCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('/bin/bash', ['-c', command], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    let output = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Test command timed out after ${TEST_TIMEOUT_MS / 1000}s`));
    }, TEST_TIMEOUT_MS);

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.on('close', (_code) => {
      clearTimeout(timeout);
      // Tests can exit non-zero on failure, that's expected
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(-MAX_OUTPUT_CHARS);
      }
      resolve(output);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Output Parsing

function parseTestOutput(output: string, framework: TestFramework): TestRunResult {
  const result: TestRunResult = {
    framework: framework.name,
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    failures: [],
    duration_ms: 0,
  };

  if (framework.name === 'vitest' || framework.name === 'jest') {
    parseNodeTestOutput(output, result);
  } else if (framework.name === 'pytest') {
    parsePytestOutput(output, result);
  } else if (framework.name === 'go-test') {
    parseGoTestOutput(output, result);
  } else {
    // Generic: try to extract counts from common patterns
    parseGenericOutput(output, result);
  }

  result.total = result.passed + result.failed + result.skipped;
  return result;
}

function parseNodeTestOutput(output: string, result: TestRunResult): void {
  // Vitest/Jest summary line: "Tests: 3 passed, 1 failed, 4 total" or "Test Suites: ..."
  const testSummary = output.match(/Tests?\s*:?\s*(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i);
  if (testSummary) {
    result.failed = parseInt(testSummary[1] ?? '0', 10);
    result.skipped = parseInt(testSummary[2] ?? '0', 10);
    result.passed = parseInt(testSummary[3] ?? '0', 10);
  }

  // Duration
  const duration = output.match(/(?:Time|Duration)[:\s]+([0-9.]+)\s*(s|ms|m)/i);
  if (duration) {
    const value = parseFloat(duration[1]);
    const unit = duration[2];
    result.duration_ms = unit === 'ms' ? value : unit === 'm' ? value * 60000 : value * 1000;
  }

  // Parse individual failures
  const failPattern = /(?:FAIL|x)\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/gm;
  let match: RegExpExecArray | null;
  while ((match = failPattern.exec(output)) !== null) {
    const rawName = match[1].trim();
    const vitestStyleFailure = rawName.match(/^(\S+\.(?:test|spec)\.\w+)\s*>\s*(.+)$/);

    if (vitestStyleFailure) {
      result.failures.push({
        name: vitestStyleFailure[2].trim(),
        file: vitestStyleFailure[1],
      });
      continue;
    }

    result.failures.push({ name: rawName });
  }

  // Parse vitest-style failure blocks
  const vitestFailPattern = /(?:FAIL\s+)?(\S+\.(?:test|spec)\.\w+)\s*>\s*(.+?)$/gm;
  while ((match = vitestFailPattern.exec(output)) !== null) {
    const file = match[1];
    const name = match[2].trim();
    const existing = result.failures.find(
      (f) =>
        (f.name === name && (!f.file || f.file === file)) ||
        f.name === `${file} > ${name}`
    );
    if (!existing) {
      result.failures.push({ name, file });
    } else {
      existing.name = name;
      existing.file = file;
    }
  }

  // Coverage percentage
  const coverageMatch = output.match(/All files\s*\|\s*([0-9.]+)/);
  if (coverageMatch) {
    result.coverage = parseFloat(coverageMatch[1]);
  }
}

function parsePytestOutput(output: string, result: TestRunResult): void {
  // Pytest summary: "3 passed, 1 failed, 2 skipped"
  const passed = output.match(/(\d+)\s+passed/);
  const failed = output.match(/(\d+)\s+failed/);
  const skipped = output.match(/(\d+)\s+skipped/);

  if (passed) result.passed = parseInt(passed[1], 10);
  if (failed) result.failed = parseInt(failed[1], 10);
  if (skipped) result.skipped = parseInt(skipped[1], 10);

  // Duration
  const duration = output.match(/in\s+([0-9.]+)s/);
  if (duration) result.duration_ms = parseFloat(duration[1]) * 1000;

  // Parse failures: "FAILED tests/test_foo.py::test_bar"
  const failPattern = /FAILED\s+(\S+?)::(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = failPattern.exec(output)) !== null) {
    result.failures.push({ name: match[2], file: match[1] });
  }
}

function parseGoTestOutput(output: string, result: TestRunResult): void {
  const passPattern = /--- PASS:\s+(\S+)/g;
  const failPattern = /--- FAIL:\s+(\S+)/g;
  const skipPattern = /--- SKIP:\s+(\S+)/g;

  let match: RegExpExecArray | null;
  while ((match = passPattern.exec(output)) !== null) result.passed++;
  while ((match = failPattern.exec(output)) !== null) {
    result.failed++;
    result.failures.push({ name: match[1] });
  }
  while ((match = skipPattern.exec(output)) !== null) result.skipped++;

  // Go test file:line in failure output
  const locationPattern = /(\S+_test\.go):(\d+):/g;
  let locIdx = 0;
  while ((match = locationPattern.exec(output)) !== null) {
    if (locIdx < result.failures.length) {
      result.failures[locIdx].file = match[1];
      result.failures[locIdx].line = parseInt(match[2], 10);
      locIdx++;
    }
  }
}

function parseGenericOutput(output: string, result: TestRunResult): void {
  // Try common patterns
  const passed = output.match(/(\d+)\s+(?:pass(?:ed|ing)?|ok|success)/i);
  const failed = output.match(/(\d+)\s+(?:fail(?:ed|ing|ure)?|error)/i);
  const skipped = output.match(/(\d+)\s+(?:skip(?:ped)?|pending|todo)/i);

  if (passed) result.passed = parseInt(passed[1], 10);
  if (failed) result.failed = parseInt(failed[1], 10);
  if (skipped) result.skipped = parseInt(skipped[1], 10);
}

// Types

export interface TestFailure {
  name: string;
  file?: string;
  line?: number;
  message?: string;
}

export interface TestRunResult {
  framework: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  failures: TestFailure[];
  duration_ms: number;
  coverage?: number;
}
