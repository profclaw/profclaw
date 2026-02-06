/**
 * Create Project Modal
 *
 * Modal for creating new projects with custom keys/prefixes.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Sparkles,
  ClipboardList,
  Rocket,
  Lightbulb,
  Target,
  Smartphone,
  Globe,
  Settings,
  Wrench,
  BarChart3,
  Palette,
  Code,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/core/api/client';

const PRESET_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

// Icon presets using Lucide icons
const PRESET_ICONS: { name: string; icon: LucideIcon }[] = [
  { name: 'clipboard-list', icon: ClipboardList },
  { name: 'rocket', icon: Rocket },
  { name: 'lightbulb', icon: Lightbulb },
  { name: 'target', icon: Target },
  { name: 'smartphone', icon: Smartphone },
  { name: 'globe', icon: Globe },
  { name: 'settings', icon: Settings },
  { name: 'wrench', icon: Wrench },
  { name: 'bar-chart-3', icon: BarChart3 },
  { name: 'palette', icon: Palette },
  { name: 'code', icon: Code },
  { name: 'shield', icon: Shield },
];

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateProjectModal({ open, onOpenChange, onSuccess }: CreateProjectModalProps) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [icon, setIcon] = useState(PRESET_ICONS[0].name);
  const [keyError, setKeyError] = useState('');

  // Get the currently selected icon component
  const SelectedIcon = PRESET_ICONS.find((i) => i.name === icon)?.icon || ClipboardList;

  const createProject = useMutation({
    mutationFn: () =>
      api.projects.create({
        key: key.toUpperCase(),
        name,
        description: description || undefined,
        color,
        icon,
      }),
    onSuccess: () => {
      toast.success(`Project ${key.toUpperCase()} created`);
      onOpenChange(false);
      resetForm();
      onSuccess?.();
    },
    onError: (error: any) => {
      if (error.message?.includes('already exists')) {
        setKeyError('This project key is already taken');
      } else {
        toast.error(error.message || 'Failed to create project');
      }
    },
  });

  const resetForm = () => {
    setKey('');
    setName('');
    setDescription('');
    setColor(PRESET_COLORS[0]);
    setIcon(PRESET_ICONS[0].name);
    setKeyError('');
  };

  const handleKeyChange = (value: string) => {
    // Only allow uppercase letters and numbers
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setKey(cleaned);
    setKeyError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (key.length < 2) {
      setKeyError('Key must be at least 2 characters');
      return;
    }
    if (key.length > 10) {
      setKeyError('Key must be at most 10 characters');
      return;
    }
    if (!/^[A-Z]/.test(key)) {
      setKeyError('Key must start with a letter');
      return;
    }
    if (!name.trim()) {
      return;
    }

    createProject.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Create New Project
          </DialogTitle>
          <DialogDescription>
            Create a project to organize your tickets. Each project gets a unique key prefix (e.g., GLINR-1, MOBILE-1).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Project Key */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Project Key <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={key}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder="PROJ"
                maxLength={10}
                className="w-32 field font-mono uppercase"
              />
              <span className="text-muted-foreground">-</span>
              <span className="text-muted-foreground font-mono">123</span>
            </div>
            {keyError && <p className="text-xs text-destructive">{keyError}</p>}
            <p className="text-xs text-muted-foreground">
              2-10 uppercase letters/numbers. This will be the prefix for all tickets in this project.
            </p>
          </div>

          {/* Project Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Project Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Project"
              className="w-full field"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="w-full field resize-none"
            />
          </div>

          {/* Icon & Color */}
          <div className="grid grid-cols-2 gap-4">
            {/* Icon */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Icon</label>
              <div className="flex flex-wrap gap-1">
                {PRESET_ICONS.map(({ name: iconName, icon: IconComponent }) => (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setIcon(iconName)}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                      icon === iconName
                        ? 'bg-primary/20 ring-2 ring-primary'
                        : 'bg-muted/50 hover:bg-muted'
                    }`}
                  >
                    <IconComponent className="h-5 w-5" />
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full transition-all ${
                      color === c ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="p-4 bg-muted/30 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-2">Preview</p>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${color}20` }}
              >
                <SelectedIcon className="h-5 w-5" style={{ color }} />
              </div>
              <div>
                <span
                  className="text-xs font-mono font-bold px-2 py-0.5 rounded"
                  style={{ backgroundColor: `${color}20`, color: color }}
                >
                  {key || 'PROJ'}
                </span>
                <p className="font-medium mt-0.5">{name || 'Project Name'}</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!key || !name.trim() || createProject.isPending}
              className="gap-2"
            >
              {createProject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
