import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Tag, Check } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const PRESET_COLORS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
];

interface LabelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  label?: {
    id: string;
    name: string;
    description?: string;
    color: string;
  };
  onSuccess?: (label: any) => void;
}

export function LabelModal({
  open,
  onOpenChange,
  projectId,
  label,
  onSuccess,
}: LabelModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [customColor, setCustomColor] = useState('');
  const queryClient = useQueryClient();

  const isEditing = !!label;

  useEffect(() => {
    if (label) {
      setName(label.name);
      setDescription(label.description || '');
      setColor(label.color);
      if (!PRESET_COLORS.includes(label.color)) {
        setCustomColor(label.color);
      } else {
        setCustomColor('');
      }
    } else {
      setName('');
      setDescription('');
      setColor(PRESET_COLORS[0]);
      setCustomColor('');
    }
  }, [label, open]);

  const mutation = useMutation({
    mutationFn: (data: any) => {
      if (isEditing && label) {
        return api.labels.update(label.id, data);
      }
      return api.labels.create(projectId, data);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['labels', projectId] });
      toast.success(`Label ${isEditing ? 'updated' : 'created'} successfully`);
      onOpenChange(false);
      onSuccess?.(result.label);
    },
    onError: (err: Error) => {
      toast.error(`Failed to ${isEditing ? 'update' : 'create'} label: ${err.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Label name is required');
      return;
    }

    const finalColor = customColor && customColor.startsWith('#') ? customColor : color;

    mutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      color: finalColor,
    });
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomColor(value);
    if (value.startsWith('#') && (value.length === 4 || value.length === 7)) {
      setColor(value);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-heavy rounded-[20px] border-white/10 sm:max-w-[450px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              {isEditing ? 'Edit Label' : 'Create Label'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the label details and color.'
                : 'Create a new label to categorize your tickets.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="Label name..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-white/5 border-white/10 rounded-xl focus:ring-2 focus:ring-primary/20"
                autoFocus
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="What is this label for?"
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
                    onClick={() => {
                      setColor(c);
                      setCustomColor('');
                    }}
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
              
              <div className="flex items-center gap-2 mt-1">
                <div className="relative flex-1">
                  <Input
                    placeholder="#HEX color"
                    value={customColor}
                    onChange={handleCustomColorChange}
                    className="bg-white/5 border-white/10 rounded-xl pl-10"
                  />
                  <div 
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border border-white/20"
                    style={{ backgroundColor: customColor || color }}
                  />
                </div>
              </div>
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
              {isEditing ? 'Save Changes' : 'Create Label'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
