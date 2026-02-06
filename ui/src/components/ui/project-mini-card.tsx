/**
 * Project Mini Card
 *
 * Compact project card for embedding in ToolCallCard results.
 * Shows icon/color swatch, name, key, and ticket count.
 */

import { FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProjectMiniCardProps {
  name: string;
  projectKey: string;
  icon?: string;
  color?: string;
  ticketCount?: number;
  description?: string;
}

export function ProjectMiniCard({
  name,
  projectKey,
  icon,
  color,
  ticketCount,
  description,
}: ProjectMiniCardProps) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl recessed-card overflow-hidden">
      {/* Icon / Color swatch */}
      <div
        className={cn(
          "h-9 w-9 flex items-center justify-center rounded-lg shrink-0 text-lg",
          color ? "" : "bg-primary/10",
        )}
        style={color ? { backgroundColor: `${color}20`, color } : undefined}
      >
        {icon || <FolderKanban className="h-4.5 w-4.5 text-primary" />}
      </div>

      {/* Name + key */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold truncate">{name}</span>
          <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider shrink-0">
            {projectKey}
          </span>
        </div>
        {description && (
          <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
            {description}
          </div>
        )}
      </div>

      {/* Ticket count badge */}
      {ticketCount !== undefined && (
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] font-bold text-muted-foreground/70 bg-foreground/5 px-2 py-0.5 rounded-full">
            {ticketCount} ticket{ticketCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

export default ProjectMiniCard;
