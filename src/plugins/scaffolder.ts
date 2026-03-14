/**
 * Plugin Scaffolder
 *
 * Generates a starter plugin project with the correct structure,
 * types, and boilerplate for profClaw plugin development.
 *
 * Usage:
 *   profclaw plugin create my-plugin --type tool
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Types

export type PluginTemplateType = 'tool' | 'channel' | 'integration' | 'skill';

export interface ScaffoldOptions {
  name: string;
  type: PluginTemplateType;
  description?: string;
  author?: string;
  outputDir?: string;
}

export interface ScaffoldResult {
  success: boolean;
  path: string;
  files: string[];
  error?: string;
}

// Templates

function getPackageJson(opts: ScaffoldOptions): string {
  return JSON.stringify(
    {
      name: `profclaw-plugin-${opts.name}`,
      version: '0.1.0',
      description: opts.description || `A profClaw ${opts.type} plugin`,
      author: opts.author || '',
      license: 'MIT',
      type: 'module',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      files: ['dist'],
      scripts: {
        build: 'tsc',
        dev: 'tsc --watch',
        prepublishOnly: 'npm run build',
      },
      profclaw: {
        main: 'dist/index.js',
        category: opts.type,
        minVersion: '2.0.0',
      },
      keywords: ['profclaw', 'profclaw-plugin', `profclaw-${opts.type}`, opts.name],
      devDependencies: {
        typescript: '^5.7.0',
      },
    },
    null,
    2
  );
}

function getTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        declaration: true,
        outDir: 'dist',
        rootDir: 'src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ['src'],
    },
    null,
    2
  );
}

function getToolTemplate(name: string): string {
  const toolName = name.replace(/-/g, '_');
  return `/**
 * profClaw Plugin: ${name}
 *
 * A custom tool plugin for profClaw.
 */

// Types matching profClaw's plugin SDK
interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author?: string;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface PluginToolDefinition {
  name: string;
  description: string;
  category?: string;
  parameters: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required?: boolean;
    default?: unknown;
  }>;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

// Plugin definition
export default {
  metadata: {
    id: '${name}',
    name: '${name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}',
    description: 'A custom tool plugin',
    category: 'tool',
    version: '0.1.0',
  } satisfies PluginMetadata,

  tools: [
    {
      name: '${toolName}',
      description: 'TODO: Describe what this tool does',
      category: 'custom',
      parameters: {
        input: {
          type: 'string',
          description: 'The input to process',
          required: true,
        },
      },
      async execute(params: Record<string, unknown>): Promise<ToolResult> {
        const input = params.input as string;

        // TODO: Implement your tool logic here
        return {
          success: true,
          data: {
            result: \`Processed: \${input}\`,
          },
        };
      },
    },
  ] satisfies PluginToolDefinition[],

  async onLoad(): Promise<void> {
    console.log('[${name}] Plugin loaded');
  },

  async onUnload(): Promise<void> {
    console.log('[${name}] Plugin unloaded');
  },
};
`;
}

function getSkillTemplate(name: string): string {
  return `---
name: ${name}
description: A custom skill for profClaw
user-invocable: true
---

# ${name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

TODO: Write instructions for how the agent should use this skill.

## When to use

- When the user asks about...
- When the task involves...

## How to use

1. First, ...
2. Then, ...
3. Finally, ...
`;
}

function getIntegrationTemplate(name: string): string {
  return `/**
 * profClaw Plugin: ${name}
 *
 * An integration plugin that connects profClaw to an external service.
 */

interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
}

interface PluginConfig {
  id: string;
  pluginId: string;
  enabled: boolean;
  priority: number;
  settings: Record<string, unknown>;
  credentials?: Record<string, string | undefined>;
}

export default {
  metadata: {
    id: '${name}',
    name: '${name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}',
    description: 'An integration plugin',
    category: 'integration',
    version: '0.1.0',
  } satisfies PluginMetadata,

  settingsSchema: {
    credentials: [
      {
        key: 'apiKey',
        type: 'password' as const,
        label: 'API Key',
        description: 'Your API key for the service',
        required: true,
      },
    ],
    settings: [
      {
        key: 'baseUrl',
        type: 'url' as const,
        label: 'Base URL',
        description: 'The base URL of the service',
        placeholder: 'https://api.example.com',
      },
    ],
  },

  async onLoad(config: PluginConfig): Promise<void> {
    const apiKey = config.credentials?.apiKey;
    if (!apiKey) {
      console.warn('[${name}] No API key configured');
      return;
    }
    console.log('[${name}] Plugin loaded with config');
  },

  async healthCheck(): Promise<{ healthy: boolean; lastCheck: Date; errorMessage?: string }> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  },
};
`;
}

function getChannelTemplate(name: string): string {
  return `/**
 * profClaw Plugin: ${name}
 *
 * A chat channel plugin that adds a new messaging platform.
 */

interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
}

interface MessageContent {
  text: string;
  attachments?: Array<{ type: string; url: string }>;
}

interface IncomingMessage {
  id: string;
  channelId: string;
  userId: string;
  text: string;
  timestamp: Date;
}

export default {
  metadata: {
    id: '${name}',
    name: '${name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}',
    description: 'A custom chat channel plugin',
    category: 'channel',
    version: '0.1.0',
  } satisfies PluginMetadata,

  async sendMessage(channelId: string, content: MessageContent): Promise<void> {
    // TODO: Implement sending messages to your platform
    console.log(\`[${name}] Sending to \${channelId}: \${content.text}\`);
  },

  async handleIncoming(raw: unknown): Promise<IncomingMessage> {
    // TODO: Parse incoming webhook/event from your platform
    const data = raw as Record<string, unknown>;
    return {
      id: String(data.id || Date.now()),
      channelId: String(data.channel || 'default'),
      userId: String(data.user || 'unknown'),
      text: String(data.text || ''),
      timestamp: new Date(),
    };
  },

  isAvailable(): boolean {
    // TODO: Check if the channel is configured
    return true;
  },
};
`;
}

function getReadme(opts: ScaffoldOptions): string {
  return `# profclaw-plugin-${opts.name}

${opts.description || `A profClaw ${opts.type} plugin.`}

## Installation

\`\`\`bash
# From profClaw UI
# Go to Settings > Plugins > Install > Search for "${opts.name}"

# Or via CLI
profclaw plugin install profclaw-plugin-${opts.name}

# Or via npm
npm install profclaw-plugin-${opts.name}
\`\`\`

## Development

\`\`\`bash
npm install
npm run dev     # Watch mode
npm run build   # Build for publishing
\`\`\`

## Publishing

\`\`\`bash
npm publish
\`\`\`

Your plugin will be discoverable in profClaw's marketplace once published to npm
with the \`profclaw-plugin-\` prefix.

## License

MIT
`;
}

function getGitignore(): string {
  return `node_modules/
dist/
*.tsbuildinfo
.env
.env.local
`;
}

// Scaffolder

/**
 * Generate a new plugin project
 */
export function scaffoldPlugin(opts: ScaffoldOptions): ScaffoldResult {
  const dir = opts.outputDir || join(process.cwd(), `profclaw-plugin-${opts.name}`);
  const files: string[] = [];

  try {
    if (existsSync(dir)) {
      return { success: false, path: dir, files, error: `Directory already exists: ${dir}` };
    }

    // Create directories
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });

    // Write package.json
    writeFileSync(join(dir, 'package.json'), getPackageJson(opts));
    files.push('package.json');

    // Write tsconfig.json
    writeFileSync(join(dir, 'tsconfig.json'), getTsConfig());
    files.push('tsconfig.json');

    // Write source file based on type
    let sourceContent: string;
    let sourceFile: string;

    switch (opts.type) {
      case 'tool':
        sourceContent = getToolTemplate(opts.name);
        sourceFile = 'src/index.ts';
        break;
      case 'channel':
        sourceContent = getChannelTemplate(opts.name);
        sourceFile = 'src/index.ts';
        break;
      case 'integration':
        sourceContent = getIntegrationTemplate(opts.name);
        sourceFile = 'src/index.ts';
        break;
      case 'skill': {
        sourceContent = getSkillTemplate(opts.name);
        sourceFile = 'SKILL.md';
        // Skills also get a minimal index.ts
        const skillIndex = `export default { metadata: { id: '${opts.name}', name: '${opts.name}', description: 'Skill plugin', category: 'skill', version: '0.1.0' } };\n`;
        writeFileSync(join(dir, 'src', 'index.ts'), skillIndex);
        files.push('src/index.ts');
        break;
      }
    }

    writeFileSync(join(dir, sourceFile), sourceContent);
    files.push(sourceFile);

    // Write README
    writeFileSync(join(dir, 'README.md'), getReadme(opts));
    files.push('README.md');

    // Write .gitignore
    writeFileSync(join(dir, '.gitignore'), getGitignore());
    files.push('.gitignore');

    return { success: true, path: dir, files };
  } catch (error) {
    return {
      success: false,
      path: dir,
      files,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
