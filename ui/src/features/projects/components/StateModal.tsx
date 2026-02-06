import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, GitBranch, Check, CircleDashed, Circle, CircleDot, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { StateGroup } from '@/core/types';

const PRESET_COLORS = [
  '#94a3b8', // Gray
  '#3b82f6', // Blue
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#10b981', // Emerald
  '#ef4444', // Red
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

const STATE_GROUPS: { id: StateGroup; label: string; icon: any }[] = [
  { id: 'backlog', label: 'Backlog', icon: CircleDashed },
  { id: 'unstarted', label: 'Todo', icon: Circle },
  { id: 'started', label: 'In Progress', icon: CircleDot },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
  { id: 'cancelled', label: 'Cancelled', icon: XCircle },
];

interface StateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  state?: any; // The state object being edited
  onSuccess?: (state: any) => void;
}

export function StateModal({
  open,
  onOpenChange,
  projectId,
  state: existingState,
  onSuccess,
}: StateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [stateGroup, setStateGroup] = useState<StateGroup>('unstarted');
  const [isDefault, setIsDefault] = useState(false);
  const queryClient = useQueryClient();

  const isEditing = !!existingState;

  useEffect(() => {
    if (existingState) {
      setName(existingState.name);
      setDescription(existingState.description || '');
      setColor(existingState.color);
      setStateGroup(existingState.stateGroup);
      setIsDefault(existingState.isDefault);
    } else {
      setName('');
      setDescription('');
      setColor(PRESET_COLORS[1]); // Default to blue
      setStateGroup('unstarted');
      setIsDefault(false);
    }
  }, [existingState, open]);

  const mutation = useMutation({
    mutationFn: (data: any) => {
      if (isEditing && existingState) {
        return api.states.update(existingState.id, data);
      }
      return api.states.create({ ...data, projectId });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['states', projectId] });
      toast.success(`State ${isEditing ? 'updated' : 'created'} successfully`);
      onOpenChange(false);
      onSuccess?.(result.state);
    },
    onError: (err: Error) => {
      toast.error(`Failed to ${isEditing ? 'update' : 'create'} state: ${err.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('State name is required');
      return;
    }

    mutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      stateGroup,
      isDefault,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-heavy rounded-[20px] border-white/10 sm:max-w-[450px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              {isEditing ? 'Edit State' : 'Create State'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the workflow state details.'
                : 'Create a new workflow state for your project.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6">
            <div className="grid gap-2">
              <Label htmlFor="state-name">Name *</Label>
              <Input
                id="state-name"
                placeholder="e.g. In Review, QA, Blocked..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-white/5 border-white/10 rounded-xl focus:ring-2 focus:ring-primary/20"
                autoFocus
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="state-group">State Category *</Label>
              <Select 
                value={stateGroup} 
                onValueChange={(val) => setStateGroup(val as StateGroup)}
              >
                <SelectTrigger className="bg-white/5 border-white/10 rounded-xl">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {STATE_GROUPS.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      <div className="flex items-center gap-2">
                        <group.icon className="h-4 w-4" />
                        <span>{group.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground ml-1">
                Used for high-level status tracking and board columns.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="state-description">Description (optional)</Label>
              <Input
                id="state-description"
                placeholder="What does this state represent?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-white/5 border-white/10 rounded-xl focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="grid gap-3">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'h-8 w-8 rounded-full transition-all hover:scale-110 flex items-center justify-center',
                      color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {color === c && <Check className="h-4 w-4 text-white drop-shadow-sm" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                id="is-default"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-white/10 bg-white/5 text-primary focus:ring-primary/20"
              />
              <Label htmlFor="is-default" className="text-sm font-normal cursor-pointer">
                Set as default state for new tickets
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !name.trim()}
              className="gap-2 rounded-xl"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isEditing ? 'Save Changes' : 'Create State'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
