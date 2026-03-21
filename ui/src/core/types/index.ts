/**
 * Core Types for profClaw Task Manager UI
 *
 * All shared types are exported from this file for easy import.
 * Usage: import { Task, Ticket, ChatMessage } from '@/core/types';
 */

// ================================
// Task Types
// ================================

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description?: string;
  prompt: string;
  status: TaskStatus;
  priority: number;
  source: string;
  sourceId?: string;
  sourceUrl?: string;
  repository?: string;
  branch?: string;
  labels: string[];
  assignedAgent?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TasksResponse {
  tasks: Task[];
  total: number;
}

export interface TaskAnalytics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  cancelledTasks: number;
  successRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  byStatus: Record<string, number>;
  byPriority: Record<number, number>;
  bySource: Record<string, number>;
  byAgent: Record<string, { count: number; successRate: number; avgDurationMs: number }>;
  daily: Array<{ date: string; created: number; completed: number; failed: number }>;
  recentCompletions: number;
  recentFailures: number;
}

export interface TaskFilterParams {
  status?: string | string[];
  priority?: number | number[];
  source?: string | string[];
  agent?: string;
  labels?: string[];
  createdAfter?: string;
  createdBefore?: string;
  q?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'completedAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: 'created' | 'queued' | 'assigned' | 'started' | 'progress' | 'completed' | 'failed' | 'cancelled' | 'retried';
  timestamp: string;
  agentId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

// ================================
// Summary Types
// ================================

// File change record
export interface FileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted' | 'renamed';
  linesAdded?: number;
  linesRemoved?: number;
  oldPath?: string;
}

// Decision made during task execution
export interface Decision {
  description: string;
  reason?: string;
  alternatives?: string[];
  confidence?: number;
}

// Blocker or issue encountered
export interface Blocker {
  description: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  resolved?: boolean;
  resolution?: string;
}

export interface Summary {
  id: string;
  taskId?: string;
  sessionId?: string;
  agent: string;
  model?: string;
  title: string;
  whatChanged: string;
  whyChanged?: string;
  howChanged?: string;
  filesChanged: (string | FileChange)[];
  decisions: (string | Decision)[];
  blockers: (string | Blocker)[];
  artifacts: string[];
  createdAt: string;
}

export interface SummariesResponse {
  summaries: Summary[];
  total: number;
}

export interface SummaryStats {
  totalCount: number;
  byAgent: Record<string, number>;
  byTaskType: Record<string, number>;
  byComponent: Record<string, number>;
  totalTokens: number;
  totalCost: number;
  filesChangedCount: number;
}

// ================================
// Ticket Types
// ================================

export type TicketStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TicketType = 'bug' | 'feature' | 'enhancement' | 'task' | 'documentation' | 'epic' | 'story' | 'subtask';
export type TicketPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

export interface State {
  id: string;
  projectId: string | null;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  stateGroup: StateGroup;
  isDefault: boolean;
  sequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  sequence: number;
  title: string;
  description?: string;
  status: TicketStatus;
  type: TicketType;
  priority: TicketPriority;
  labels: string[];
  assignee?: string;
  assigneeAgent?: string;
  reporter?: string;
  parentId?: string;
  linkedTaskId?: string;
  linkedPRs: string[];
  linkedCommits: string[];
  linkedBranch?: string;
  dueDate?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: 'human' | 'ai';
  aiAgent?: string;
  aiSessionId?: string;
  aiTaskId?: string;
  estimate?: number;
  estimateUnit?: 'points' | 'hours' | 'days';
  // Project association
  projectId?: string;
  projectKey?: string;  // Populated from project (e.g., "PROFCLAW", "MOBILE")
  projectName?: string; // Populated from project
}

export interface TicketComment {
  id: string;
  ticketId: string;
  content: string;
  author: {
    id: string;
    name: string;
    type: 'user' | 'ai';
  };
  source: 'profclaw' | 'github' | 'jira' | 'linear';
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketHistoryEntry {
  id: string;
  ticketId: string;
  field: string;
  oldValue?: string;
  newValue: string;
  changedBy: {
    id: string;
    name: string;
    type: 'user' | 'ai' | 'system';
  };
  timestamp: string;
  createdAt?: string;
}

export type TicketRelationType =
  | 'blocks'
  | 'blocked_by'
  | 'relates_to'
  | 'duplicates'
  | 'start_before'
  | 'finish_before';

export interface TicketRelation {
  id: string;
  sourceTicketId: string;
  targetTicketId: string;
  relationType: TicketRelationType;
  createdAt: string;
  targetTicket?: {
    id: string;
    sequence: number;
    projectKey?: string;
    title: string;
    status: string;
  };
  sourceTicket?: {
    id: string;
    sequence: number;
    projectKey?: string;
    title: string;
    status: string;
  };
}

export interface TicketExternalLink {
  id: string;
  ticketId: string;
  platform: 'github' | 'jira' | 'linear';
  externalId: string;
  externalUrl?: string;
  syncEnabled: boolean;
  syncDirection: 'inbound' | 'outbound' | 'bidirectional';
  lastSyncAt?: string;
  createdAt: string;
}

export interface TicketCategorization {
  type: TicketType;
  priority: TicketPriority;
  labels: string[];
  confidence: number;
}

export interface TicketChecklistItem {
  id: string;
  checklistId: string;
  content: string;
  completed: boolean;
  assignee?: string;
  dueDate?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketChecklist {
  id: string;
  ticketId: string;
  title: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  items?: TicketChecklistItem[];
}

export interface TicketSuggestion {
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  suggestedLabels?: string[];
  estimatedEffort?: 'small' | 'medium' | 'large';
}

export interface SimilarTicket {
  id: string;
  sequence: number;
  title: string;
  status: TicketStatus;
  type: TicketType;
  similarity: number;
}

export interface TicketsResponse {
  tickets: Ticket[];
  total: number;
  limit: number;
  offset: number;
}

export interface TicketFilterParams {
  status?: TicketStatus | TicketStatus[];
  type?: TicketType | TicketType[];
  priority?: TicketPriority | TicketPriority[];
  assignee?: string;
  assigneeAgent?: string;
  parentId?: string;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'sequence' | 'dueDate';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// ================================
// Chat Types
// ================================

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  conversationId?: string;
  ticketId?: string;
  taskId?: string;
}

export interface ChatCompletionResponse {
  id: string;
  provider: string;
  model: string;
  message: {
    role: 'assistant';
    content: string;
  };
  finishReason: 'stop' | 'length' | 'tool-calls' | 'error';
  usage: ChatUsage;
  duration: number;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  supportsVision: boolean;
  supportsStreaming: boolean;
  costPer1MInput: number;
  costPer1MOutput: number;
}

export interface ModelAlias {
  alias: string;
  provider: string;
  model: string;
}

// Chat Intelligence Types
export interface ChatPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  examples: string[];
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export interface Conversation {
  id: string;
  title: string;
  presetId: string;
  taskId?: string;
  ticketId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: 'pending' | 'running' | 'completed' | 'error';
  error?: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost?: number;
  toolCalls?: ToolCall[];
  createdAt: string;
}

export interface ConversationWithPreview extends Conversation {
  preview: string;
  messageCount: number;
}

export interface SmartChatRequest {
  messages: ChatMessage[];
  model?: string;
  presetId?: string;
  taskId?: string;
  ticketId?: string;
  temperature?: number;
}

export interface SmartChatResponse extends ChatCompletionResponse {
  context: {
    presetId: string;
    taskId?: string;
    ticketId?: string;
  };
}

export interface MemoryStats {
  messageCount: number;
  estimatedTokens: number;
  contextWindow: number;
  usagePercentage: number;
  needsCompaction: boolean;
  summaryCount: number;
}

export interface CompactionResult {
  compacted: boolean;
  message?: string;
  originalCount?: number;
  compactedCount?: number;
  tokensReduced?: number;
  summary?: string;
  stats: MemoryStats;
}

export interface MemoryStatsResponse {
  conversationId: string;
  stats: MemoryStats;
  recommendation: string;
}

// ================================
// Gateway Types
// ================================

export interface GatewayAgent {
  type: string;
  name: string;
  description: string;
  capabilities: string[];
  health: {
    healthy: boolean;
    latencyMs?: number;
    message?: string;
  };
}

export interface GatewayWorkflow {
  type: string;
  name: string;
  description: string;
  steps: number;
  requiredCapabilities: string[];
  defaultTimeoutMs?: number;
}

export interface GatewayConfig {
  defaultTimeoutMs: number;
  maxConcurrentTasks: number;
  enableScoring: boolean;
  enableWorkflows: boolean;
  scoringWeights: {
    capability: number;
    label: number;
    priority: number;
    load: number;
    history: number;
  };
}

export interface GatewayExecuteRequest {
  task: Partial<Task>;
  preferredAgent?: string;
  workflow?: string;
  timeoutMs?: number;
  priority?: number;
  autonomous?: boolean;
  context?: Record<string, unknown>;
}

export interface GatewayExecuteResponse {
  success: boolean;
  result?: unknown;
  agent?: string;
  model?: string;
  provider?: string;
  cost?: number;
  routing?: {
    selectedAgent: string;
    reason: string;
    scores: Array<{ agent: string; score: number; breakdown: Record<string, number> }>;
    alternatives: string[];
    tier?: string;
    savingsPercent?: number;
  };
  workflow?: string;
  error?: string;
  metrics?: {
    totalDuration: number;
    routingDuration: number;
    executionDuration: number;
  };
}

export interface GatewayStatus {
  status: {
    online: boolean;
    uptime: number;
    activeRequests: number;
    maxConcurrent: number;
    utilizationPercent: number;
  };
  agents: {
    total: number;
    healthy: number;
    unhealthy: number;
    totalLoad: number;
    list: Array<{
      type: string;
      name: string;
      status: 'online' | 'offline' | 'busy' | 'error';
      healthy: boolean;
      latencyMs?: number;
      message?: string;
      load: number;
      lastHealthCheck?: string;
      currentLoad?: number;
    }>;
  };
  metrics: {
    totalTasks: number;
    successfulTasks: number;
    successRate: number;
    averageDurationMs: number;
  };
  config: GatewayConfig;
  queueStats?: {
    pending: number;
    processing: number;
    failed: number;
  };
}

// ================================
// AI Status Types
// ================================

export interface AIStatus {
  available: boolean;
  model: string;
  baseUrl: string;
}

export interface AIResponderStatus {
  available: boolean;
  model: string;
  baseUrl: string;
}

export interface AICommentResponse {
  posted: boolean;
  comment?: TicketComment;
  response?: string;
  confidence: number;
  responseType: 'answer' | 'clarification' | 'suggestion' | 'acknowledgment' | 'none';
  shouldPost?: boolean;
  durationMs: number;
  skipped?: boolean;
  reason?: string;
}

export interface AICommentAnalysis {
  response: string | null;
  confidence: number;
  responseType: 'answer' | 'clarification' | 'suggestion' | 'acknowledgment' | 'none';
  shouldPost: boolean;
  durationMs: number;
}

// ================================
// Settings Types
// ================================

export interface Settings {
  appearance: {
    theme: 'light' | 'dark' | 'midnight' | 'system';
  };
  integrations: {
    ollamaEndpoint?: string;
    githubToken?: string;
    openclawApiKey?: string;
    jiraWebhookSecret?: string;
    linearWebhookSecret?: string;
  };
  notifications: {
    taskComplete: boolean;
    taskFailed: boolean;
    budgetAlerts: boolean;
    dailyDigest: boolean;
    browserNotifications: boolean;
  };
  plugins: {
    mcpServer: { enabled: boolean; allowRead: boolean; allowWrite: boolean };
    cliAccess: { enabled: boolean; requireAuth: boolean };
    webhooks: { github: boolean; jira: boolean; linear: boolean; openclaw: boolean };
    ollama: { enabled: boolean; autoStart: boolean };
  };
  system: {
    autonomousExecution: boolean;
    telemetry: boolean;
    debugMode: boolean;
    maxConcurrentTasks: number;
    registrationMode: 'open' | 'invite';
    showForgotPassword: boolean;
    authMode: 'local' | 'multi';
  };
}

// ================================
// Plugin Health Types
// ================================

export interface PluginHealth {
  id: string;
  name: string;
  enabled: boolean;
  status: 'online' | 'offline' | 'error' | 'disabled';
  lastChecked?: string;
  message?: string;
}

// ================================
// Extended/API-specific Types
// ================================

export type ExternalPlatform = 'github' | 'jira' | 'linear' | 'plane';

export interface TicketWithRelations extends Ticket {
  externalLinks: TicketExternalLink[];
  comments: TicketComment[];
  history: TicketHistoryEntry[];
  relations: TicketRelation[];
  children?: Ticket[];
  parent?: Ticket;
}

export interface CreateTicketInput {
  title: string;
  description?: string;
  type?: TicketType;
  priority?: TicketPriority;
  status?: TicketStatus;
  labels?: string[];
  assignee?: string;
  assigneeAgent?: string;
  parentId?: string;
  projectId?: string;
  dueDate?: string;
  estimate?: number;
  estimateUnit?: 'points' | 'hours' | 'days';
  createdBy?: 'human' | 'ai';
  aiAgent?: string;
  aiSessionId?: string;
  aiTaskId?: string;
  externalLink?: {
    platform: ExternalPlatform;
    externalId: string;
    externalUrl?: string;
  };
}

export interface TicketQueryParams {
  projectId?: string;
  sprintId?: string;
  inBacklog?: boolean; // Tickets not assigned to any sprint
  status?: TicketStatus | TicketStatus[];
  type?: TicketType | TicketType[];
  priority?: TicketPriority | TicketPriority[];
  assignee?: string;
  assigneeAgent?: string;
  parentId?: string;
  search?: string;
  createdBy?: 'human' | 'ai'; // Filter by author type
  label?: string; // Single label filter
  labels?: string[]; // Multiple labels filter
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'sequence' | 'dueDate';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// ================================
// Project Types (Phase 17)
// ================================

export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: string;
  sequence: number;
  workspaceId?: string;
  key: string;              // "PROFCLAW", "MOBILE", "API"
  name: string;
  description?: string;
  icon: string;
  color: string;
  defaultAssignee?: string;
  defaultAgent?: string;
  defaultLabels: string[];
  cycleView: boolean;
  boardView: boolean;
  lead?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ProjectExternalLink {
  id: string;
  projectId: string;
  platform: ExternalPlatform;
  externalId: string;
  externalUrl?: string;
  syncEnabled: boolean;
  syncDirection: 'push' | 'pull' | 'bidirectional';
  lastSyncedAt?: string;
  syncError?: string;
  createdAt: string;
}

export interface ProjectStats {
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  doneTickets: number;
  velocity?: number;
}

export interface ProjectWithRelations extends Project {
  externalLinks: ProjectExternalLink[];
  ticketCount?: number;
  activeSprintCount?: number;
  stats?: ProjectStats;
}

export interface CreateProjectInput {
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  defaultAssignee?: string;
  defaultAgent?: string;
  defaultLabels?: string[];
  cycleView?: boolean;
  boardView?: boolean;
  lead?: string;
  externalLink?: {
    platform: ExternalPlatform;
    externalId: string;
    externalUrl?: string;
  };
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  defaultAssignee?: string;
  defaultAgent?: string;
  defaultLabels?: string[];
  cycleView?: boolean;
  boardView?: boolean;
  lead?: string;
}

export interface ProjectsResponse {
  projects: Project[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProjectQueryParams {
  status?: ProjectStatus | ProjectStatus[];
  search?: string;
  workspaceId?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'key';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

// ================================
// Sprint Types (Phase 17)
// ================================

export type SprintStatus = 'planning' | 'active' | 'completed' | 'cancelled';

export interface Sprint {
  id: string;
  sequence: number;
  projectId: string;
  name: string;
  goal?: string;
  description?: string;
  status: SprintStatus;
  startDate?: string;
  endDate?: string;
  capacity?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SprintWithStats extends Sprint {
  ticketCount: number;
  completedCount: number;
  totalPoints: number;
  completedPoints: number;
  burndown?: Array<{
    date: string;
    remaining: number;
    ideal: number;
  }>;
}

export interface CreateSprintInput {
  name: string;
  goal?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  capacity?: number;
}

export interface UpdateSprintInput {
  name?: string;
  goal?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  capacity?: number;
}

export interface SprintsResponse {
  sprints: Sprint[];
  total: number;
  limit: number;
  offset: number;
}

export interface SprintQueryParams {
  projectId?: string;
  status?: SprintStatus | SprintStatus[];
  search?: string;
  sortBy?: 'createdAt' | 'startDate' | 'endDate' | 'sequence';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SprintTicket {
  id: string;
  sprintId: string;
  ticketId: string;
  sortOrder: number;
  addedAt: string;
}

// ================================
// Dashboard Stats Types
// ================================

export interface VelocityDataPoint {
  date: string;
  created: number;
  completed: number;
}

export interface DashboardStats {
  tasks: {
    total: number;
    pending: number;
    queued: number;
    inProgress: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  tickets: {
    total: number;
    open: number;
    inProgress: number;
    done: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    aiCreated: number;
  };
  projects: {
    total: number;
    active: number;
  };
  sprints: {
    active: number;
    planning: number;
    completed: number;
  };
  summaries: {
    total: number;
    byAgent: Record<string, number>;
  };
  velocity: {
    tasks: VelocityDataPoint[];
    tickets: VelocityDataPoint[];
    weeklyAvg: {
      created: number;
      completed: number;
    };
  };
}

// ================================
// Cron / Scheduled Jobs Types
// ================================

export type JobType = 'http' | 'tool' | 'script' | 'message';
export type JobStatus = 'active' | 'paused' | 'completed' | 'failed' | 'archived';
export type RunStatus = 'pending' | 'running' | 'success' | 'failure' | 'error' | 'timeout' | 'cancelled';

export interface ScheduledJob {
  id: string;
  name: string;
  description?: string;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: string;
  timezone: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  labels: string[];
  userId?: string;
  projectId?: string;
  createdBy: 'human' | 'ai';
  lastRunAt?: string;
  lastRunStatus?: string;
  lastRunError?: string;
  nextRunAt?: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  maxRuns?: number;
  maxFailures?: number;
  expiresAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobRunHistory {
  id: string;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: RunStatus;
  output?: string;
  error?: string;
  triggeredBy: 'schedule' | 'manual' | 'event';
}

export interface CronStats {
  total: number;
  active: number;
  paused: number;
  completed: number;
  failed: number;
  archived: number;
  totalRuns: number;
  totalSuccesses: number;
  totalFailures: number;
  byType: Record<JobType, number>;
}

export interface CreateJobInput {
  name: string;
  description?: string;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: string;
  timezone?: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  labels?: string[];
  projectId?: string;
  maxRuns?: number;
  maxFailures?: number;
  expiresAt?: string;
}

export interface UpdateJobInput {
  name?: string;
  description?: string;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: string;
  timezone?: string;
  payload?: Record<string, unknown>;
  labels?: string[];
  status?: 'active' | 'paused';
  maxRuns?: number;
  maxFailures?: number;
  expiresAt?: string;
}

export interface JobsResponse {
  jobs: ScheduledJob[];
  total: number;
}

export interface JobHistoryResponse {
  history: JobRunHistory[];
  job: {
    id: string;
    name: string;
    runCount: number;
    successCount: number;
    failureCount: number;
  };
}
