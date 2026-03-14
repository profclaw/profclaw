import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Tag, 
  Plus, 
  Pencil, 
  Trash2, 
  Loader2, 
  Search,
  AlertCircle
} from 'lucide-react';
import { api } from '@/core/api/client';
import type { Label } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { SettingsCard } from '../components';
import { LabelModal } from '../../labels/components/LabelModal';
import { toast } from 'sonner';

export function LabelsSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  // 1. Fetch default project
  const { data: project, isLoading: isLoadingProject } = useQuery({
    queryKey: ['projects', 'default'],
    queryFn: () => api.projects.getDefault(),
  });

  const projectId = project?.id;

  // 2. Fetch labels for project
  const { data: labelsData, isLoading: isLoadingLabels } = useQuery({
    queryKey: ['labels', projectId],
    queryFn: () => api.labels.list(projectId!),
    enabled: !!projectId,
  });

  // 3. Delete label mutation
  const deleteMutation = useMutation({
    mutationFn: (labelId: string) => api.labels.delete(labelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      toast.success('Label deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete label: ${err.message}`);
    },
  });

  const labels = labelsData?.labels || [];
  const filteredLabels = labels.filter(l => 
    l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEdit = (label: Label) => {
    setEditingLabel(label);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingLabel(null);
    setIsModalOpen(true);
  };

  const handleDelete = (labelId: string) => {
    if (window.confirm('Are you sure you want to delete this label?')) {
      deleteMutation.mutate(labelId);
    }
  };

  if (isLoadingProject || (projectId && isLoadingLabels)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground animate-pulse">Loading labels...</p>
      </div>
    );
  }

  if (!projectId) {
    return (
      <SettingsCard title="Labels" description="Manage your project labels">
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
        title="Labels" 
        description="Categorize and organize your tickets with custom labels"
      >
        <div className="space-y-6">
          {/* Header Actions */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search labels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <Button onClick={handleCreate} className="gap-2 rounded-xl w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Create Label
            </Button>
          </div>

          {/* Labels List */}
          <div className="grid gap-3">
            {filteredLabels.length === 0 ? (
              <div className="text-center py-12 bg-muted/20 border border-dashed border-border rounded-2xl">
                <Tag className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? 'No labels match your search' : 'No labels created yet'}
                </p>
              </div>
            ) : (
              filteredLabels.map((label) => (
                <div 
                  key={label.id}
                  className="group flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div 
                      className="h-4 w-4 rounded-full shadow-sm"
                      style={{ backgroundColor: label.color }}
                    />
                    <div>
                      <h4 className="text-sm font-semibold">{label.name}</h4>
                      {label.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {label.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(label)}
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(label.id)}
                      disabled={deleteMutation.isPending}
                      className="h-8 w-8 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </SettingsCard>

      <LabelModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        projectId={projectId}
        label={editingLabel ?? undefined}
      />
    </>
  );
}
