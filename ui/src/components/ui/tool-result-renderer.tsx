/**
 * Tool Result Renderer
 *
 * Smart dispatcher that renders the right UI component based on tool name
 * and result data. Falls back to markdown or raw JSON when no smart
 * component matches.
 */

import MarkdownRenderer from "./markdown-renderer";
import { TicketMiniCard, type TicketMiniCardProps } from "./ticket-mini-card";
import { ProjectMiniCard, type ProjectMiniCardProps } from "./project-mini-card";

interface ToolResultRendererProps {
  toolName: string;
  result: unknown;
  /** Human-readable markdown output from the tool */
  output?: string;
}

/** Safely extract typed data from a result object */
function getData(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  // Data may be at top level (clean result) or nested under .data
  if (record.data && typeof record.data === "object") {
    return record.data as Record<string, unknown>;
  }
  return record;
}

/** Extract ticket props from result data */
function toTicketProps(
  data: Record<string, unknown>,
): TicketMiniCardProps | null {
  const key = data.key as string | undefined;
  const title = data.title as string | undefined;
  if (!key || !title) return null;

  return {
    ticketKey: key,
    title,
    status: (data.status as string) || "todo",
    type: (data.type as string) || "task",
    priority: (data.priority as string) || "medium",
    labels: data.labels as string[] | undefined,
  };
}

/** Extract project props from result data */
function toProjectProps(
  data: Record<string, unknown>,
): ProjectMiniCardProps | null {
  const name = data.name as string | undefined;
  const key = data.key as string | undefined;
  if (!name || !key) return null;

  return {
    name,
    projectKey: key,
    icon: data.icon as string | undefined,
    color: data.color as string | undefined,
    ticketCount: data.ticketCount as number | undefined,
    description: data.description as string | undefined,
  };
}

export function ToolResultRenderer({
  toolName,
  result,
  output,
}: ToolResultRendererProps) {
  const data = getData(result);

  // === Ticket tools ===
  if (
    (toolName === "create_ticket" ||
      toolName === "update_ticket" ||
      toolName === "get_ticket") &&
    data
  ) {
    const ticketProps = toTicketProps(data);
    if (ticketProps) {
      return (
        <div className="space-y-2">
          <TicketMiniCard {...ticketProps} />
          {/* Show additional output below the card if available */}
          {output && (
            <div className="text-[11px] text-muted-foreground/60 mt-1">
              <MarkdownRenderer content={output} />
            </div>
          )}
        </div>
      );
    }
  }

  // === List tickets ===
  if (toolName === "list_tickets" && data) {
    const tickets = (data.tickets as Record<string, unknown>[] | undefined) ?? [];
    if (tickets.length > 0) {
      const displayTickets = tickets.slice(0, 5);
      const remaining = tickets.length - displayTickets.length;

      return (
        <div className="space-y-1.5">
          {displayTickets.map((t, i) => {
            const props = toTicketProps(t);
            return props ? (
              <TicketMiniCard key={props.ticketKey || i} {...props} />
            ) : null;
          })}
          {remaining > 0 && (
            <div className="text-[11px] text-muted-foreground/50 text-center py-1">
              and {remaining} more ticket{remaining !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      );
    }
  }

  // === Project tools ===
  if (toolName === "create_project" && data) {
    const projectProps = toProjectProps(data);
    if (projectProps) {
      return (
        <div className="space-y-2">
          <ProjectMiniCard {...projectProps} />
          {output && (
            <div className="text-[11px] text-muted-foreground/60 mt-1">
              <MarkdownRenderer content={output} />
            </div>
          )}
        </div>
      );
    }
  }

  // === List projects ===
  if (toolName === "list_projects" && data) {
    const projects = (data.projects as Record<string, unknown>[] | undefined) ?? [];
    if (projects.length > 0) {
      return (
        <div className="space-y-1.5">
          {projects.map((p, i) => {
            const props = toProjectProps(p);
            return props ? (
              <ProjectMiniCard key={props.projectKey || i} {...props} />
            ) : null;
          })}
        </div>
      );
    }
  }

  // === Fallback: Markdown output ===
  if (output) {
    return <MarkdownRenderer content={output} />;
  }

  // === Fallback: Raw JSON ===
  if (result !== undefined && result !== null) {
    const stringified = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    // Handle empty strings, empty objects/arrays
    if (!stringified || stringified === '{}' || stringified === '[]' || stringified === '""') {
      return (
        <div className="text-[12px] text-muted-foreground/50 italic py-2">
          No output returned
        </div>
      );
    }
    return (
      <pre className="text-[12px] font-mono bg-black/20 rounded-xl p-4 overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all border border-white/5 scrollbar-glass">
        {stringified}
      </pre>
    );
  }

  // Truly empty — tool returned nothing
  return (
    <div className="text-[12px] text-muted-foreground/50 italic py-2">
      No output returned
    </div>
  );
}

export default ToolResultRenderer;
