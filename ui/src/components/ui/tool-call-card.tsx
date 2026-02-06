/**
 * Tool Call Card
 *
 * Displays tool execution information in chat messages.
 * Shows tool name, arguments, and output in a collapsible format.
 * GLINR tools show formatted markdown summary by default with JSON toggle.
 */

import { useState } from "react";
import {
  Terminal,
  FileCode,
  Search,
  Globe,
  Settings,
  Database,
  ChevronDown,
  Copy,
  Check,
  Code,
  FileText,
  Ticket,
  FolderKanban,
  ListTodo,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolResultRenderer } from "./tool-result-renderer";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  duration?: number;
}

interface ToolCallCardProps {
  tool: ToolCall;
  className?: string;
}

// Map tool names to icons
const TOOL_ICONS: Record<string, typeof Terminal> = {
  exec: Terminal,
  bash: Terminal,
  shell: Terminal,
  read_file: FileCode,
  write_file: FileCode,
  edit_file: FileCode,
  search_files: Search,
  grep: Search,
  glob: Search,
  web_fetch: Globe,
  web_search: Globe,
  system_info: Settings,
  env_vars: Settings,
  git_status: FileCode,
  git_diff: FileCode,
  git_log: FileCode,
  git_commit: FileCode,
  database: Database,
  query: Database,
  // GLINR tools
  create_ticket: Ticket,
  update_ticket: Ticket,
  get_ticket: Ticket,
  list_tickets: ListTodo,
  create_project: FolderKanban,
  list_projects: FolderKanban,
  // Cron tools
  cron_create: Clock,
  cron_list: Clock,
  cron_trigger: Clock,
  cron_pause: Clock,
  cron_delete: Clock,
  cron_archive: Clock,
  cron_history: Clock,
  default: Terminal,
};

// Get display label for tool
function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    exec: "Run Command",
    bash: "Bash",
    shell: "Shell",
    read_file: "Read File",
    write_file: "Write File",
    edit_file: "Edit File",
    search_files: "Search Files",
    grep: "Search Content",
    glob: "Find Files",
    web_fetch: "Fetch URL",
    web_search: "Web Search",
    system_info: "System Info",
    env_vars: "Environment",
    git_status: "Git Status",
    git_diff: "Git Diff",
    git_log: "Git Log",
    git_commit: "Git Commit",
    // GLINR tools
    create_ticket: "Create Ticket",
    update_ticket: "Update Ticket",
    get_ticket: "Get Ticket",
    list_tickets: "List Tickets",
    create_project: "Create Project",
    list_projects: "List Projects",
    // Cron tools
    cron_create: "Create Job",
    cron_list: "List Jobs",
    cron_trigger: "Trigger Job",
    cron_pause: "Pause/Resume Job",
    cron_delete: "Delete Job",
    cron_archive: "Archive Job",
    cron_history: "Job History",
  };
  return (
    labels[name] ||
    name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// Format tool arguments for display
function formatArguments(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";

  // For single command/path argument, show just the value
  if (entries.length === 1) {
    const [key, value] = entries[0];
    if (
      key === "command" ||
      key === "path" ||
      key === "query" ||
      key === "url"
    ) {
      return String(value);
    }
  }

  // Show key: value pairs, truncated
  return entries
    .map(([key, value]) => {
      const strValue =
        typeof value === "string" ? value : JSON.stringify(value);
      const truncated =
        strValue.length > 50 ? strValue.slice(0, 50) + "..." : strValue;
      return `${key}: ${truncated}`;
    })
    .join(", ");
}

/** Extract output and data from a tool result */
function extractResultParts(result: unknown): {
  output?: string;
  data?: unknown;
  hasSmartOutput: boolean;
} {
  if (!result || typeof result !== "object") {
    return { hasSmartOutput: false };
  }
  const record = result as Record<string, unknown>;
  const output = typeof record.output === "string" ? record.output : undefined;
  const data = record.data !== undefined ? record.data : undefined;
  return { output, data, hasSmartOutput: !!output };
}

/** Get a one-line summary from the output or result */
function getSummaryLine(tool: ToolCall): string {
  const { output, data } = extractResultParts(tool.result);

  // Use first heading from output
  if (output) {
    const headingMatch = output.match(/^#{1,3}\s+(.+)/m);
    if (headingMatch) return headingMatch[1].trim();
    const firstLine = output.split("\n").find((l) => l.trim());
    if (firstLine) {
      const clean = firstLine
        .replace(/^[#*\s]+/, "")
        .replace(/\*\*/g, "")
        .trim();
      return clean.length > 80 ? clean.slice(0, 80) + "..." : clean;
    }
  }

  // Derive from data
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.key && d.title) return `${d.key}: ${d.title}`;
    if (d.name && d.key) return `${d.name} (${d.key})`;
    if (d.total !== undefined) return `${d.total} result(s)`;
  }

  return "";
}

function inferToolStatus(
  tool: ToolCall,
  hasResult: boolean,
): ToolCall["status"] {
  if (tool.status) return tool.status;
  if (!hasResult) return undefined;

  if (tool.result && typeof tool.result === "object") {
    const record = tool.result as Record<string, unknown>;
    if (record.pending === true) return "pending";
    if (record.success === false || record.error) return "error";
  }

  return "success";
}

type ViewMode = "summary" | "json";

export function ToolCallCard({ tool, className }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("summary");
  const [copied, setCopied] = useState(false);

  const Icon = TOOL_ICONS[tool.name] || TOOL_ICONS.default;
  const label = getToolLabel(tool.name);
  const argsDisplay = formatArguments(tool.arguments);
  const hasResult = tool.result !== undefined && tool.result !== null;
  const { output, hasSmartOutput } = extractResultParts(tool.result);
  // Tools that have structured mini-card rendering via ToolResultRenderer
  const SMART_TOOLS = [
    "create_ticket", "update_ticket", "get_ticket", "list_tickets",
    "create_project", "list_projects",
  ];
  const hasSmartView = hasSmartOutput || SMART_TOOLS.includes(tool.name);
  const summaryLine = hasResult ? getSummaryLine(tool) : "";
  const inferredStatus = inferToolStatus(tool, hasResult);
  const isSuccess = inferredStatus === "success";
  const isError = inferredStatus === "error";
  const isPending =
    inferredStatus === "pending" || inferredStatus === "running";

  const handleCopy = async () => {
    let content: string;
    if (viewMode === "summary" && output) {
      content = output;
    } else {
      content = hasResult
        ? typeof tool.result === "string"
          ? tool.result
          : JSON.stringify(tool.result, null, 2)
        : "";
    }
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "my-3 premium-card overflow-hidden group/card",
        isError && "border-red-500/20",
        className,
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${label} tool results`}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-foreground/[0.02] transition-colors text-left"
      >
        <div
          className={cn(
            "h-10 w-10 flex items-center justify-center rounded-xl transition-all duration-300",
            isError
              ? "bg-red-500/10 text-red-500 shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)]"
              : isPending
                ? "bg-blue-500/10 text-blue-500"
                : "bg-primary/10 text-primary shadow-[0_0_15px_-3px_var(--primary-glow)]",
          )}
        >
          <Icon className={cn("h-5 w-5", isPending && "animate-pulse")} aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-[14px] leading-tight tracking-tight">
              {label}
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              {isPending && (
                <>
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse status-glow-info" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                    Running
                  </span>
                </>
              )}
              {isSuccess && (
                <>
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 status-glow-success" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-green-500">
                    Success
                  </span>
                </>
              )}
              {isError && (
                <>
                  <div className="h-1.5 w-1.5 rounded-full bg-red-500 status-glow-destructive" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                    Failed
                  </span>
                </>
              )}
            </div>
          </div>
          {/* Show summary line or args */}
          {summaryLine ? (
            <div className="text-[11px] text-muted-foreground/80 truncate opacity-70 group-hover/card:opacity-100 transition-opacity">
              {summaryLine}
            </div>
          ) : argsDisplay ? (
            <div className="text-[11px] text-muted-foreground/80 font-mono truncate opacity-60 group-hover/card:opacity-100 transition-opacity">
              {argsDisplay}
            </div>
          ) : null}
        </div>

        <div className="ml-2 flex items-center gap-2">
          {tool.duration != null && (
            <span className="text-[10px] font-mono font-medium text-muted-foreground/40">
              {tool.duration >= 1000 ? `${(tool.duration / 1000).toFixed(1)}s` : `${tool.duration}ms`}
            </span>
          )}
          {hasResult && (
            <div
              className={cn(
                "p-1 rounded-md transition-transform duration-200",
                expanded && "rotate-180",
              )}
            >
              <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
            </div>
          )}
        </div>
      </button>

      {/* Loading shimmer for pending/running tools */}
      {isPending && (
        <div className="px-4 pb-3">
          <div className="h-2 rounded-full overflow-hidden bg-muted/30">
            <div className="h-full w-full skeleton-shimmer rounded-full bg-blue-500/20" />
          </div>
        </div>
      )}

      {/* Collapsed preview — only show when no smart output */}
      {!expanded && hasResult && !hasSmartView && argsDisplay && (
        <div className="px-4 pb-3">
          <div className="recessed-card p-2 rounded-lg">
            <div className="text-[11px] text-muted-foreground/90 font-mono line-clamp-2 leading-relaxed">
              {typeof tool.result === "string"
                ? tool.result.slice(0, 100)
                : JSON.stringify(tool.result, null, 2).slice(0, 100)}
              {JSON.stringify(tool.result).length > 100 ? "..." : ""}
            </div>
          </div>
        </div>
      )}

      {/* Expanded content */}
      {expanded && hasResult && (
        <div className="border-t border-border/10">
          {/* Toolbar: view toggle + copy */}
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              {hasSmartView && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewMode("summary");
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                      viewMode === "summary"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5",
                    )}
                    aria-label="Show summary view"
                  >
                    <FileText className="h-3 w-3" />
                    Summary
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewMode("json");
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                      viewMode === "json"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5",
                    )}
                    aria-label="Show JSON view"
                  >
                    <Code className="h-3 w-3" />
                    JSON
                  </button>
                </>
              )}
              {!hasSmartView && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                  Output
                </span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-all text-muted-foreground hover:text-foreground"
              aria-label="Copy tool output"
            >
              {copied ? (
                <Check
                  className="h-3.5 w-3.5 text-green-400"
                  aria-hidden="true"
                />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Content area */}
          <div className="px-4 pb-4">
            {viewMode === "summary" ? (
              <div className="prose prose-sm prose-invert max-w-none rounded-xl bg-black/10 p-4 border border-white/5 overflow-y-auto max-h-80 scrollbar-glass">
                <ToolResultRenderer
                  toolName={tool.name}
                  result={tool.result}
                  output={output}
                />
              </div>
            ) : (
              <pre className="text-[12px] font-mono bg-black/20 rounded-xl p-4 overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all border border-white/5 scrollbar-glass">
                {typeof tool.result === "string"
                  ? tool.result
                  : JSON.stringify(tool.result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Tool Call Group — collapses 3+ tools by default
// =============================================================================

interface ToolCallGroupProps {
  tools: ToolCall[];
  className?: string;
}

export function ToolCallGroup({ tools, className }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(tools.length < 3);

  if (tools.length === 0) return null;

  if (tools.length < 3) {
    return (
      <div className={className}>
        {tools.map((tool) => (
          <ToolCallCard key={tool.id} tool={tool} />
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {expanded ? (
        <>
          {tools.map((tool) => (
            <ToolCallCard key={tool.id} tool={tool} />
          ))}
          <button
            onClick={() => setExpanded(false)}
            className="w-full text-center py-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Collapse {tools.length} tools
          </button>
        </>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-border/20 bg-card/30 hover:bg-card/50 transition-colors"
        >
          <Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-[12px] font-medium text-muted-foreground/80">
            Show {tools.length} tool calls
          </span>
        </button>
      )}
    </div>
  );
}

export default ToolCallCard;
