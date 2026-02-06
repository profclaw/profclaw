/**
 * GLINR AI-Native Ticket System Types
 *
 * Universal schema designed for bi-directional sync with:
 * - GitHub Issues
 * - Linear
 * - Jira
 * - Plane
 */

import { z } from "zod";

// === Enums ===

export const TicketType = z.enum([
  "task",
  "bug",
  "feature",
  "epic",
  "story",
  "subtask",
]);
export type TicketType = z.infer<typeof TicketType>;

export const TicketPriority = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "none",
]);
export type TicketPriority = z.infer<typeof TicketPriority>;

export const TicketStatus = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

// State groups for custom workflow states (maps custom states to core groups)
export const StateGroup = z.enum([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
]);
export type StateGroup = z.infer<typeof StateGroup>;

export const ExternalPlatform = z.enum([
  "github",
  "linear",
  "jira",
  "plane",
  "monday",
]);
export type ExternalPlatform = z.infer<typeof ExternalPlatform>;

export const SyncDirection = z.enum(["push", "pull", "bidirectional"]);
export type SyncDirection = z.infer<typeof SyncDirection>;

export const AuthorType = z.enum(["human", "ai"]);
export type AuthorType = z.infer<typeof AuthorType>;

// === External Link (1 ticket -> N platforms) ===

export const ExternalLinkSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  platform: ExternalPlatform,
  externalId: z.string(), // PROJ-123, LIN-456, #789
  externalUrl: z.string().url().optional(),
  syncEnabled: z.boolean().default(true),
  syncDirection: SyncDirection.default("bidirectional"),
  lastSyncedAt: z.string().datetime().optional(),
  syncError: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type ExternalLink = z.infer<typeof ExternalLinkSchema>;

// === Ticket Relations (issue links) ===

export const TicketRelationType = z.enum([
  "blocks",
  "blocked_by",
  "relates_to",
  "duplicates",
  "start_before",
  "finish_before",
]);
export type TicketRelationType = z.infer<typeof TicketRelationType>;

export const TicketRelationSchema = z.object({
  id: z.string(),
  sourceTicketId: z.string(),
  targetTicketId: z.string(),
  relationType: TicketRelationType,
  createdAt: z.string().datetime(),
});

export type TicketRelation = z.infer<typeof TicketRelationSchema>;

// === Ticket Watchers ===

export const TicketWatcherSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  userId: z.string(),
  createdAt: z.string().datetime(),
});

export type TicketWatcher = z.infer<typeof TicketWatcherSchema>;

// === Ticket Assignees ===

export const TicketAssigneeSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  userId: z.string(),
  createdAt: z.string().datetime(),
});

export type TicketAssignee = z.infer<typeof TicketAssigneeSchema>;

// === Ticket Mentions ===

export const TicketMentionSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  userId: z.string(),
  source: z.enum(["description", "comment", "history"]),
  sourceId: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type TicketMention = z.infer<typeof TicketMentionSchema>;

// === Ticket Attachments ===

export const TicketAttachmentSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  fileName: z.string(),
  fileType: z.string().optional(),
  fileSize: z.number().optional(),
  url: z.string().url(),
  storagePath: z.string().optional(),
  uploadedBy: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type TicketAttachment = z.infer<typeof TicketAttachmentSchema>;

// === Ticket Reactions ===

export const TicketReactionSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  userId: z.string(),
  emoji: z.string(),
  createdAt: z.string().datetime(),
});

export type TicketReaction = z.infer<typeof TicketReactionSchema>;

// === Unified Comment (aggregated from all platforms) ===

export const CommentAuthorSchema = z.object({
  type: AuthorType,
  name: z.string(),
  platform: z.string(), // Where comment originated
  avatarUrl: z.string().url().optional(),
});

export const TicketCommentSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  content: z.string(),
  contentHtml: z.string().optional(),
  author: CommentAuthorSchema,
  source: z.enum(["glinr", "github", "linear", "jira", "plane"]),
  externalId: z.string().optional(), // ID in source system
  isAiResponse: z.boolean().default(false),
  respondingTo: z.string().optional(), // Comment ID it's replying to
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

export type TicketComment = z.infer<typeof TicketCommentSchema>;

// === History Entry (audit trail) ===

export const HistoryEntrySchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  field: z.string(), // "status", "assignee", "title"
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
  changedBy: CommentAuthorSchema,
  timestamp: z.string().datetime(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

// === Core Ticket ===

export const TicketSchema = z.object({
  // === Core Identity ===
  id: z.string(),
  sequence: z.number(), // Human-readable: GLINR-123
  workspaceId: z.string().optional(),
  projectId: z.string().optional(), // Multi-project support

  // === Content ===
  title: z.string().min(1),
  description: z.string().default(""),
  descriptionHtml: z.string().optional(),

  // === Classification ===
  type: TicketType.default("task"),
  priority: TicketPriority.default("medium"),
  status: TicketStatus.default("backlog"),
  labels: z.array(z.string()).default([]),

  // === Assignment ===
  assignee: z.string().optional(), // User ID
  assigneeAgent: z.string().optional(), // AI agent ID (claude, openclaw, ollama)

  // === Relationships ===
  parentId: z.string().optional(), // Epic/parent ticket
  linkedPRs: z.array(z.string()).default([]), // GitHub PR URLs
  linkedCommits: z.array(z.string()).default([]), // Commit SHAs
  linkedBranch: z.string().optional(), // Working branch

  // === Timestamps ===
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  startDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),

  // === AI Metadata ===
  createdBy: AuthorType.default("human"),
  aiAgent: z.string().optional(), // Which agent created it
  aiSessionId: z.string().optional(), // Link to Claude session
  aiTaskId: z.string().optional(), // Link to GLINR task

  // === Estimation ===
  estimate: z.number().optional(), // Story points or hours
  estimateUnit: z.enum(["points", "hours", "days"]).optional(),
});

export type Ticket = z.infer<typeof TicketSchema>;

// === Ticket with Relations (full view) ===

export interface TicketWithRelations extends Ticket {
  externalLinks: ExternalLink[];
  comments: TicketComment[];
  history: HistoryEntry[];
  relations: TicketRelation[];
  watchers: TicketWatcher[];
  assignees: TicketAssignee[];
  mentions: TicketMention[];
  attachments: TicketAttachment[];
  reactions: TicketReaction[];
  children?: Ticket[]; // Subtasks
  parent?: Ticket; // Epic/parent
}

// === Create/Update Schemas ===

export const CreateTicketSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  type: TicketType.optional(),
  priority: TicketPriority.optional(),
  status: TicketStatus.optional(),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  assigneeAgent: z.string().optional(),
  parentId: z.string().optional(),
  projectId: z.string().optional(), // Multi-project support
  startDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  estimate: z.number().optional(),
  estimateUnit: z.enum(["points", "hours", "days"]).optional(),
  // AI metadata
  createdBy: AuthorType.optional(),
  aiAgent: z.string().optional(),
  aiSessionId: z.string().optional(),
  aiTaskId: z.string().optional(),
  // External link on creation
  externalLink: z
    .object({
      platform: ExternalPlatform,
      externalId: z.string(),
      externalUrl: z.string().url().optional(),
    })
    .optional(),
});

export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const UpdateTicketSchema = CreateTicketSchema.partial();
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

// === Bulk Schemas ===

export const BulkUpdateTicketsSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one ticket ID is required"),
  updates: UpdateTicketSchema,
});

export type BulkUpdateTicketsInput = z.infer<typeof BulkUpdateTicketsSchema>;

export const BulkDeleteTicketsSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one ticket ID is required"),
});

export type BulkDeleteTicketsInput = z.infer<typeof BulkDeleteTicketsSchema>;

// === Query Schemas ===

export const TicketQuerySchema = z.object({
  // Project/Sprint filtering
  projectId: z.string().optional(),
  sprintId: z.string().optional(),
  inBacklog: z.boolean().optional(), // Tickets not assigned to any sprint
  // Status filtering
  status: z.union([TicketStatus, z.array(TicketStatus)]).optional(),
  type: z.union([TicketType, z.array(TicketType)]).optional(),
  priority: z.union([TicketPriority, z.array(TicketPriority)]).optional(),
  assignee: z.string().optional(),
  assigneeAgent: z.string().optional(),
  labels: z.array(z.string()).optional(),
  label: z.string().optional(), // Single label filter (for simple UI)
  parentId: z.string().optional(),
  search: z.string().optional(),
  createdBy: z.enum(["human", "ai"]).optional(), // Filter by author type
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  startDateAfter: z.string().datetime().optional(),
  startDateBefore: z.string().datetime().optional(),
  sortBy: z
    .enum([
      "createdAt",
      "updatedAt",
      "priority",
      "sequence",
      "dueDate",
      "startDate",
    ])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.number().min(1).max(200).optional(), // Increased for board views
  offset: z.number().min(0).optional(),
  includeArchived: z.boolean().optional(),
  // Cursor-based pagination (Phase 17)
  cursorCreatedAt: z.date().optional(),
  cursorId: z.string().optional(),
});

export type TicketQuery = z.infer<typeof TicketQuerySchema>;

// === Status Mapping (Cross-Platform) ===

export const STATUS_MAP: Record<TicketStatus, Record<string, string>> = {
  backlog: { jira: "To Do", linear: "Backlog", github: "open" },
  todo: { jira: "To Do", linear: "Todo", github: "open" },
  in_progress: { jira: "In Progress", linear: "In Progress", github: "open" },
  in_review: { jira: "In Review", linear: "In Review", github: "open" },
  done: { jira: "Done", linear: "Done", github: "closed" },
  cancelled: { jira: "Cancelled", linear: "Cancelled", github: "closed" },
};

export const REVERSE_STATUS_MAP: Record<
  string,
  Record<string, TicketStatus>
> = {
  jira: {
    "To Do": "todo",
    "In Progress": "in_progress",
    "In Review": "in_review",
    Done: "done",
    Cancelled: "cancelled",
  },
  linear: {
    Backlog: "backlog",
    Todo: "todo",
    "In Progress": "in_progress",
    "In Review": "in_review",
    Done: "done",
    Cancelled: "cancelled",
  },
  github: {
    open: "todo",
    closed: "done",
  },
};

// === Priority Mapping ===

export const PRIORITY_MAP: Record<
  TicketPriority,
  Record<string, string | number>
> = {
  critical: { jira: "Highest", linear: "Urgent", github: "P0" },
  high: { jira: "High", linear: "High", github: "P1" },
  medium: { jira: "Medium", linear: "Medium", github: "P2" },
  low: { jira: "Low", linear: "Low", github: "P3" },
  none: { jira: "Lowest", linear: "None", github: "" },
};
