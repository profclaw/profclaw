/**
 * CLI Init Command
 *
 * Scans the current project directory and generates a `.profclaw/context.md`
 * file describing the tech stack, structure, build/test commands, and conventions.
 *
 * Usage:
 *   profclaw init          # interactive (asks before overwriting)
 *   profclaw init --force  # overwrite without prompting
 */

import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { confirm } from '@inquirer/prompts';
import { success, error, info, spinner } from '../utils/output.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProjectInfo {
  name: string;
  description: string;
  language: string;
  framework: string;
  buildCommand: string;
  testCommand: string;
  devCommand: string;
  keyDirs: Array<{ path: string; purpose: string }>;
  conventions: string[];
  recentActivity: string;
  packageManager: string;
}

// ── Manifest readers ──────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readText(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

// ── Detectors ─────────────────────────────────────────────────────────────────

function detectLanguage(cwd: string): string {
  if (fileExists(path.join(cwd, 'Cargo.toml'))) return 'Rust';
  if (fileExists(path.join(cwd, 'go.mod'))) return 'Go';
  if (fileExists(path.join(cwd, 'pyproject.toml')) || fileExists(path.join(cwd, 'setup.py'))) return 'Python';
  if (fileExists(path.join(cwd, 'tsconfig.json'))) return 'TypeScript';
  if (fileExists(path.join(cwd, 'package.json'))) return 'JavaScript';
  if (fileExists(path.join(cwd, 'pom.xml')) || fileExists(path.join(cwd, 'build.gradle'))) return 'Java';
  if (fileExists(path.join(cwd, 'mix.exs'))) return 'Elixir';
  if (fileExists(path.join(cwd, 'Gemfile'))) return 'Ruby';
  return 'Unknown';
}

function detectPackageManager(cwd: string): string {
  if (fileExists(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fileExists(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fileExists(path.join(cwd, 'bun.lockb'))) return 'bun';
  if (fileExists(path.join(cwd, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function detectFramework(cwd: string, pkg: Record<string, unknown> | null): string {
  const deps = {
    ...(pkg?.dependencies as Record<string, unknown> | undefined ?? {}),
    ...(pkg?.devDependencies as Record<string, unknown> | undefined ?? {}),
  };

  const hasDep = (name: string) => name in deps;

  if (hasDep('next')) return 'Next.js';
  if (hasDep('nuxt')) return 'Nuxt';
  if (hasDep('astro')) return 'Astro';
  if (hasDep('remix')) return 'Remix';
  if (hasDep('@sveltejs/kit')) return 'SvelteKit';
  if (hasDep('svelte')) return 'Svelte';
  if (hasDep('react')) return 'React';
  if (hasDep('vue')) return 'Vue';
  if (hasDep('express')) return 'Express';
  if (hasDep('fastify')) return 'Fastify';
  if (hasDep('hono')) return 'Hono';
  if (hasDep('@nestjs/core')) return 'NestJS';
  if (hasDep('commander')) return 'CLI (commander)';
  if (hasDep('ink')) return 'CLI (ink/TUI)';

  if (fileExists(path.join(cwd, 'pyproject.toml'))) {
    const content = readText(path.join(cwd, 'pyproject.toml')) ?? '';
    if (content.includes('fastapi')) return 'FastAPI';
    if (content.includes('flask')) return 'Flask';
    if (content.includes('django')) return 'Django';
  }

  if (fileExists(path.join(cwd, 'Cargo.toml'))) {
    const content = readText(path.join(cwd, 'Cargo.toml')) ?? '';
    if (content.includes('axum')) return 'Axum';
    if (content.includes('actix-web')) return 'Actix-web';
    if (content.includes('rocket')) return 'Rocket';
  }

  if (fileExists(path.join(cwd, 'go.mod'))) {
    const content = readText(path.join(cwd, 'go.mod')) ?? '';
    if (content.includes('gin-gonic')) return 'Gin';
    if (content.includes('echo')) return 'Echo';
    if (content.includes('fiber')) return 'Fiber';
  }

  return 'None detected';
}

function detectBuildAndTestCommands(
  cwd: string,
  pkg: Record<string, unknown> | null,
  pm: string,
  language: string,
): { build: string; test: string; dev: string } {
  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  const run = (script: string) => `${pm} run ${script}`;

  const build =
    scripts['build'] ? run('build') :
    language === 'Rust' ? 'cargo build --release' :
    language === 'Go' ? 'go build ./...' :
    language === 'Python' ? (fileExists(path.join(cwd, 'pyproject.toml')) ? 'python -m build' : 'python setup.py build') :
    scripts['compile'] ? run('compile') :
    'N/A';

  const test =
    scripts['test'] ? run('test') :
    language === 'Rust' ? 'cargo test' :
    language === 'Go' ? 'go test ./...' :
    language === 'Python' ? 'pytest' :
    scripts['check'] ? run('check') :
    'N/A';

  const dev =
    scripts['dev'] ? run('dev') :
    scripts['start'] ? run('start') :
    scripts['serve'] ? run('serve') :
    'N/A';

  return { build, test, dev };
}

function detectKeyDirs(cwd: string): Array<{ path: string; purpose: string }> {
  const candidates: Array<{ name: string; purpose: string }> = [
    { name: 'src', purpose: 'Source code' },
    { name: 'app', purpose: 'Application code' },
    { name: 'lib', purpose: 'Library / shared utilities' },
    { name: 'packages', purpose: 'Monorepo packages' },
    { name: 'apps', purpose: 'Monorepo applications' },
    { name: 'tests', purpose: 'Test files' },
    { name: 'test', purpose: 'Test files' },
    { name: '__tests__', purpose: 'Jest test files' },
    { name: 'docs', purpose: 'Documentation' },
    { name: 'scripts', purpose: 'Build / utility scripts' },
    { name: 'public', purpose: 'Static assets' },
    { name: 'assets', purpose: 'Static assets' },
    { name: 'api', purpose: 'API layer' },
    { name: 'components', purpose: 'UI components' },
    { name: 'pages', purpose: 'Page components / routes' },
    { name: 'hooks', purpose: 'React hooks' },
    { name: 'services', purpose: 'Service / business logic layer' },
    { name: 'utils', purpose: 'Utility functions' },
    { name: 'config', purpose: 'Configuration files' },
    { name: 'migrations', purpose: 'Database migrations' },
    { name: 'prisma', purpose: 'Prisma schema and migrations' },
    { name: 'drizzle', purpose: 'Drizzle ORM schema' },
    { name: '.github', purpose: 'GitHub Actions / workflows' },
    { name: 'docker', purpose: 'Docker configuration' },
    { name: 'infra', purpose: 'Infrastructure / IaC' },
    { name: 'k8s', purpose: 'Kubernetes manifests' },
  ];

  return candidates
    .filter(c => fileExists(path.join(cwd, c.name)))
    .map(c => ({ path: c.name, purpose: c.purpose }));
}

function detectConventions(cwd: string, pkg: Record<string, unknown> | null): string[] {
  const conventions: string[] = [];

  // Linting
  if (
    fileExists(path.join(cwd, '.eslintrc.js')) ||
    fileExists(path.join(cwd, '.eslintrc.json')) ||
    fileExists(path.join(cwd, 'eslint.config.js')) ||
    fileExists(path.join(cwd, 'eslint.config.ts'))
  ) {
    conventions.push('ESLint for linting');
  }

  if (
    fileExists(path.join(cwd, '.prettierrc')) ||
    fileExists(path.join(cwd, '.prettierrc.json')) ||
    fileExists(path.join(cwd, 'prettier.config.js')) ||
    fileExists(path.join(cwd, 'prettier.config.ts'))
  ) {
    conventions.push('Prettier for formatting');
  }

  if (fileExists(path.join(cwd, 'biome.json')) || fileExists(path.join(cwd, 'biome.jsonc'))) {
    conventions.push('Biome for linting and formatting');
  }

  // Editor config
  if (fileExists(path.join(cwd, '.editorconfig'))) {
    const content = readText(path.join(cwd, '.editorconfig')) ?? '';
    const indentMatch = content.match(/indent_style\s*=\s*(\w+)/);
    const sizeMatch = content.match(/indent_size\s*=\s*(\d+)/);
    if (indentMatch && sizeMatch) {
      conventions.push(`${indentMatch[1] === 'tab' ? 'Tabs' : `${sizeMatch[1]}-space`} indentation (from .editorconfig)`);
    }
  }

  // TypeScript strictness
  if (fileExists(path.join(cwd, 'tsconfig.json'))) {
    const tsconfig = readJson(path.join(cwd, 'tsconfig.json'));
    const co = tsconfig?.compilerOptions as Record<string, unknown> | undefined;
    if (co?.strict === true) conventions.push('TypeScript strict mode enabled');
    if (co?.noUncheckedIndexedAccess === true) conventions.push('noUncheckedIndexedAccess enforced');
  }

  // Git hooks
  if (fileExists(path.join(cwd, '.husky'))) conventions.push('Husky git hooks');

  // Commit conventions
  if (
    fileExists(path.join(cwd, 'commitlint.config.js')) ||
    fileExists(path.join(cwd, 'commitlint.config.ts'))
  ) {
    conventions.push('commitlint for conventional commits');
  }

  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  if (scripts['lint']) conventions.push(`Lint command: \`${scripts['lint']}\``);
  if (scripts['format']) conventions.push(`Format command: \`${scripts['format']}\``);
  if (scripts['typecheck'] || scripts['type-check']) {
    conventions.push(`Type-check command: \`${scripts['typecheck'] ?? scripts['type-check']}\``);
  }

  return conventions;
}

function detectRecentActivity(cwd: string): string {
  try {
    const log = execSync(
      'git log --oneline --no-merges -10',
      { cwd, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (!log) return 'No git history found.';
    return log;
  } catch {
    return 'No git repository or git unavailable.';
  }
}

function extractDescription(
  cwd: string,
  pkg: Record<string, unknown> | null,
): string {
  if (pkg?.description && typeof pkg.description === 'string' && pkg.description.trim()) {
    return pkg.description.trim();
  }

  const readme = readText(path.join(cwd, 'README.md')) ?? readText(path.join(cwd, 'readme.md'));
  if (readme) {
    // Take the first non-heading paragraph (strip markdown headings)
    const lines = readme.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') && trimmed.length > 20) {
        return trimmed.replace(/[*_`]/g, '').slice(0, 200);
      }
    }
  }

  return 'No description found. Add one in README.md or package.json.';
}

// ── Main scan function ────────────────────────────────────────────────────────

async function scanProject(cwd: string): Promise<ProjectInfo> {
  const pkg = readJson(path.join(cwd, 'package.json'));
  const language = detectLanguage(cwd);
  const pm = detectPackageManager(cwd);
  const framework = detectFramework(cwd, pkg);
  const { build, test, dev } = detectBuildAndTestCommands(cwd, pkg, pm, language);
  const keyDirs = detectKeyDirs(cwd);
  const conventions = detectConventions(cwd, pkg);
  const recentActivity = detectRecentActivity(cwd);
  const description = extractDescription(cwd, pkg);
  const name = (pkg?.name as string | undefined) ?? path.basename(cwd);

  return {
    name,
    description,
    language,
    framework,
    buildCommand: build,
    testCommand: test,
    devCommand: dev,
    keyDirs,
    conventions,
    recentActivity,
    packageManager: pm,
  };
}

// ── Context file generator ────────────────────────────────────────────────────

function generateContextMarkdown(info: ProjectInfo): string {
  const now = new Date().toISOString().slice(0, 10);

  const structureLines = info.keyDirs.length > 0
    ? info.keyDirs.map(d => `- \`${d.path}/\` — ${d.purpose}`).join('\n')
    : '- No key directories detected automatically.';

  const conventionLines = info.conventions.length > 0
    ? info.conventions.map(c => `- ${c}`).join('\n')
    : '- No convention files detected.';

  return `# Project Context
> Auto-generated by \`profclaw init\` on ${now}. Edit freely — this file is yours.

## Overview

${info.description}

**Project name:** \`${info.name}\`

## Tech Stack

- **Language:** ${info.language}
- **Framework:** ${info.framework}
- **Package manager:** ${info.packageManager}
- **Build:** \`${info.buildCommand}\`
- **Test:** \`${info.testCommand}\`
- **Dev server:** \`${info.devCommand}\`

## Structure

${structureLines}

## Conventions

${conventionLines}

## Recent Activity

\`\`\`
${info.recentActivity}
\`\`\`
`;
}

// ── Command ───────────────────────────────────────────────────────────────────

export function initCommand(): Command {
  const cmd = new Command('init')
    .description('Scan the project and generate .profclaw/context.md')
    .option('-f, --force', 'Overwrite existing context.md without prompting')
    .option('--dir <path>', 'Project directory to scan (default: cwd)')
    .action(async (options: { force?: boolean; dir?: string }) => {
      const cwd = options.dir ? path.resolve(options.dir) : process.cwd();
      const outputDir = path.join(cwd, '.profclaw');
      const outputPath = path.join(outputDir, 'context.md');

      // Check for existing file
      if (fileExists(outputPath) && !options.force) {
        const overwrite = await confirm({
          message: '.profclaw/context.md already exists. Overwrite?',
          default: false,
        });

        if (!overwrite) {
          info('Aborted. Use --force to overwrite without prompting.');
          return;
        }
      }

      const spin = spinner('Scanning project...').start();

      try {
        const projectInfo = await scanProject(cwd);
        spin.stop();

        const markdown = generateContextMarkdown(projectInfo);

        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(outputPath, markdown, 'utf-8');

        success(`Context written to .profclaw/context.md`);
        console.log('');
        console.log(`  Project : ${projectInfo.name}`);
        console.log(`  Language: ${projectInfo.language}`);
        console.log(`  Framework: ${projectInfo.framework}`);
        console.log(`  Dirs scanned: ${projectInfo.keyDirs.length}`);
        console.log('');
        info('Edit .profclaw/context.md to add your own notes and conventions.');
      } catch (err) {
        spin.stop();
        error(err instanceof Error ? err.message : 'Init failed');
        process.exit(1);
      }
    });

  return cmd;
}
