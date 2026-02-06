/**
 * Chat Tools Module
 *
 * Defines AI-callable functions for chat-based project/ticket creation.
 * Uses Vercel AI SDK tool format for function calling.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getClient } from '../storage/index.js';
import { projects, tickets, sprints } from '../storage/schema.js';
import { eq, sql, type InferSelectModel } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { aiProvider } from '../providers/index.js';

// Type aliases for schema models
type Project = InferSelectModel<typeof projects>;
type Ticket = InferSelectModel<typeof tickets>;

// === Tool Schemas ===

export const CreateProjectToolSchema = z.object({
  name: z.string().min(1).describe('Project name (e.g., "Mobile App", "Backend API")'),
  key: z.string().min(2).max(10).describe('Project key prefix for tickets (e.g., "MOBILE", "API")'),
  description: z.string().optional().describe('Brief project description'),
  icon: z.string().optional().describe('Emoji icon for the project (e.g., "📱", "🚀")'),
  color: z.string().optional().describe('Hex color for the project (e.g., "#6366f1")'),
});

export const CreateTicketToolSchema = z.object({
  projectKey: z.string().describe('Project key to create ticket in (e.g., "GLINR")'),
  title: z.string().min(1).describe('Ticket title'),
  description: z.string().optional().describe('Detailed ticket description'),
  type: z.enum(['task', 'bug', 'story', 'epic', 'subtask']).default('task').describe('Ticket type'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium').describe('Priority level'),
  labels: z.array(z.string()).optional().describe('Labels/tags for the ticket'),
  storyPoints: z.number().optional().describe('Story points estimate'),
});

export const CreateSprintToolSchema = z.object({
  projectKey: z.string().describe('Project key to create sprint in'),
  name: z.string().min(1).describe('Sprint name (e.g., "Sprint 1", "Q1 Release")'),
  goal: z.string().optional().describe('Sprint goal/objective'),
  startDate: z.string().optional().describe('Sprint start date (ISO format)'),
  endDate: z.string().optional().describe('Sprint end date (ISO format)'),
  capacity: z.number().optional().describe('Team capacity in story points'),
});

export const ListProjectsToolSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active').describe('Filter by project status'),
});

export const SearchTicketsToolSchema = z.object({
  query: z.string().optional().describe('Search query'),
  projectKey: z.string().optional().describe('Filter by project'),
  status: z.string().optional().describe('Filter by status'),
  type: z.string().optional().describe('Filter by type'),
  limit: z.number().default(10).describe('Max results to return'),
});

// === Tool Types ===

export type CreateProjectInput = z.infer<typeof CreateProjectToolSchema>;
export type CreateTicketInput = z.infer<typeof CreateTicketToolSchema>;
export type CreateSprintInput = z.infer<typeof CreateSprintToolSchema>;
export type ListProjectsInput = z.infer<typeof ListProjectsToolSchema>;
export type SearchTicketsInput = z.infer<typeof SearchTicketsToolSchema>;

// === Provider Configuration Schema ===

export const ConfigureProviderToolSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'azure', 'google', 'ollama', 'groq', 'openrouter'])
    .describe('The AI provider to configure'),
  apiKey: z.string().min(1).describe('The API key for the provider'),
  baseUrl: z.string().optional().describe('Optional custom base URL (for Azure, Ollama, or self-hosted)'),
  setAsDefault: z.boolean().optional().default(false).describe('Set this provider as the default'),
});

export type ConfigureProviderInput = z.infer<typeof ConfigureProviderToolSchema>;

// === Tool Definitions for AI SDK ===

export const CHAT_TOOLS = {
  configureProvider: {
    name: 'configureProvider',
    description: 'Configure an AI provider with an API key. Use this when the user provides an API key for OpenAI, Anthropic, Azure, Google, Ollama, etc. The AI will automatically detect when users mention API keys and configure the appropriate provider.',
    parameters: ConfigureProviderToolSchema,
  },
  createProject: {
    name: 'createProject',
    description: 'Create a new project in GLINR. Projects organize tickets with a unique key prefix.',
    parameters: CreateProjectToolSchema,
  },
  createTicket: {
    name: 'createTicket',
    description: 'Create a new ticket (task, bug, story, or epic) in a project.',
    parameters: CreateTicketToolSchema,
  },
  createSprint: {
    name: 'createSprint',
    description: 'Create a new sprint for a project with optional dates and capacity.',
    parameters: CreateSprintToolSchema,
  },
  listProjects: {
    name: 'listProjects',
    description: 'List all projects in the workspace.',
    parameters: ListProjectsToolSchema,
  },
  searchTickets: {
    name: 'searchTickets',
    description: 'Search for tickets across projects with optional filters.',
    parameters: SearchTicketsToolSchema,
  },
} as const;

// === Tool Execution Functions ===

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message: string;
}

/**
 * Execute a tool by name with given arguments
 */
export async function executeTool(
  toolName: string,
  args: unknown
): Promise<ToolResult> {
  logger.info(`[ChatTools] Executing tool: ${toolName}`, { component: 'ChatTools' });

  switch (toolName) {
    case 'configureProvider':
      return executeConfigureProvider(args as ConfigureProviderInput);
    case 'createProject':
      return executeCreateProject(args as CreateProjectInput);
    case 'createTicket':
      return executeCreateTicket(args as CreateTicketInput);
    case 'createSprint':
      return executeCreateSprint(args as CreateSprintInput);
    case 'listProjects':
      return executeListProjects(args as ListProjectsInput);
    case 'searchTickets':
      return executeSearchTickets(args as SearchTicketsInput);
    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
        message: `The tool "${toolName}" is not available.`,
      };
  }
}

/**
 * Configure an AI provider with API key
 */
async function executeConfigureProvider(input: ConfigureProviderInput): Promise<ToolResult> {
  try {
    const { provider, apiKey, baseUrl, setAsDefault } = input;

    // Validate API key format based on provider
    const keyValidation = validateApiKeyFormat(provider, apiKey);
    if (!keyValidation.valid) {
      return {
        success: false,
        error: 'Invalid API key format',
        message: keyValidation.message,
      };
    }

    // Configure the provider
    aiProvider.configure(provider, {
      type: provider,
      apiKey,
      baseUrl,
      enabled: true,
    });

    // Set as default if requested
    if (setAsDefault) {
      aiProvider.setDefaultProvider(provider);
    }

    // Verify the configuration by checking health
    const healthResults = await aiProvider.healthCheck(provider);
    const health = healthResults[0];

    if (health && !health.healthy) {
      return {
        success: false,
        error: 'Provider configuration failed health check',
        message: `The API key was saved but verification failed: ${health.message || 'Unknown error'}. Please verify your API key is correct.`,
      };
    }

    logger.info(`[ChatTools] Configured provider: ${provider}`, { component: 'ChatTools' });

    return {
      success: true,
      data: {
        provider,
        healthy: health?.healthy ?? false,
        latencyMs: health?.latencyMs,
        isDefault: setAsDefault,
      },
      message: `✅ ${getProviderDisplayName(provider)} configured successfully!${setAsDefault ? ' Set as default provider.' : ''} You can now use ${provider} models in chat.`,
    };
  } catch (error) {
    logger.error(`[ChatTools] Failed to configure provider:`, error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to configure provider. Please check your API key and try again.',
    };
  }
}

/**
 * Validate API key format based on provider
 */
function validateApiKeyFormat(provider: string, apiKey: string): { valid: boolean; message: string } {
  const trimmedKey = apiKey.trim();

  switch (provider) {
    case 'openai':
      if (!trimmedKey.startsWith('sk-')) {
        return { valid: false, message: 'OpenAI API keys should start with "sk-"' };
      }
      break;
    case 'anthropic':
      if (!trimmedKey.startsWith('sk-ant-')) {
        return { valid: false, message: 'Anthropic API keys should start with "sk-ant-"' };
      }
      break;
    case 'google':
      if (trimmedKey.length < 20) {
        return { valid: false, message: 'Google API key appears too short' };
      }
      break;
    case 'azure':
      if (trimmedKey.length < 20) {
        return { valid: false, message: 'Azure API key appears too short' };
      }
      break;
    case 'groq':
      if (!trimmedKey.startsWith('gsk_')) {
        return { valid: false, message: 'Groq API keys should start with "gsk_"' };
      }
      break;
    case 'openrouter':
      if (!trimmedKey.startsWith('sk-or-')) {
        return { valid: false, message: 'OpenRouter API keys should start with "sk-or-"' };
      }
      break;
    case 'ollama':
      // Ollama doesn't need API key validation
      return { valid: true, message: 'OK' };
  }

  if (trimmedKey.length < 10) {
    return { valid: false, message: 'API key appears too short' };
  }

  return { valid: true, message: 'OK' };
}

/**
 * Get display name for provider
 */
function getProviderDisplayName(provider: string): string {
  const names: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic (Claude)',
    azure: 'Azure OpenAI',
    google: 'Google AI (Gemini)',
    ollama: 'Ollama (Local)',
    groq: 'Groq',
    openrouter: 'OpenRouter',
  };
  return names[provider] || provider;
}

/**
 * Create a new project
 */
async function executeCreateProject(input: CreateProjectInput): Promise<ToolResult> {
  try {
    const db = getClient();
    const id = randomUUID();
    const key = input.key.toUpperCase();

    // Check if key already exists
    const existing = await db.select().from(projects).where(eq(projects.key, key)).get();
    if (existing) {
      return {
        success: false,
        error: 'Project key already exists',
        message: `A project with key "${key}" already exists. Please choose a different key.`,
      };
    }

    // Get next sequence number
    const lastProject = await db
      .select({ maxSeq: sql<number>`MAX(sequence)` })
      .from(projects)
      .get();
    const sequence = (lastProject?.maxSeq ?? 0) + 1;

    // Create the project
    await db.insert(projects).values({
      id,
      sequence,
      key,
      name: input.name,
      description: input.description,
      icon: input.icon || '📋',
      color: input.color || '#6366f1',
      status: 'active',
    });

    logger.info(`[ChatTools] Created project: ${key}`, { component: 'ChatTools' });

    return {
      success: true,
      data: { id, key, name: input.name, sequence },
      message: `Project "${input.name}" (${key}) created successfully! You can now create tickets using the ${key} prefix.`,
    };
  } catch (error) {
    logger.error(`[ChatTools] Failed to create project:`, error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to create project. Please try again.',
    };
  }
}

/**
 * Create a new ticket
 */
async function executeCreateTicket(input: CreateTicketInput): Promise<ToolResult> {
  try {
    const db = getClient();

    // Find the project by key
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.key, input.projectKey.toUpperCase()))
      .get();

    if (!project) {
      return {
        success: false,
        error: 'Project not found',
        message: `Project with key "${input.projectKey}" not found. Please create the project first or use an existing project key.`,
      };
    }

    // Get next ticket sequence for this project
    const lastTicket = await db
      .select({ maxSeq: sql<number>`MAX(sequence)` })
      .from(tickets)
      .where(eq(tickets.projectId, project.id))
      .get();
    const sequence = (lastTicket?.maxSeq ?? 0) + 1;

    const id = randomUUID();
    const ticketKey = `${project.key}-${sequence}`;

    // Create the ticket
    await db.insert(tickets).values({
      id,
      projectId: project.id,
      sequence,
      title: input.title,
      description: input.description || '',
      type: input.type || 'task',
      status: 'backlog',
      priority: input.priority || 'medium',
      labels: input.labels || [],
      storyPoints: input.storyPoints,
    });

    logger.info(`[ChatTools] Created ticket: ${ticketKey}`, { component: 'ChatTools' });

    return {
      success: true,
      data: {
        id,
        key: ticketKey,
        title: input.title,
        type: input.type,
        priority: input.priority,
        projectKey: project.key,
      },
      message: `Ticket ${ticketKey}: "${input.title}" created successfully! Priority: ${input.priority}, Type: ${input.type}.`,
    };
  } catch (error) {
    logger.error(`[ChatTools] Failed to create ticket:`, error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to create ticket. Please try again.',
    };
  }
}

/**
 * Create a new sprint
 */
async function executeCreateSprint(input: CreateSprintInput): Promise<ToolResult> {
  try {
    const db = getClient();

    // Find the project by key
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.key, input.projectKey.toUpperCase()))
      .get();

    if (!project) {
      return {
        success: false,
        error: 'Project not found',
        message: `Project with key "${input.projectKey}" not found.`,
      };
    }

    // Get next sprint sequence for this project
    const lastSprint = await db
      .select({ maxSeq: sql<number>`MAX(sequence)` })
      .from(sprints)
      .where(eq(sprints.projectId, project.id))
      .get();
    const sequence = (lastSprint?.maxSeq ?? 0) + 1;

    const id = randomUUID();

    // Create the sprint
    await db.insert(sprints).values({
      id,
      projectId: project.id,
      sequence,
      name: input.name,
      goal: input.goal,
      status: 'planning',
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
      capacity: input.capacity,
    });

    logger.info(`[ChatTools] Created sprint: ${input.name}`, { component: 'ChatTools' });

    return {
      success: true,
      data: {
        id,
        name: input.name,
        projectKey: project.key,
        status: 'planning',
      },
      message: `Sprint "${input.name}" created for project ${project.key}! Status: Planning. ${input.goal ? `Goal: ${input.goal}` : ''}`,
    };
  } catch (error) {
    logger.error(`[ChatTools] Failed to create sprint:`, error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to create sprint. Please try again.',
    };
  }
}

/**
 * List projects
 */
async function executeListProjects(input: ListProjectsInput): Promise<ToolResult> {
  try {
    const db = getClient();

    let query = db.select().from(projects);

    if (input.status !== 'all') {
      query = query.where(eq(projects.status, input.status)) as typeof query;
    }

    const projectList = await query.all();

    return {
      success: true,
      data: projectList.map((p: Project) => ({
        key: p.key,
        name: p.name,
        icon: p.icon,
        status: p.status,
      })),
      message:
        projectList.length > 0
          ? `Found ${projectList.length} project(s): ${projectList.map((p: Project) => `${p.icon} ${p.key}`).join(', ')}`
          : 'No projects found. Would you like to create one?',
    };
  } catch (error) {
    logger.error(`[ChatTools] Failed to list projects:`, error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to list projects.',
    };
  }
}

/**
 * Search tickets
 */
async function executeSearchTickets(input: SearchTicketsInput): Promise<ToolResult> {
  try {
    const db = getClient();

    let ticketList = await db.select().from(tickets).limit(input.limit).all();

    // Apply filters
    if (input.projectKey) {
      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.key, input.projectKey.toUpperCase()))
        .get();
      if (project) {
        ticketList = ticketList.filter((t: Ticket) => t.projectId === project.id);
      }
    }

    if (input.status) {
      ticketList = ticketList.filter((t: Ticket) => t.status === input.status);
    }

    if (input.type) {
      ticketList = ticketList.filter((t: Ticket) => t.type === input.type);
    }

    if (input.query) {
      const q = input.query.toLowerCase();
      ticketList = ticketList.filter(
        (t: Ticket) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q)
      );
    }

    // Get project keys for ticket display
    const projectIds = [...new Set(ticketList.map((t: Ticket) => t.projectId).filter(Boolean))];
    const projectMap = new Map<string, string>();
    if (projectIds.length > 0) {
      const projectsData = await db.select().from(projects).all();
      projectsData.forEach((p: Project) => projectMap.set(p.id, p.key));
    }

    // Generate ticket keys from project + sequence
    type TicketWithKey = Ticket & { ticketKey: string };
    const ticketsWithKeys: TicketWithKey[] = ticketList.map((t: Ticket) => {
      const projectKey = t.projectId ? projectMap.get(t.projectId) || 'UNKNOWN' : 'UNKNOWN';
      const ticketKey = `${projectKey}-${t.sequence}`;
      return { ...t, ticketKey };
    });

    return {
      success: true,
      data: ticketsWithKeys.map((t: TicketWithKey) => ({
        key: t.ticketKey,
        title: t.title,
        type: t.type,
        status: t.status,
        priority: t.priority,
      })),
      message:
        ticketsWithKeys.length > 0
          ? `Found ${ticketsWithKeys.length} ticket(s):\n${ticketsWithKeys.map((t: TicketWithKey) => `• ${t.ticketKey}: ${t.title} (${t.status})`).join('\n')}`
          : 'No tickets found matching your criteria.',
    };
  } catch (error) {
    logger.error(`[ChatTools] Failed to search tickets:`, error instanceof Error ? error : undefined);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to search tickets.',
    };
  }
}

// === Export tool definitions for AI SDK ===

export function getToolDefinitions() {
  return Object.values(CHAT_TOOLS).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
