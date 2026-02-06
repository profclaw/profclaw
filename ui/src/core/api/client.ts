/**
 * API Client for profClaw Task Manager
 *
 * Provides type-safe API calls to the backend
 *
 * Note: Types are also available from '@/core/types' for direct imports.
 * This file re-exports them for backwards compatibility.
 *
 * The API is organized into domain modules in ./domains/ for better maintainability.
 * Each domain module handles a specific area of functionality.
 */

// Re-export all types for backwards compatibility
// New code should import from '@/core/types' directly
export type {
  Task,
  TaskStatus,
  TasksResponse,
  TaskAnalytics,
  TaskFilterParams,
  TaskEvent,
  Summary,
  SummariesResponse,
  SummaryStats,
  Ticket,
  TicketStatus,
  TicketType,
  TicketPriority,
  TicketComment,
  TicketHistoryEntry,
  TicketExternalLink,
  TicketCategorization,
  TicketSuggestion,
  SimilarTicket,
  TicketsResponse,
  TicketFilterParams,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatUsage,
  ModelInfo,
  ModelAlias,
  GatewayAgent,
  GatewayWorkflow,
  GatewayConfig,
  GatewayExecuteRequest,
  GatewayExecuteResponse,
  GatewayStatus,
  AIStatus,
  AIResponderStatus,
  AICommentResponse,
  AICommentAnalysis,
  Settings,
  PluginHealth,
  ExternalPlatform,
  TicketWithRelations,
  CreateTicketInput,
  TicketQueryParams,
  TicketChecklist,
  TicketChecklistItem,
  TicketRelation,
  TicketRelationType,
  State,
  StateGroup,
  // Projects & Sprints
  Project,
  ProjectStatus,
  ProjectExternalLink,
  ProjectWithRelations,
  ProjectsResponse,
  ProjectQueryParams,
  CreateProjectInput,
  UpdateProjectInput,
  Sprint,
  SprintStatus,
  SprintWithStats,
  SprintsResponse,
  SprintQueryParams,
  CreateSprintInput,
  UpdateSprintInput,
  SprintTicket,
  DashboardStats,
  VelocityDataPoint,
} from '../types';

// Import domain APIs
import { tasksApi } from './domains/tasks';
import { summariesApi } from './domains/summaries';
import { ticketsApi } from './domains/tickets';
import { chatApi } from './domains/chat';
import { projectsApi, labelsApi } from './domains/projects';
import { importApi } from './domains/import';
import { cronApi } from './domains/cron';
import { notificationsApi } from './domains/notifications';
import {
  healthApi,
  statsApi,
  costsApi,
  dlqApi,
  integrationsApi,
  settingsApi,
  pluginsApi,
  gatewayApi,
  syncApi,
  statesApi,
  searchApi,
} from './domains/stats';

// Re-export domain types for convenience
export type {
  // Cron types
  JobType,
  JobStatus,
  RunStatus,
  ScheduledJob,
  JobRunHistory,
  JobTemplate,
  CronStats,
  CreateJobInput,
} from './domains/cron';

export type {
  // Chat types
  ConversationMessage,
  Conversation,
  ToolCall,
  PendingApproval,
  Skill,
  MemoryStats,
} from './domains/chat';

export type {
  // Project types from domains
  Project as DomainProject,
  Sprint as DomainSprint,
  Label,
} from './domains/projects';

export type {
  // Import types
  GitHubProject,
  GitHubIteration,
  GitHubProjectItem,
  FieldMappings,
} from './domains/import';

export type {
  Notification,
  NotificationsResponse,
  CreateNotificationInput,
} from './domains/notifications';

// Unified API Client
// Maps the modular APIs to the original structure for backwards compatibility
export const api = {
  // Tasks
  tasks: tasksApi,

  // Summaries
  summaries: summariesApi,

  // Health
  health: healthApi.check,

  // Integrations
  integrations: integrationsApi,

  // DLQ (Dead Letter Queue)
  dlq: dlqApi,

  // Stats
  stats: statsApi,

  // Costs
  costs: costsApi,

  // Settings
  settings: settingsApi,

  // Plugins
  plugins: pluginsApi,

  // Gateway
  gateway: gatewayApi,

  // Tickets
  tickets: ticketsApi,

  // Chat
  chat: chatApi,

  // Projects
  projects: projectsApi,

  // Labels
  labels: labelsApi,

  // Sync
  sync: syncApi,

  // Import
  import: importApi,

  // Cron / Scheduled Jobs
  cron: cronApi,

  // States (workflow states)
  states: statesApi,

  // Search
  search: searchApi,

  // Notifications
  notifications: notificationsApi,
};

// Also export individual APIs for tree-shaking
export {
  tasksApi,
  summariesApi,
  ticketsApi,
  chatApi,
  projectsApi,
  labelsApi,
  importApi,
  cronApi,
  healthApi,
  statsApi,
  costsApi,
  dlqApi,
  integrationsApi,
  settingsApi,
  pluginsApi,
  gatewayApi,
  syncApi,
  statesApi,
  searchApi,
  notificationsApi,
};
