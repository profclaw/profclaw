/**
 * Code Tools
 *
 * Development workflow tools: lint, typecheck, build, format, dependency audit.
 * These complement the existing file-ops, git, and exec tools to enable
 * full coding agent workflows.
 */

import { z } from 'zod';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';

// Helper: run a command and capture output

async function runCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxOutput?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeout = options.timeout || 60000;
  const maxOutput = options.maxOutput || 200000;

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      timeout,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxOutput) stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxOutput) stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

// Detect package manager

function detectPackageManager(cwd: string): 'pnpm' | 'npm' | 'yarn' | 'bun' {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

// Detect project type from package.json

interface ProjectInfo {
  hasTypeScript: boolean;
  hasEslint: boolean;
  hasPrettier: boolean;
  hasBiome: boolean;
  scripts: Record<string, string>;
  packageManager: string;
}

function detectProject(cwd: string): ProjectInfo {
  const pkgPath = join(cwd, 'package.json');
  const info: ProjectInfo = {
    hasTypeScript: existsSync(join(cwd, 'tsconfig.json')),
    hasEslint: existsSync(join(cwd, '.eslintrc.json')) || existsSync(join(cwd, '.eslintrc.js')) || existsSync(join(cwd, 'eslint.config.js')) || existsSync(join(cwd, 'eslint.config.mjs')),
    hasPrettier: existsSync(join(cwd, '.prettierrc')) || existsSync(join(cwd, '.prettierrc.json')) || existsSync(join(cwd, 'prettier.config.js')),
    hasBiome: existsSync(join(cwd, 'biome.json')),
    scripts: {},
    packageManager: detectPackageManager(cwd),
  };

  try {
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      info.scripts = (pkg.scripts || {}) as Record<string, string>;
      const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
      if (deps.typescript) info.hasTypeScript = true;
      if (deps.eslint) info.hasEslint = true;
      if (deps.prettier) info.hasPrettier = true;
      if (deps['@biomejs/biome']) info.hasBiome = true;
    }
  } catch { /* empty */ }

  return info;
}

// === TypeCheck Tool ===

const TypeCheckParams = z.object({
  path: z.string().optional().describe('Specific file or directory to check. Defaults to project root.'),
});

export const typeCheckTool: ToolDefinition<z.infer<typeof TypeCheckParams>, unknown> = {
  name: 'typecheck',
  description: 'Run TypeScript type checking (tsc --noEmit). Reports type errors without compiling. Use after editing TypeScript files.',
  category: 'execution',
  parameters: TypeCheckParams,
  securityLevel: 'safe',
  async execute(context, params) {
    const cwd = params.path ? resolve(context.workdir, params.path) : context.workdir;
    const project = detectProject(cwd);

    if (!project.hasTypeScript) {
      return { success: true, output: 'No tsconfig.json found - not a TypeScript project.' };
    }

    const result = await runCommand('npx', ['tsc', '--noEmit', '--pretty'], { cwd, timeout: 120000 });
    const errors = result.stdout.split('\n').filter((l) => l.includes('error TS')).length;

    if (result.code === 0) {
      return { success: true, output: 'Type check passed - no errors.' };
    }

    return {
      success: false,
      output: `${errors} type error(s) found:\n\n${result.stdout.slice(0, 5000)}`,
      error: { code: 'TYPE_ERRORS', message: `${errors} type error(s)` },
    };
  },
};

// === Lint Tool ===

const LintParams = z.object({
  path: z.string().optional().describe('File or directory to lint. Defaults to project root.'),
  fix: z.boolean().optional().describe('Auto-fix fixable issues.'),
});

export const lintTool: ToolDefinition<z.infer<typeof LintParams>, unknown> = {
  name: 'lint',
  description: 'Run linter (ESLint, Biome, or project lint script). Detects the linter automatically. Use --fix to auto-fix.',
  category: 'execution',
  parameters: LintParams,
  securityLevel: 'safe',
  async execute(context, params) {
    const cwd = context.workdir;
    const project = detectProject(cwd);
    const target = params.path || '.';
    const fixFlag = params.fix ? '--fix' : '';

    // Try project lint script first
    if (project.scripts.lint) {
      const pm = project.packageManager;
      const result = await runCommand(pm, ['run', 'lint', ...(fixFlag ? ['--', fixFlag] : [])], { cwd, timeout: 120000 });
      if (result.code === 0) {
        return { success: true, output: 'Lint passed - no issues.' };
      }
      return {
        success: false,
        output: `Lint issues:\n\n${(result.stdout + result.stderr).slice(0, 5000)}`,
        error: { code: 'LINT_ERRORS', message: 'Lint found issues' },
      };
    }

    // Try Biome
    if (project.hasBiome) {
      const args = params.fix ? ['check', '--write', target] : ['check', target];
      const result = await runCommand('npx', ['@biomejs/biome', ...args], { cwd });
      if (result.code === 0) {
        return { success: true, output: 'Biome check passed.' };
      }
      return {
        success: false,
        output: `Biome issues:\n\n${(result.stdout + result.stderr).slice(0, 5000)}`,
        error: { code: 'LINT_ERRORS', message: 'Biome found issues' },
      };
    }

    // Try ESLint
    if (project.hasEslint) {
      const args = [target, '--format', 'stylish', ...(fixFlag ? [fixFlag] : [])];
      const result = await runCommand('npx', ['eslint', ...args], { cwd });
      if (result.code === 0) {
        return { success: true, output: 'ESLint passed - no issues.' };
      }
      return {
        success: false,
        output: `ESLint issues:\n\n${(result.stdout + result.stderr).slice(0, 5000)}`,
        error: { code: 'LINT_ERRORS', message: 'ESLint found issues' },
      };
    }

    return { success: true, output: 'No linter configured (eslint, biome, or lint script).' };
  },
};

// === Build Tool ===

const BuildParams = z.object({
  script: z.string().optional().describe('Build script name to run. Defaults to "build".'),
});

export const buildTool: ToolDefinition<z.infer<typeof BuildParams>, unknown> = {
  name: 'build',
  description: 'Run the project build command. Auto-detects package manager and build script.',
  category: 'execution',
  parameters: BuildParams,
  securityLevel: 'moderate',
  async execute(context, params) {
    const cwd = context.workdir;
    const project = detectProject(cwd);
    const scriptName = params.script || 'build';

    if (!project.scripts[scriptName]) {
      return {
        success: false,
        output: `No "${scriptName}" script found in package.json. Available scripts: ${Object.keys(project.scripts).join(', ')}`,
        error: { code: 'NO_BUILD_SCRIPT', message: `Script "${scriptName}" not found` },
      };
    }

    const pm = project.packageManager;
    const result = await runCommand(pm, ['run', scriptName], { cwd, timeout: 300000 });

    if (result.code === 0) {
      return { success: true, output: `Build succeeded.\n${result.stdout.slice(-500)}` };
    }

    return {
      success: false,
      output: `Build failed:\n\n${(result.stdout + result.stderr).slice(0, 5000)}`,
      error: { code: 'BUILD_FAILED', message: 'Build failed' },
    };
  },
};

// === Format Tool ===

const FormatParams = z.object({
  path: z.string().optional().describe('File or directory to format. Defaults to current changes.'),
});

export const formatTool: ToolDefinition<z.infer<typeof FormatParams>, unknown> = {
  name: 'format',
  description: 'Auto-format code using Prettier, Biome, or project format script.',
  category: 'execution',
  parameters: FormatParams,
  securityLevel: 'moderate',
  async execute(context, params) {
    const cwd = context.workdir;
    const project = detectProject(cwd);
    const target = params.path || '.';

    if (project.scripts.format) {
      const result = await runCommand(project.packageManager, ['run', 'format'], { cwd });
      return {
        success: result.code === 0,
        output: result.code === 0 ? 'Formatted.' : `Format failed:\n${(result.stdout + result.stderr).slice(0, 2000)}`,
      };
    }

    if (project.hasBiome) {
      const result = await runCommand('npx', ['@biomejs/biome', 'format', '--write', target], { cwd });
      return { success: result.code === 0, output: result.code === 0 ? 'Biome formatted.' : `Biome format failed:\n${result.stderr.slice(0, 2000)}` };
    }

    if (project.hasPrettier) {
      const result = await runCommand('npx', ['prettier', '--write', target], { cwd });
      return { success: result.code === 0, output: result.code === 0 ? 'Prettier formatted.' : `Prettier failed:\n${result.stderr.slice(0, 2000)}` };
    }

    return { success: true, output: 'No formatter configured (prettier, biome, or format script).' };
  },
};

// === Project Info Tool ===

const ProjectInfoParams = z.object({});

export const projectInfoTool: ToolDefinition<z.infer<typeof ProjectInfoParams>, unknown> = {
  name: 'project_info',
  description: 'Detect project type, dependencies, scripts, and tooling. Use to understand the codebase before making changes.',
  category: 'execution',
  parameters: ProjectInfoParams,
  securityLevel: 'safe',
  async execute(context) {
    const cwd = context.workdir;
    const project = detectProject(cwd);

    const lines: string[] = [];
    lines.push(`Package manager: ${project.packageManager}`);
    lines.push(`TypeScript: ${project.hasTypeScript ? 'yes' : 'no'}`);
    lines.push(`Linter: ${project.hasBiome ? 'Biome' : project.hasEslint ? 'ESLint' : 'none'}`);
    lines.push(`Formatter: ${project.hasBiome ? 'Biome' : project.hasPrettier ? 'Prettier' : 'none'}`);

    if (Object.keys(project.scripts).length > 0) {
      lines.push('');
      lines.push('Scripts:');
      for (const [name, cmd] of Object.entries(project.scripts)) {
        lines.push(`  ${name}: ${cmd.slice(0, 80)}`);
      }
    }

    // Check for common config files
    const configs: string[] = [];
    const configFiles = [
      'tsconfig.json', 'package.json', '.eslintrc.json', 'eslint.config.js',
      'biome.json', '.prettierrc', 'vitest.config.ts', 'jest.config.ts',
      'Dockerfile', 'docker-compose.yml', '.github/workflows',
      'CLAUDE.md', 'AGENTS.md', 'README.md',
    ];
    for (const f of configFiles) {
      if (existsSync(join(cwd, f))) configs.push(f);
    }
    if (configs.length > 0) {
      lines.push('');
      lines.push(`Config files: ${configs.join(', ')}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
      data: project,
    };
  },
};

// === Create PR Tool ===

const CreatePrParams = z.object({
  title: z.string().describe('PR title'),
  body: z.string().optional().describe('PR description/body'),
  base: z.string().optional().describe('Base branch (default: main)'),
  draft: z.boolean().optional().describe('Create as draft PR'),
});

export const createPrTool: ToolDefinition<z.infer<typeof CreatePrParams>, unknown> = {
  name: 'create_pr',
  description: 'Create a GitHub Pull Request from the current branch. Requires gh CLI authenticated.',
  category: 'execution',
  parameters: CreatePrParams,
  securityLevel: 'moderate',
  requiresApproval: true,
  async execute(context, params) {
    const cwd = context.workdir;

    // Check gh is available
    const ghCheck = await runCommand('gh', ['auth', 'status'], { cwd, timeout: 5000 });
    if (ghCheck.code !== 0) {
      return {
        success: false,
        output: 'GitHub CLI (gh) is not installed or not authenticated. Run: gh auth login',
        error: { code: 'GH_NOT_CONFIGURED', message: 'gh CLI not available' },
      };
    }

    // Get current branch
    const branchResult = await runCommand('git', ['branch', '--show-current'], { cwd });
    const branch = branchResult.stdout.trim();

    if (!branch || branch === 'main' || branch === 'master') {
      return {
        success: false,
        output: `Cannot create PR from ${branch || 'detached HEAD'}. Create a feature branch first.`,
        error: { code: 'WRONG_BRANCH', message: 'Cannot PR from main/master' },
      };
    }

    // Push branch
    const pushResult = await runCommand('git', ['push', '-u', 'origin', branch], { cwd, timeout: 30000 });
    if (pushResult.code !== 0 && !pushResult.stderr.includes('Everything up-to-date')) {
      return {
        success: false,
        output: `Failed to push branch: ${pushResult.stderr.slice(0, 500)}`,
        error: { code: 'PUSH_FAILED', message: 'git push failed' },
      };
    }

    // Create PR
    const prArgs = ['pr', 'create', '--title', params.title];
    if (params.body) prArgs.push('--body', params.body);
    if (params.base) prArgs.push('--base', params.base);
    if (params.draft) prArgs.push('--draft');

    const prResult = await runCommand('gh', prArgs, { cwd, timeout: 15000 });

    if (prResult.code === 0) {
      const prUrl = prResult.stdout.trim();
      return {
        success: true,
        output: `PR created: ${prUrl}`,
        data: { url: prUrl, branch, title: params.title },
      };
    }

    return {
      success: false,
      output: `Failed to create PR: ${(prResult.stdout + prResult.stderr).slice(0, 1000)}`,
      error: { code: 'PR_CREATE_FAILED', message: 'gh pr create failed' },
    };
  },
};

// Export all

export const codeTools = [
  typeCheckTool,
  lintTool,
  buildTool,
  formatTool,
  projectInfoTool,
  createPrTool,
] as unknown as ToolDefinition[];
