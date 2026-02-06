/**
 * OpenAPI Documentation Route
 *
 * Serves the OpenAPI spec as JSON and provides a Swagger UI page.
 */

import { Hono } from 'hono';

const openApiRoutes = new Hono();

// === OpenAPI Specification ===

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'GLINR Task Manager API',
    version: '0.1.0',
    description:
      'AI-powered task orchestration, ticket management, and chat system. Supports multi-provider AI (Anthropic, OpenAI, Google, Ollama) with agentic tool execution.',
    contact: { name: 'GLINR', url: 'https://glincker.com' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication & user management' },
    { name: 'Tickets', description: 'Issue/ticket CRUD with projects, labels, and relations' },
    { name: 'Projects', description: 'Project management' },
    { name: 'Tasks', description: 'Background task queue' },
    { name: 'Chat', description: 'AI chat with multi-provider support' },
    { name: 'Agents', description: 'AI agent registry' },
    { name: 'Settings', description: 'Application settings' },
    { name: 'Search', description: 'Full-text search' },
    { name: 'Cron', description: 'Scheduled jobs' },
    { name: 'Tools', description: 'Available AI tools' },
  ],
  paths: {
    // === Auth ===
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email/password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 1 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful, sets session cookie' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Create new user account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Account created' },
          409: { description: 'Email already exists' },
        },
      },
    },

    // === Tickets ===
    '/api/tickets': {
      get: {
        tags: ['Tickets'],
        summary: 'List tickets with filtering',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'] } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['bug', 'feature', 'enhancement', 'task', 'documentation', 'epic', 'story', 'subtask'] } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'assignee', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: {
            description: 'Ticket list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tickets: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Tickets'],
        summary: 'Create a new ticket',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  type: { type: 'string', enum: ['bug', 'feature', 'enhancement', 'task', 'documentation', 'epic', 'story', 'subtask'], default: 'task' },
                  priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'], default: 'medium' },
                  status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'], default: 'backlog' },
                  labels: { type: 'array', items: { type: 'string' } },
                  projectId: { type: 'string' },
                  parentId: { type: 'string' },
                  assignee: { type: 'string' },
                  dueDate: { type: 'string', format: 'date-time' },
                  estimate: { type: 'number' },
                  estimateUnit: { type: 'string', enum: ['points', 'hours', 'days'] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Ticket created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } } },
        },
      },
    },
    '/api/tickets/{id}': {
      get: {
        tags: ['Tickets'],
        summary: 'Get ticket by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Ticket details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } } },
          404: { description: 'Ticket not found' },
        },
      },
      patch: {
        tags: ['Tickets'],
        summary: 'Update a ticket',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  status: { type: 'string' },
                  type: { type: 'string' },
                  priority: { type: 'string' },
                  labels: { type: 'array', items: { type: 'string' } },
                  assignee: { type: 'string' },
                  assigneeAgent: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated ticket' },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Tickets'],
        summary: 'Delete a ticket',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Ticket deleted' },
          404: { description: 'Not found' },
        },
      },
    },

    // === Projects ===
    '/api/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List all projects',
        responses: {
          200: {
            description: 'Project list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projects: { type: 'array', items: { $ref: '#/components/schemas/Project' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create a project',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'key'],
                properties: {
                  name: { type: 'string' },
                  key: { type: 'string', description: 'Project key (e.g., GLINR)' },
                  description: { type: 'string' },
                  defaultAssignee: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Project created' } },
      },
    },

    // === Tasks ===
    '/api/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List background tasks',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'queued', 'in_progress', 'completed', 'failed', 'cancelled'] } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: {
            description: 'Task list',
            content: { 'application/json': { schema: { type: 'object', properties: { tasks: { type: 'array' }, total: { type: 'integer' } } } } },
          },
        },
      },
    },

    // === Chat ===
    '/api/chat/conversations': {
      get: {
        tags: ['Chat'],
        summary: 'List conversations',
        responses: { 200: { description: 'Conversation list' } },
      },
      post: {
        tags: ['Chat'],
        summary: 'Create a conversation',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  model: { type: 'string', description: 'Model alias (opus, sonnet, haiku, gpt) or full ID' },
                  presetId: { type: 'string' },
                  ticketId: { type: 'string' },
                  taskId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Conversation created' } },
      },
    },
    '/api/chat/conversations/{id}/messages': {
      post: {
        tags: ['Chat'],
        summary: 'Send a message (standard)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string' },
                  model: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'AI response' } },
      },
    },
    '/api/chat/conversations/{id}/messages/agentic': {
      post: {
        tags: ['Chat'],
        summary: 'Send a message in agentic mode (SSE streaming)',
        description: 'Runs the AI autonomously with tool execution. Returns SSE stream with events: session:start, thinking, step:start/complete, tool:call/result, summary, complete, error.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string' },
                  model: { type: 'string' },
                  provider: { type: 'string' },
                  temperature: { type: 'number', minimum: 0, maximum: 2 },
                  showThinking: { type: 'boolean', default: true },
                  maxSteps: { type: 'integer', minimum: 1, maximum: 200 },
                  maxBudget: { type: 'integer', minimum: 1000 },
                  effort: { type: 'string', enum: ['low', 'medium', 'high', 'max'], description: 'Thinking effort level for Anthropic models' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'SSE event stream',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/chat/models': {
      get: {
        tags: ['Chat'],
        summary: 'List available AI models',
        responses: {
          200: {
            description: 'Model list with aliases and provider info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    models: { type: 'array' },
                    aliases: { type: 'array' },
                    activeProvider: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // === Agents ===
    '/api/agents': {
      get: {
        tags: ['Agents'],
        summary: 'List registered AI agents',
        responses: { 200: { description: 'Agent list' } },
      },
    },

    // === Search ===
    '/api/search': {
      get: {
        tags: ['Search'],
        summary: 'Full-text search across tickets, tasks, and projects',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['tickets', 'tasks', 'projects'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Search results' } },
      },
    },

    // === Tools ===
    '/api/tools': {
      get: {
        tags: ['Tools'],
        summary: 'List available AI tools',
        parameters: [
          { name: 'all', in: 'query', schema: { type: 'boolean' }, description: 'Include all tools (not just safe defaults)' },
        ],
        responses: { 200: { description: 'Tool list with names and descriptions' } },
      },
    },

    // === Settings ===
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get application settings',
        responses: { 200: { description: 'Current settings' } },
      },
      patch: {
        tags: ['Settings'],
        summary: 'Update settings',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Updated settings' } },
      },
    },

    // === Health ===
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'Service health',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok'] },
                    version: { type: 'string' },
                    uptime: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          sequence: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'] },
          type: { type: 'string', enum: ['bug', 'feature', 'enhancement', 'task', 'documentation', 'epic', 'story', 'subtask'] },
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
          labels: { type: 'array', items: { type: 'string' } },
          assignee: { type: 'string' },
          assigneeAgent: { type: 'string' },
          projectId: { type: 'string' },
          projectKey: { type: 'string' },
          parentId: { type: 'string' },
          estimate: { type: 'number' },
          estimateUnit: { type: 'string', enum: ['points', 'hours', 'days'] },
          dueDate: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          key: { type: 'string' },
          description: { type: 'string' },
          ticketCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
        description: 'Session cookie from /auth/login',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API token from /api/tokens',
      },
    },
  },
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
};

// === Routes ===

/** GET /api/docs/openapi.json - Raw OpenAPI spec */
openApiRoutes.get('/openapi.json', (c) => {
  return c.json(spec);
});

/** GET /api/docs - Swagger UI */
openApiRoutes.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GLINR API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #1a1a2e; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui { max-width: 1200px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 2,
      docExpansion: 'list',
      filter: true,
      syntaxHighlight: { activate: true, theme: 'monokai' },
    });
  </script>
</body>
</html>`;
  return c.html(html);
});

export { openApiRoutes };
