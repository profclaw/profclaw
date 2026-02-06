/**
 * Import Wizard Types
 *
 * Shared types for the enhanced import wizard components.
 */

// GitHub project list item (for selection step)
export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  shortDescription?: string;
  url: string;
  public: boolean;
  creator?: { login: string };
  items: { totalCount: number };
  fields: { totalCount: number };
}

// GitHub source data (items within a project)
export interface GitHubProjectItem {
  id: string;
  title: string;
  body?: string;
  url: string;
  status?: string;
  priority?: string;
  type?: string;
  labels: string[];
  assignees: string[];
  iteration?: string;
  createdAt: string;
  updatedAt: string;
  issueNumber?: number;
  repoOwner?: string;
  repoName?: string;
}

export interface GitHubIteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

export interface GitHubProjectPreview {
  project: {
    id: string;
    title: string;
    url: string;
  };
  iterations: GitHubIteration[];
  items: GitHubProjectItem[];
  fieldMappings: FieldMappings;
}

// Field mappings
export interface FieldMappings {
  status: Record<string, string>;
  priority: Record<string, string>;
  type: Record<string, string>;
}

// GLINR target values
export const GLINR_STATUSES = [
  { value: 'backlog', label: 'Backlog', color: '#6b7280' },
  { value: 'todo', label: 'To Do', color: '#3b82f6' },
  { value: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { value: 'in_review', label: 'In Review', color: '#8b5cf6' },
  { value: 'done', label: 'Done', color: '#22c55e' },
  { value: 'cancelled', label: 'Cancelled', color: '#ef4444' },
] as const;

export const GLINR_PRIORITIES = [
  { value: 'critical', label: 'Critical', color: '#ef4444' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'medium', label: 'Medium', color: '#eab308' },
  { value: 'low', label: 'Low', color: '#22c55e' },
  { value: 'none', label: 'None', color: '#6b7280' },
] as const;

export const GLINR_TYPES = [
  { value: 'task', label: 'Task', icon: '📋' },
  { value: 'bug', label: 'Bug', icon: '🐛' },
  { value: 'feature', label: 'Feature', icon: '✨' },
  { value: 'epic', label: 'Epic', icon: '🎯' },
  { value: 'story', label: 'Story', icon: '📖' },
  { value: 'subtask', label: 'Subtask', icon: '📎' },
  { value: 'improvement', label: 'Improvement', icon: '💡' },
] as const;

// Import preview item (with resolved mappings)
export interface ImportPreviewItem {
  id: string;
  source: GitHubProjectItem;
  target: {
    title: string;
    description: string;
    status: string;
    priority: string;
    type: string;
    labels: string[];
    assignee: string | null;
    createdAt: string;
    updatedAt: string;
  };
  mappingStatus: {
    status: 'mapped' | 'unmapped' | 'custom';
    priority: 'mapped' | 'unmapped' | 'custom';
    type: 'mapped' | 'unmapped' | 'custom';
  };
  conflicts: ImportConflict[];
  selected: boolean;
}

// Conflict types
export type ConflictSeverity = 'error' | 'warning' | 'info';

export interface ImportConflict {
  field: string;
  severity: ConflictSeverity;
  message: string;
  suggestion?: string;
}

// Import summary
export interface ImportSummary {
  totalItems: number;
  itemsToCreate: number;
  itemsToSkip: number;
  iterations: number;
  conflicts: {
    errors: number;
    warnings: number;
  };
  unmappedValues: {
    status: string[];
    priority: string[];
    type: string[];
  };
}

// Dry run result
export interface DryRunResult {
  success: boolean;
  summary: ImportSummary;
  items: ImportPreviewItem[];
  iterations: GitHubIteration[];
  fieldMappings: FieldMappings;
}
