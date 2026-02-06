/**
 * Import Summary Card
 *
 * Shows a visual summary of what will be created during import.
 * Highlights conflicts and warnings.
 */

import {
  FileText,
  Target,
  Tag,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Link2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ImportSummary, GitHubIteration } from './types';

interface ImportSummaryCardProps {
  summary: ImportSummary;
  iterations: GitHubIteration[];
  projectKey: string;
  enableSync: boolean;
}

export function ImportSummaryCard({
  summary,
  iterations,
  projectKey,
  enableSync,
}: ImportSummaryCardProps) {
  const hasErrors = summary.conflicts.errors > 0;
  const hasWarnings = summary.conflicts.warnings > 0;

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      {hasErrors ? (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Cannot proceed with import</p>
            <p className="text-sm text-muted-foreground">
              {summary.conflicts.errors} error{summary.conflicts.errors !== 1 ? 's' : ''} must be resolved
            </p>
          </div>
        </div>
      ) : hasWarnings ? (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Ready with warnings
            </p>
            <p className="text-sm text-muted-foreground">
              {summary.conflicts.warnings} item{summary.conflicts.warnings !== 1 ? 's' : ''} will use default values
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          <div>
            <p className="font-medium text-green-700 dark:text-green-400">
              Ready to import
            </p>
            <p className="text-sm text-muted-foreground">
              All fields mapped correctly
            </p>
          </div>
        </div>
      )}

      {/* What will be created */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">What will be created</h4>

        <div className="grid grid-cols-3 gap-3">
          {/* Tickets */}
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <span className="text-2xl font-bold">{summary.itemsToCreate}</span>
            </div>
            <p className="text-xs text-muted-foreground">Tickets</p>
            <p className="text-xs text-muted-foreground mt-1">
              {projectKey}-1 → {projectKey}-{summary.itemsToCreate}
            </p>
          </div>

          {/* Sprints */}
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Target className="h-4 w-4 text-amber-500" />
              </div>
              <span className="text-2xl font-bold">{iterations.length}</span>
            </div>
            <p className="text-xs text-muted-foreground">Sprints</p>
            {iterations.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {iterations[0].title}
                {iterations.length > 1 && ` +${iterations.length - 1} more`}
              </p>
            )}
          </div>

          {/* Labels */}
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <Tag className="h-4 w-4 text-indigo-500" />
              </div>
              <span className="text-2xl font-bold">
                {summary.unmappedValues.status.length +
                  summary.unmappedValues.priority.length +
                  summary.unmappedValues.type.length || '—'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Unique labels</p>
          </div>
        </div>
      </div>

      {/* Sync Status */}
      {enableSync && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">Bidirectional sync enabled</p>
            <p className="text-xs text-muted-foreground">
              Changes will sync between profClaw and GitHub
            </p>
          </div>
          <Badge variant="outline" className="text-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Active
          </Badge>
        </div>
      )}

      {/* Timestamps info */}
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium">Original dates preserved</p>
          <p className="text-xs text-muted-foreground">
            Created/updated timestamps will be imported from GitHub
          </p>
        </div>
      </div>

      {/* Skipped items */}
      {summary.itemsToSkip > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm">
              <span className="font-medium">{summary.itemsToSkip}</span> items will be skipped
            </p>
            <p className="text-xs text-muted-foreground">
              These items are deselected or have errors
            </p>
          </div>
        </div>
      )}

      {/* Unmapped values detail */}
      {(summary.unmappedValues.status.length > 0 ||
        summary.unmappedValues.priority.length > 0 ||
        summary.unmappedValues.type.length > 0) && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-amber-600">Unmapped values (using defaults)</h4>
          <div className="space-y-1 text-xs">
            {summary.unmappedValues.status.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-16">Status:</span>
                <div className="flex flex-wrap gap-1">
                  {summary.unmappedValues.status.map((v) => (
                    <span key={v} className="font-mono bg-muted px-1.5 py-0.5 rounded">
                      {v}
                    </span>
                  ))}
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge variant="secondary">backlog</Badge>
              </div>
            )}
            {summary.unmappedValues.priority.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-16">Priority:</span>
                <div className="flex flex-wrap gap-1">
                  {summary.unmappedValues.priority.map((v) => (
                    <span key={v} className="font-mono bg-muted px-1.5 py-0.5 rounded">
                      {v}
                    </span>
                  ))}
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge variant="secondary">medium</Badge>
              </div>
            )}
            {summary.unmappedValues.type.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-16">Type:</span>
                <div className="flex flex-wrap gap-1">
                  {summary.unmappedValues.type.map((v) => (
                    <span key={v} className="font-mono bg-muted px-1.5 py-0.5 rounded">
                      {v}
                    </span>
                  ))}
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge variant="secondary">task</Badge>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
