/**
 * Projects List View
 *
 * Displays all projects with create/manage functionality.
 * Supports multi-project workflows like Jira, Linear, GitHub Projects.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderKanban,
  Plus,
  Search,
  MoreHorizontal,
  Loader2,
  ChevronRight,
  Users,
  TicketCheck,
  Github,
  Pencil,
  Archive,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { api } from '@/core/api/client';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { ImportWizardEnhanced as ImportWizard } from '../components/ImportWizardEnhanced';
import { ProjectIcon } from '../components/ProjectIcon';

// Project stats component with lazy loading
function ProjectStats({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stats', 'project', projectId],
    queryFn: () => api.stats.projectStats(projectId),
    staleTime: 60000, // Cache for 1 minute
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <TicketCheck className="h-3.5 w-3.5" />
          <span className="animate-pulse">...</span>
        </div>
        <div className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          <span className="animate-pulse">...</span>
        </div>
      </div>
    );
  }

  const ticketCount = data?.tickets?.total ?? 0;
  const sprintCount = data?.sprints?.total ?? 0;
  const activeSprintCount = data?.sprints?.active ?? 0;

  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <TicketCheck className="h-3.5 w-3.5" />
        <span>{ticketCount} {ticketCount === 1 ? 'ticket' : 'tickets'}</span>
      </div>
      <div className="flex items-center gap-1">
        <Users className="h-3.5 w-3.5" />
        <span>
          {activeSprintCount > 0 ? (
            <>{activeSprintCount} active</>
          ) : (
            <>{sprintCount} {sprintCount === 1 ? 'sprint' : 'sprints'}</>
          )}
        </span>
      </div>
    </div>
  );
}

export function ProjectList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects', { search: searchQuery, includeArchived: showArchived }],
    queryFn: () => api.projects.list({ search: searchQuery || undefined, includeArchived: showArchived }),
  });

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.projects.archive(id),
    onSuccess: () => {
      toast.success('Project archived');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to archive: ${error.message}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.projects.delete(id),
    onSuccess: () => {
      toast.success('Project deleted');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });

  const projects = data?.projects || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-destructive">Failed to load projects</p>
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['projects'] })}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground">Manage your projects and ticket prefixes</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowImportWizard(true)} className="gap-2">
            <Github className="h-4 w-4" />
            Import
          </Button>
          <Button onClick={() => setShowCreateModal(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full field pl-10 pr-4"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded"
          />
          Show archived
        </label>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 bg-muted/30 rounded-xl border border-dashed border-border">
          <FolderKanban className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground mb-4">No projects yet</p>
          <Button onClick={() => setShowCreateModal(true)} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Create your first project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className={cn(
                'group relative bg-card rounded-xl border border-border p-5 cursor-pointer transition-all',
                'hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5',
                project.status === 'archived' && 'opacity-60'
              )}
            >
              {/* Project Icon & Key */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <ProjectIcon icon={project.icon} color={project.color} size="md" />
                  <div>
                    <span
                      className="text-xs font-mono font-bold px-2 py-0.5 rounded"
                      style={{ backgroundColor: `${project.color}20`, color: project.color }}
                    >
                      {project.key}
                    </span>
                    {project.status === 'archived' && (
                      <span className="ml-2 text-xs text-muted-foreground">(Archived)</span>
                    )}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-muted rounded-lg"
                    >
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/projects/${project.id}/settings`);
                      }}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit Project
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {project.status === 'archived' ? (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          // Unarchive would need a new API endpoint
                          toast.info('Unarchive coming soon');
                        }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restore Project
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          archiveMutation.mutate(project.id);
                        }}
                        className="text-amber-600"
                      >
                        <Archive className="h-4 w-4 mr-2" />
                        Archive Project
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(project.id);
                        }
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Project Name & Description */}
              <h3 className="font-semibold mb-1">{project.name}</h3>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                {project.description || 'No description'}
              </p>

              {/* Project Stats */}
              <ProjectStats projectId={project.id} />

              {/* Hover Arrow */}
              <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      <CreateProjectModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['projects'] });
        }}
      />

      {/* Import Wizard */}
      <ImportWizard
        open={showImportWizard}
        onOpenChange={setShowImportWizard}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['projects'] });
        }}
      />
    </div>
  );
}
