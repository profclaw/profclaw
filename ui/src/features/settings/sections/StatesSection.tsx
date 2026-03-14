import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  GitBranch, 
  Plus, 
  Pencil, 
  Trash2, 
  Loader2, 
  Search,
  AlertCircle,
  GripVertical
} from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '../components';
import { StateModal } from '../../projects/components/StateModal';
import { toast } from 'sonner';
import type { State, StateGroup } from '@/core/types';

const GROUP_LABELS: Record<StateGroup, string> = {
  backlog: 'Backlog',
  unstarted: 'Todo',
  started: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

export function StatesSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingState, setEditingState] = useState<State | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  // 1. Fetch default project
  const { data: project, isLoading: isLoadingProject } = useQuery({
    queryKey: ['projects', 'default'],
    queryFn: () => api.projects.getDefault(),
  });

  const projectId = project?.id;

  // 2. Fetch states for project
  const { data: statesData, isLoading: isLoadingStates } = useQuery({
    queryKey: ['states', projectId],
    queryFn: () => api.states.list(projectId!),
    enabled: !!projectId,
  });

  // 3. Delete state mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.states.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['states', projectId] });
      toast.success('State deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete state: ${err.message}`);
    },
  });

  const states = statesData?.states || [];
  const filteredStates = states.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    GROUP_LABELS[s.stateGroup as StateGroup].toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEdit = (state: State) => {
    setEditingState(state);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingState(null);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this state? Tickets in this state will need to be moved.')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoadingProject || (projectId && isLoadingStates)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground animate-pulse">Loading workflow states...</p>
      </div>
    );
  }

  if (!projectId) {
    return (
      <SettingsCard title="Workflows" description="Manage your project workflow states">
        <div className="flex flex-col items-center justify-center py-8 text-center bg-red-500/5 rounded-2xl border border-red-500/10">
          <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
          <p className="text-sm font-medium">Project not found</p>
          <p className="text-xs text-muted-foreground mt-1 px-4">
            Could not find the default project. Please make sure you have a project created.
          </p>
        </div>
      </SettingsCard>
    );
  }

  return (
    <>
      <SettingsCard 
        title="Workflows" 
        description="Define custom states and workflow categories for your tickets"
      >
        <div className="space-y-6">
          {/* Header Actions */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search states..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <Button onClick={handleCreate} className="gap-2 rounded-xl w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Create State
            </Button>
          </div>

          {/* States List */}
          <div className="grid gap-4">
            {filteredStates.length === 0 ? (
              <div className="text-center py-12 bg-muted/20 border border-dashed border-border rounded-2xl">
                <GitBranch className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? 'No states match your search' : 'No states created yet'}
                </p>
              </div>
            ) : (
              // Group states by stateGroup
              (['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as StateGroup[]).map(group => {
                const groupStates = filteredStates.filter(s => s.stateGroup === group);
                if (groupStates.length === 0) return null;

                return (
                  <div key={group} className="space-y-2">
                    <h4 className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">
                      {GROUP_LABELS[group]}
                    </h4>
                    <div className="grid gap-2">
                      {groupStates.map((state) => (
                        <div 
                          key={state.id}
                          className="group flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <GripVertical className="h-4 w-4 text-muted-foreground/20 group-hover:text-muted-foreground/50 cursor-grab active:cursor-grabbing" />
                            <div 
                              className="h-3 w-3 rounded-full shadow-sm"
                              style={{ backgroundColor: state.color }}
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-medium">{state.name}</h4>
                                {state.isDefault && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-primary/20 text-primary-foreground rounded-full font-bold uppercase tracking-tight leading-none">
                                    Default
                                  </span>
                                )}
                              </div>
                              {state.description && (
                                <p className="text-[11px] text-muted-foreground line-clamp-1">
                                  {state.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(state)}
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(state.id)}
                              disabled={deleteMutation.isPending || state.isDefault}
                              className="h-8 w-8 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                            >
                              {deleteMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </SettingsCard>

      <StateModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        projectId={projectId}
        state={editingState ?? undefined}
      />
    </>
  );
}
