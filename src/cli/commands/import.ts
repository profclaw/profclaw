/**
 * Import/Migration CLI Command
 *
 * Imports data from other AI assistants into profClaw:
 *   - OpenClaw: memories, skills, conversation history
 *   - ChatGPT: exported conversations (JSON)
 *   - Aider: chat history
 *
 * Usage:
 *   profclaw import --from openclaw [--path ~/.openclaw]
 *   profclaw import --from chatgpt --file conversations.json
 *   profclaw import --from aider [--path .]
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { Command } from 'commander';
import { createContextualLogger } from '../../utils/logger.js';

const log = createContextualLogger('Import');

// Types

export type ImportSource = 'openclaw' | 'chatgpt' | 'aider';

export interface ImportResult {
  source: ImportSource;
  memories: number;
  conversations: number;
  skills: number;
  preferences: number;
  errors: string[];
  duration: number;
}

interface ParsedMemory {
  name: string;
  type: string;
  content: string;
  description?: string;
  source: string;
}

interface ParsedConversation {
  id: string;
  title: string;
  messages: Array<{ role: string; content: string; timestamp?: string }>;
  source: string;
}

// OpenClaw Import

/**
 * Discover OpenClaw data directory.
 * Checks: ~/.openclaw, OPENCLAW_HOME env, provided path.
 */
function findOpenClawPath(providedPath?: string): string {
  if (providedPath) return providedPath;
  if (process.env['OPENCLAW_HOME']) return process.env['OPENCLAW_HOME'];
  return join(homedir(), '.openclaw');
}

/**
 * Parse an OpenClaw MEMORY.md index file to find memory file paths.
 */
function parseMemoryIndex(content: string, basePath: string): string[] {
  const paths: string[] = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    const relPath = match[2];
    if (relPath.endsWith('.md') && !relPath.startsWith('http')) {
      paths.push(join(basePath, relPath));
    }
  }

  return paths;
}

/**
 * Parse an OpenClaw memory file (YAML frontmatter + markdown body).
 */
function parseOpenClawMemory(content: string, filePath: string): ParsedMemory | null {
  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    // No frontmatter - treat entire content as memory
    return {
      name: basename(filePath, '.md'),
      type: 'general',
      content: content.trim(),
      source: 'openclaw',
    };
  }

  const [, yaml, body] = frontmatterMatch;
  const metadata: Record<string, string> = {};

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      metadata[key] = value;
    }
  }

  return {
    name: metadata['name'] ?? basename(filePath, '.md'),
    type: metadata['type'] ?? 'general',
    content: body.trim(),
    description: metadata['description'],
    source: 'openclaw',
  };
}

/**
 * Import memories from OpenClaw.
 */
async function importOpenClawMemories(basePath: string): Promise<{ memories: ParsedMemory[]; errors: string[] }> {
  const memories: ParsedMemory[] = [];
  const errors: string[] = [];

  // Check for MEMORY.md index
  const indexPath = join(basePath, 'MEMORY.md');
  let memoryPaths: string[] = [];

  try {
    const indexContent = await readFile(indexPath, 'utf8');
    memoryPaths = parseMemoryIndex(indexContent, basePath);
  } catch {
    // No index - scan memory/ directory
    const memoryDir = join(basePath, 'memory');
    try {
      const files = await readdir(memoryDir);
      memoryPaths = files
        .filter(f => f.endsWith('.md'))
        .map(f => join(memoryDir, f));
    } catch {
      errors.push('No MEMORY.md index or memory/ directory found');
      return { memories, errors };
    }
  }

  // Parse each memory file
  for (const memPath of memoryPaths) {
    try {
      const content = await readFile(memPath, 'utf8');
      const parsed = parseOpenClawMemory(content, memPath);
      if (parsed) memories.push(parsed);
    } catch (err) {
      errors.push(`Failed to read ${memPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { memories, errors };
}

/**
 * Discover OpenClaw skills (SKILL.md files).
 */
async function importOpenClawSkills(basePath: string): Promise<{ skills: string[]; errors: string[] }> {
  const skills: string[] = [];
  const errors: string[] = [];

  const skillDirs = [
    join(basePath, 'skills'),
    join(basePath, 'agent-skills'),
  ];

  for (const dir of skillDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = join(dir, entry.name, 'SKILL.md');
          try {
            await stat(skillFile);
            skills.push(entry.name);
          } catch {
            // No SKILL.md in this dir
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return { skills, errors };
}

// ChatGPT Import

interface ChatGPTExport {
  title?: string;
  mapping?: Record<string, {
    message?: {
      author?: { role?: string };
      content?: { parts?: string[] };
      create_time?: number;
    };
  }>;
}

/**
 * Parse a ChatGPT conversation export (JSON format).
 */
function parseChatGPTExport(content: string): { conversations: ParsedConversation[]; errors: string[] } {
  const conversations: ParsedConversation[] = [];
  const errors: string[] = [];

  try {
    const data = JSON.parse(content) as ChatGPTExport[];

    if (!Array.isArray(data)) {
      errors.push('Expected array of conversations in ChatGPT export');
      return { conversations, errors };
    }

    for (const conv of data) {
      try {
        const messages: ParsedConversation['messages'] = [];

        if (conv.mapping) {
          // Extract messages from mapping (ChatGPT's internal format)
          const sorted = Object.values(conv.mapping)
            .filter(node => node.message?.content?.parts?.length)
            .sort((a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0));

          for (const node of sorted) {
            const msg = node.message;
            if (!msg?.author?.role || !msg.content?.parts?.length) continue;

            const role = msg.author.role === 'user' ? 'user'
              : msg.author.role === 'assistant' ? 'assistant'
              : 'system';

            messages.push({
              role,
              content: msg.content.parts.join('\n'),
              timestamp: msg.create_time
                ? new Date(msg.create_time * 1000).toISOString()
                : undefined,
            });
          }
        }

        if (messages.length > 0) {
          conversations.push({
            id: `chatgpt-${conversations.length}`,
            title: conv.title ?? `Conversation ${conversations.length + 1}`,
            messages,
            source: 'chatgpt',
          });
        }
      } catch (err) {
        errors.push(`Failed to parse conversation: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { conversations, errors };
}

/**
 * Extract memories from ChatGPT conversations.
 * Looks for patterns: preferences, decisions, facts.
 */
function extractMemoriesFromConversations(conversations: ParsedConversation[]): ParsedMemory[] {
  const memories: ParsedMemory[] = [];
  const seenTopics = new Set<string>();

  for (const conv of conversations) {
    const userMessages = conv.messages.filter(m => m.role === 'user');

    // Extract preferences
    for (const msg of userMessages) {
      const prefMatch = msg.content.match(
        /\b(?:I (?:use|prefer|like|work with|always))\s+(\w[\w\s.-]{2,30})/i,
      );
      if (prefMatch && !seenTopics.has(prefMatch[1].toLowerCase())) {
        seenTopics.add(prefMatch[1].toLowerCase());
        memories.push({
          name: `preference-${prefMatch[1].toLowerCase().replace(/\s+/g, '-')}`,
          type: 'user',
          content: `User prefers: ${prefMatch[1]}. Context: "${msg.content.slice(0, 100)}"`,
          source: 'chatgpt',
        });
      }
    }

    // Extract topic as a high-level memory if conversation is substantial
    if (userMessages.length >= 3 && conv.title) {
      const topicKey = conv.title.toLowerCase().slice(0, 30);
      if (!seenTopics.has(topicKey)) {
        seenTopics.add(topicKey);
        memories.push({
          name: `topic-${topicKey.replace(/[^\w]/g, '-')}`,
          type: 'project',
          content: `Discussion about: ${conv.title}. ${userMessages.length} messages. First question: "${userMessages[0].content.slice(0, 100)}"`,
          source: 'chatgpt',
        });
      }
    }
  }

  return memories;
}

// Aider Import

/**
 * Parse Aider chat history files (.aider.chat.history.md).
 */
async function importAiderHistory(basePath: string): Promise<{ conversations: ParsedConversation[]; errors: string[] }> {
  const conversations: ParsedConversation[] = [];
  const errors: string[] = [];

  const historyFiles = [
    join(basePath, '.aider.chat.history.md'),
    join(basePath, '.aider', 'chat-history.md'),
  ];

  for (const histFile of historyFiles) {
    try {
      const content = await readFile(histFile, 'utf8');
      const sections = content.split(/^#{1,2}\s+/m).filter(Boolean);

      for (const section of sections) {
        const lines = section.split('\n');
        const title = lines[0]?.trim() ?? 'Aider session';
        const messages: ParsedConversation['messages'] = [];

        let currentRole: string | null = null;
        let currentContent: string[] = [];

        for (const line of lines.slice(1)) {
          if (line.startsWith('> ') || line.startsWith('#### ')) {
            // Save previous message
            if (currentRole && currentContent.length > 0) {
              messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
              currentContent = [];
            }
            currentRole = line.startsWith('> ') ? 'user' : 'assistant';
            currentContent.push(line.replace(/^> |^#### /, ''));
          } else if (currentRole) {
            currentContent.push(line);
          }
        }

        // Save last message
        if (currentRole && currentContent.length > 0) {
          messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
        }

        if (messages.length > 0) {
          conversations.push({
            id: `aider-${conversations.length}`,
            title,
            messages,
            source: 'aider',
          });
        }
      }
    } catch {
      // File doesn't exist - try next
    }
  }

  if (conversations.length === 0) {
    errors.push('No Aider chat history found');
  }

  return { conversations, errors };
}

// Main Import Function

/**
 * Import data from another AI assistant into profClaw.
 * Returns a summary of what was imported.
 */
export async function importFrom(
  source: ImportSource,
  options: {
    path?: string;
    file?: string;
    dryRun?: boolean;
  } = {},
): Promise<ImportResult> {
  const start = Date.now();
  const result: ImportResult = {
    source,
    memories: 0,
    conversations: 0,
    skills: 0,
    preferences: 0,
    errors: [],
    duration: 0,
  };

  log.info(`Starting import from ${source}`, { path: options.path, file: options.file, dryRun: options.dryRun });

  try {
    switch (source) {
      case 'openclaw': {
        const basePath = findOpenClawPath(options.path);

        // Import memories
        const { memories, errors: memErrors } = await importOpenClawMemories(basePath);
        result.errors.push(...memErrors);

        if (!options.dryRun) {
          // Persist memories to experience store
          const { recordExperience } = await import('../../memory/experience-store.js');
          for (const mem of memories) {
            try {
              await recordExperience({
                type: mem.type === 'user' ? 'user_preference'
                  : mem.type === 'feedback' ? 'task_solution'
                  : 'task_solution',
                intent: mem.name,
                solution: { content: mem.content, importedFrom: 'openclaw' },
                successScore: 0.8,
                tags: ['imported', 'openclaw', mem.type],
                sourceConversationId: 'import-openclaw',
                userId: undefined,
              });
              result.memories++;
            } catch (err) {
              result.errors.push(`Failed to persist memory ${mem.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } else {
          result.memories = memories.length;
        }

        // Import skills
        const { skills, errors: skillErrors } = await importOpenClawSkills(basePath);
        result.errors.push(...skillErrors);
        result.skills = skills.length;

        // Extract preferences from memories
        const prefMemories = memories.filter(m => m.type === 'user' || m.type === 'feedback');
        result.preferences = prefMemories.length;

        break;
      }

      case 'chatgpt': {
        const filePath = options.file ?? options.path;
        if (!filePath) {
          result.errors.push('ChatGPT import requires --file <path> pointing to conversations.json export');
          break;
        }

        const content = await readFile(filePath, 'utf8');
        const { conversations, errors } = parseChatGPTExport(content);
        result.errors.push(...errors);
        result.conversations = conversations.length;

        // Extract memories from conversations
        const extracted = extractMemoriesFromConversations(conversations);

        if (!options.dryRun) {
          const { recordExperience } = await import('../../memory/experience-store.js');
          for (const mem of extracted) {
            try {
              await recordExperience({
                type: mem.type === 'user' ? 'user_preference' : 'task_solution',
                intent: mem.name,
                solution: { content: mem.content, importedFrom: 'chatgpt' },
                successScore: 0.7,
                tags: ['imported', 'chatgpt', mem.type],
                sourceConversationId: 'import-chatgpt',
              });
              result.memories++;
            } catch {
              // Skip individual failures
            }
          }
        } else {
          result.memories = extracted.length;
        }

        result.preferences = extracted.filter(m => m.type === 'user').length;
        break;
      }

      case 'aider': {
        const basePath = options.path ?? process.cwd();
        const { conversations, errors } = await importAiderHistory(basePath);
        result.errors.push(...errors);
        result.conversations = conversations.length;

        // Extract solution patterns from Aider conversations
        const memories = extractMemoriesFromConversations(conversations);
        if (!options.dryRun) {
          const { recordExperience } = await import('../../memory/experience-store.js');
          for (const mem of memories) {
            try {
              await recordExperience({
                type: 'task_solution',
                intent: mem.name,
                solution: { content: mem.content, importedFrom: 'aider' },
                successScore: 0.7,
                tags: ['imported', 'aider'],
                sourceConversationId: 'import-aider',
              });
              result.memories++;
            } catch {
              // Skip individual failures
            }
          }
        } else {
          result.memories = memories.length;
        }
        break;
      }
    }
  } catch (error) {
    result.errors.push(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  result.duration = Date.now() - start;

  log.info(`Import from ${source} complete`, {
    memories: result.memories,
    conversations: result.conversations,
    skills: result.skills,
    preferences: result.preferences,
    errors: result.errors.length,
    duration: result.duration,
  });

  return result;
}

/**
 * List available import sources and their expected paths.
 */
export function listImportSources(): Array<{
  source: ImportSource;
  description: string;
  defaultPath: string;
  format: string;
}> {
  return [
    {
      source: 'openclaw',
      description: 'Import memories, skills, and preferences from OpenClaw',
      defaultPath: join(homedir(), '.openclaw'),
      format: 'MEMORY.md + memory/*.md files',
    },
    {
      source: 'chatgpt',
      description: 'Import conversations and extract preferences from ChatGPT export',
      defaultPath: 'conversations.json (from Settings > Data Controls > Export Data)',
      format: 'JSON array of conversations',
    },
    {
      source: 'aider',
      description: 'Import coding session history from Aider',
      defaultPath: '.aider.chat.history.md in project root',
      format: 'Markdown chat history',
    },
  ];
}

// CLI Command

export function importCommands(): Command {
  const cmd = new Command('import')
    .description('Import data from other AI assistants (OpenClaw, ChatGPT, Aider)');

  cmd
    .command('run')
    .description('Import data from a source')
    .requiredOption('--from <source>', 'Source to import from: openclaw, chatgpt, aider')
    .option('--path <path>', 'Path to source data directory')
    .option('--file <file>', 'Path to export file (for chatgpt)')
    .option('--dry-run', 'Preview what would be imported without persisting', false)
    .action(async (options: { from: string; path?: string; file?: string; dryRun: boolean }) => {
      const source = options.from as ImportSource;
      if (!['openclaw', 'chatgpt', 'aider'].includes(source)) {
        console.error(`Unknown source: ${source}. Use: openclaw, chatgpt, aider`);
        process.exit(1);
      }

      console.log(`Importing from ${source}${options.dryRun ? ' (dry run)' : ''}...`);

      const result = await importFrom(source, {
        path: options.path,
        file: options.file,
        dryRun: options.dryRun,
      });

      console.log(`\nImport ${result.errors.length === 0 ? 'complete' : 'finished with errors'}:`);
      console.log(`  Memories:      ${result.memories}`);
      console.log(`  Conversations: ${result.conversations}`);
      console.log(`  Skills:        ${result.skills}`);
      console.log(`  Preferences:   ${result.preferences}`);
      console.log(`  Duration:      ${result.duration}ms`);

      if (result.errors.length > 0) {
        console.log(`\n  Errors (${result.errors.length}):`);
        for (const err of result.errors.slice(0, 5)) {
          console.log(`    - ${err}`);
        }
        if (result.errors.length > 5) {
          console.log(`    ... and ${result.errors.length - 5} more`);
        }
      }
    });

  cmd
    .command('sources')
    .description('List available import sources')
    .action(() => {
      const sources = listImportSources();
      console.log('Available import sources:\n');
      for (const s of sources) {
        console.log(`  ${s.source}`);
        console.log(`    ${s.description}`);
        console.log(`    Default path: ${s.defaultPath}`);
        console.log(`    Format: ${s.format}\n`);
      }
    });

  return cmd;
}
