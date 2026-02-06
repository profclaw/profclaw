/**
 * Skills Section - Settings UI
 *
 * View and manage the skills system: browse loaded skills,
 * check eligibility, toggle enable/disable, reload from disk.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Puzzle,
  RefreshCw,
  Check,
  X,
  ChevronRight,
  Loader2,
  Plug,
  Cpu,
  Download,
  ToggleLeft,
  ToggleRight,
  Info,
  AlertTriangle,
  GitCommit,
  Bug,
  Code,
  TestTube,
  Layout,
  Smartphone,
  Search,
  Wrench,
  Bot,
  Globe,
  FileCode,
  Shield,
  Zap,
  BookOpen,
  Keyboard,
  Route,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { API_BASE } from "../constants";

interface SkillItem {
  name: string;
  source: string;
  enabled: boolean;
  eligible: boolean;
  errors: string[];
  emoji?: string;
  description: string;
  userInvocable: boolean;
  modelInvocable: boolean;
  toolCategories: string[];
}

interface SkillsResponse {
  skills: SkillItem[];
  stats: {
    total: number;
    eligible: number;
    enabled: number;
    bySource: Record<string, number>;
    mcpServers: number;
    estimatedTokens: number;
  };
}

interface SkillDetail {
  name: string;
  description: string;
  source: string;
  dirPath: string;
  eligible: boolean;
  eligibilityErrors: string[];
  enabled: boolean;
  invocation: { userInvocable: boolean; modelInvocable: boolean };
  metadata?: {
    emoji?: string;
    homepage?: string;
    primaryEnv?: string;
    toolCategories?: string[];
    install?: Array<{ kind: string; label?: string; id?: string }>;
  };
  command?: { name: string; description: string };
  instructions: string;
}

const SOURCE_COLORS: Record<string, string> = {
  bundled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  managed: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  workspace: "bg-green-500/10 text-green-400 border-green-500/20",
  plugin: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

/** Map skill names/keywords to Lucide icons */
const SKILL_ICON_MAP: Record<string, LucideIcon> = {
  "git-commit": GitCommit,
  "commit": GitCommit,
  "debugging": Bug,
  "systematic-debugging": Bug,
  "mobile-app-debugging": Bug,
  "code-review": Search,
  "code-review-excellence": Search,
  "testing": TestTube,
  "javascript-testing-patterns": TestTube,
  "e2e-testing-patterns": TestTube,
  "webapp-testing": TestTube,
  "ui-patterns": Layout,
  "building-native-ui": Layout,
  "react-native": Smartphone,
  "react-native-basics": Smartphone,
  "react-native-architecture": Smartphone,
  "react-native-best-practices": Smartphone,
  "react-native-expo": Smartphone,
  "vercel-react-native-skills": Smartphone,
  "mobile-developer": Smartphone,
  "find-skills": Search,
  "skill-creator": Wrench,
  "glinr-agents": Bot,
  "subagent-driven-development": Bot,
  "graphql-operations": Globe,
  "api-conventions": FileCode,
  "keybindings-help": Keyboard,
  "task-router": Route,
  "claude-router": Zap,
};

function getSkillIcon(name: string): LucideIcon {
  // Exact match
  if (SKILL_ICON_MAP[name]) return SKILL_ICON_MAP[name];
  // Prefix match (e.g. "claude-router:route" → "claude-router")
  const prefix = name.split(":")[0];
  if (SKILL_ICON_MAP[prefix]) return SKILL_ICON_MAP[prefix];
  // Keyword match
  const lower = name.toLowerCase();
  if (lower.includes("test")) return TestTube;
  if (lower.includes("debug") || lower.includes("bug")) return Bug;
  if (lower.includes("commit") || lower.includes("git")) return GitCommit;
  if (lower.includes("mobile") || lower.includes("native")) return Smartphone;
  if (lower.includes("ui") || lower.includes("layout")) return Layout;
  if (lower.includes("api") || lower.includes("graphql")) return Globe;
  if (lower.includes("agent") || lower.includes("bot")) return Bot;
  if (lower.includes("security") || lower.includes("auth")) return Shield;
  if (lower.includes("code")) return Code;
  if (lower.includes("doc") || lower.includes("learn")) return BookOpen;
  return Puzzle;
}

export function SkillsSection() {
  const queryClient = useQueryClient();
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  // Fetch skills list
  const { data, isLoading, error } = useQuery<SkillsResponse>({
    queryKey: ["skills"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/skills`, { credentials: 'include' });
      if (!res.ok) throw new Error("Failed to fetch skills");
      return res.json();
    },
  });

  // Fetch skill detail
  const { data: detail, isLoading: detailLoading } = useQuery<SkillDetail>({
    queryKey: ["skills", selectedSkill],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/skills/${selectedSkill}`, { credentials: 'include' });
      if (!res.ok) throw new Error("Failed to fetch skill detail");
      return res.json();
    },
    enabled: !!selectedSkill,
  });

  // Reload mutation
  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/skills/reload`, {
        method: "POST",
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to reload skills");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success(
        `Skills reloaded: ${result.stats.totalSkills} loaded`
      );
    },
    onError: () => toast.error("Failed to reload skills"),
  });

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/skills/${name}/toggle`, {
        method: "POST",
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to toggle skill");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success(
        `${result.name} ${result.enabled ? "enabled" : "disabled"}`
      );
    },
  });

  // Install mutation
  const installMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API_BASE}/api/skills/${name}/install`, {
        method: "POST",
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to install dependencies");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      if (result.allSucceeded) {
        toast.success(`Dependencies installed for ${result.skill}`);
      } else {
        toast.error("Some dependencies failed to install");
      }
    },
    onError: () => toast.error("Failed to install dependencies"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">
        <AlertTriangle className="mb-2 h-5 w-5" />
        <p className="text-sm">
          Failed to load skills. Make sure the backend is running.
        </p>
      </div>
    );
  }

  const stats = data?.stats;
  const skills = data?.skills ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Skills</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Modular capabilities that extend AI knowledge.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              reloadMutation.isPending && "animate-spin"
            )}
          />
          Reload
        </Button>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total" value={stats.total} icon={Puzzle} />
          <StatCard label="Eligible" value={stats.eligible} icon={Check} />
          <StatCard label="Enabled" value={stats.enabled} icon={ToggleRight} />
          <StatCard
            label="~Tokens"
            value={stats.estimatedTokens.toLocaleString()}
            icon={Cpu}
          />
        </div>
      )}

      {/* Source breakdown */}
      {stats && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(stats.bySource)
            .filter(([, count]) => count > 0)
            .map(([source, count]) => (
              <span
                key={source}
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  SOURCE_COLORS[source]
                )}
              >
                {source} {count}
              </span>
            ))}
          {stats.mcpServers > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 text-cyan-400 px-2.5 py-0.5 text-[11px] font-medium">
              <Plug className="h-3 w-3" />
              MCP {stats.mcpServers}
            </span>
          )}
        </div>
      )}

      {/* Skills List */}
      <div className="rounded-xl bg-card/50 backdrop-blur-sm shadow-sm ring-1 ring-white/[0.05] overflow-hidden divide-y divide-white/[0.04]">
        {skills.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
              <Puzzle className="h-6 w-6 opacity-40" />
            </div>
            <p className="text-sm font-medium">No skills loaded</p>
            <p className="mt-1 text-xs opacity-70">
              Add SKILL.md files to the <code className="rounded bg-muted/50 px-1.5 py-0.5">skills/</code> directory
            </p>
          </div>
        ) : (
          skills.map((skill) => {
            const SkillIcon = getSkillIcon(skill.name);
            return (
              <div
                key={skill.name}
                className={cn(
                  "group flex items-center gap-3.5 px-4 py-3.5 transition-all duration-150 cursor-pointer",
                  "hover:bg-white/[0.03]",
                  !skill.eligible && "opacity-50"
                )}
                onClick={() => setSelectedSkill(skill.name)}
              >
                {/* Icon */}
                <div className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                  "bg-gradient-to-br from-white/[0.08] to-white/[0.02]",
                  "shadow-sm ring-1 ring-white/[0.06]",
                )}>
                  <SkillIcon className="h-4 w-4 text-muted-foreground" />
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[13px] tracking-tight">{skill.name}</span>
                    <span className={cn(
                      "rounded-full px-2 py-px text-[10px] font-medium",
                      SOURCE_COLORS[skill.source]
                    )}>
                      {skill.source}
                    </span>
                    {!skill.eligible && (
                      <span className="rounded-full bg-amber-500/10 text-amber-400 px-2 py-px text-[10px] font-medium">
                        ineligible
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground/70 mt-0.5">
                    {skill.description}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {skill.userInvocable && (
                    <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      /{skill.name}
                    </span>
                  )}
                  <button
                    className="p-1.5 rounded-lg transition-colors hover:bg-white/[0.06]"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate(skill.name);
                    }}
                    title={skill.enabled ? "Disable" : "Enable"}
                  >
                    {skill.enabled ? (
                      <ToggleRight className="h-4 w-4 text-green-400" />
                    ) : (
                      <ToggleLeft className="h-4 w-4 text-muted-foreground/50" />
                    )}
                  </button>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-all duration-150 group-hover:translate-x-0.5" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Skill Detail Dialog */}
      <Dialog
        open={!!selectedSkill}
        onOpenChange={(open) => !open && setSelectedSkill(null)}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-white/[0.08] to-white/[0.02] shadow-sm ring-1 ring-white/[0.06]">
                {(() => { const Icon = getSkillIcon(detail?.name || selectedSkill || ''); return <Icon className="h-4 w-4 text-muted-foreground" />; })()}
              </div>
              {detail?.name || selectedSkill}
            </DialogTitle>
            <DialogDescription>{detail?.description}</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <div className="space-y-5">
              {/* Status */}
              <div className="flex flex-wrap gap-1.5">
                <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", SOURCE_COLORS[detail.source])}>
                  {detail.source}
                </span>
                <span className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  detail.eligible
                    ? "bg-green-500/10 text-green-400"
                    : "bg-red-500/10 text-red-400"
                )}>
                  {detail.eligible ? "Eligible" : "Ineligible"}
                </span>
                <span className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  detail.enabled
                    ? "bg-blue-500/10 text-blue-400"
                    : "bg-white/[0.06] text-muted-foreground"
                )}>
                  {detail.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              {/* Errors */}
              {detail.eligibilityErrors.length > 0 && (
                <div className="rounded-xl bg-amber-500/[0.06] p-4 ring-1 ring-amber-500/10">
                  <p className="text-xs font-semibold text-amber-400 mb-2">
                    Missing Requirements
                  </p>
                  <ul className="space-y-1.5 text-xs text-amber-300/80">
                    {detail.eligibilityErrors.map((err, idx) => (
                      <li key={idx} className="flex items-center gap-1.5">
                        <X className="h-3 w-3 shrink-0" />
                        {err}
                      </li>
                    ))}
                  </ul>
                  {detail.metadata?.install &&
                    detail.metadata.install.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-7 text-xs"
                        onClick={() => installMutation.mutate(detail.name)}
                        disabled={installMutation.isPending}
                      >
                        <Download className="mr-1.5 h-3 w-3" />
                        {installMutation.isPending
                          ? "Installing..."
                          : "Install Dependencies"}
                      </Button>
                    )}
                </div>
              )}

              {/* Invocation */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Invocation
                </p>
                <div className="flex gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    {detail.invocation.userInvocable ? (
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/15">
                        <Check className="h-2.5 w-2.5 text-green-400" />
                      </div>
                    ) : (
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-white/[0.06]">
                        <X className="h-2.5 w-2.5 text-muted-foreground/50" />
                      </div>
                    )}
                    User (/{detail.command?.name || detail.name})
                  </span>
                  <span className="flex items-center gap-1.5">
                    {detail.invocation.modelInvocable ? (
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/15">
                        <Check className="h-2.5 w-2.5 text-green-400" />
                      </div>
                    ) : (
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-white/[0.06]">
                        <X className="h-2.5 w-2.5 text-muted-foreground/50" />
                      </div>
                    )}
                    AI Auto-invoke
                  </span>
                </div>
              </div>

              {/* Tools */}
              {detail.metadata?.toolCategories &&
                detail.metadata.toolCategories.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      Tools
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.metadata.toolCategories.map((tool) => (
                        <span
                          key={tool}
                          className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              {/* Path */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Location
                </p>
                <code className="block rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] break-all text-muted-foreground ring-1 ring-white/[0.04]">
                  {detail.dirPath}
                </code>
              </div>

              {/* Links */}
              {detail.metadata?.homepage && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Documentation
                  </p>
                  <a
                    href={detail.metadata.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {detail.metadata.homepage}
                  </a>
                </div>
              )}

              {/* Instructions preview */}
              {detail.instructions && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Instructions Preview
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-lg bg-white/[0.02] p-3 ring-1 ring-white/[0.04]">
                    <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/70 leading-relaxed">
                      {detail.instructions.slice(0, 2000)}
                      {detail.instructions.length > 2000 && "\n\n... (truncated)"}
                    </pre>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-3 border-t border-white/[0.04]">
                <Button
                  size="sm"
                  variant={detail.enabled ? "destructive" : "default"}
                  className="h-8 text-xs"
                  onClick={() => {
                    toggleMutation.mutate(detail.name);
                    setSelectedSkill(null);
                  }}
                >
                  {detail.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Info Footer */}
      <div className="flex items-start gap-2.5 rounded-xl bg-white/[0.02] p-4 text-xs text-muted-foreground/60">
        <Info className="h-4 w-4 shrink-0 mt-0.5 opacity-50" />
        <p className="leading-relaxed">
          Skills are loaded from <code className="rounded bg-white/[0.06] px-1 py-px">skills/</code> (bundled),{" "}
          <code className="rounded bg-white/[0.06] px-1 py-px">~/.glinr/skills/</code> (managed), and project{" "}
          <code className="rounded bg-white/[0.06] px-1 py-px">skills/</code> (workspace). Each skill is a folder with a{" "}
          <code className="rounded bg-white/[0.06] px-1 py-px">SKILL.md</code> file.
        </p>
      </div>
    </div>
  );
}

// --- Helper Components ---

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl bg-card/50 backdrop-blur-sm p-4 shadow-sm ring-1 ring-white/[0.05]">
      <div className="flex items-center gap-2 text-muted-foreground/60">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
