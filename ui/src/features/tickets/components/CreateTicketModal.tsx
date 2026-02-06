import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Plus, Loader2, Bug, Sparkles, Layers, BookOpen, CheckCircle2, Circle, Wand2, Brain, Lightbulb, Check, X, FolderOpen, Link2, Hash } from 'lucide-react';
import { api, type TicketType, type TicketPriority, type CreateTicketInput, type TicketCategorization, type TicketSuggestion } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { EstimateSelect } from './EstimateSelect';

const TYPE_OPTIONS: Array<{ value: TicketType; label: string; icon: typeof Bug }> = [
  { value: 'task', label: 'Task', icon: CheckCircle2 },
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'feature', label: 'Feature', icon: Sparkles },
  { value: 'epic', label: 'Epic', icon: Layers },
  { value: 'story', label: 'Story', icon: BookOpen },
  { value: 'subtask', label: 'Subtask', icon: Circle },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority; label: string; color: string }> = [
  { value: 'urgent', label: 'Urgent', color: 'text-red-500' },
  { value: 'high', label: 'High', color: 'text-orange-500' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-500' },
  { value: 'low', label: 'Low', color: 'text-blue-500' },
  { value: 'none', label: 'None', color: 'text-gray-500' },
];

interface CreateTicketModalProps {
  defaultProjectId?: string;
  defaultParentId?: string;
}

export function CreateTicketModal({ defaultProjectId, defaultParentId }: CreateTicketModalProps = {}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TicketType>('task');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [labels, setLabels] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [parentId, setParentId] = useState<string | undefined>(defaultParentId);
  const [aiCategorization, setAiCategorization] = useState<TicketCategorization | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<TicketSuggestion | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const queryClient = useQueryClient();

  // Check if AI is available
  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.tickets.ai.status(),
    staleTime: 60000, // Check every minute
  });

  // Fetch projects
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list({ limit: 50 }),
  });

  // Fetch potential parent tickets (epics and stories in the selected project)
  const { data: parentTicketsData } = useQuery({
    queryKey: ['tickets', 'parents', projectId],
    queryFn: () =>
      api.tickets.list({
        projectId: projectId || undefined,
        type: ['epic', 'story'] as any,
        limit: 50,
      }),
    enabled: open, // Only fetch when modal is open
  });

  const projects = projectsData?.projects || [];
  const parentTickets = parentTicketsData?.tickets || [];
  const isAiAvailable = aiStatus?.available ?? false;

  // AI Categorization mutation
  const categorizeMutation = useMutation({
    mutationFn: () => api.tickets.ai.categorize(title, description || undefined),
    onSuccess: (result) => {
      if (result.categorization) {
        setAiCategorization(result.categorization);
        // Auto-apply categorization
        setType(result.categorization.type);
        setPriority(result.categorization.priority);
        if (result.categorization.labels.length > 0) {
          setLabels(result.categorization.labels.join(', '));
        }
        toast.success(`AI categorized with ${Math.round(result.categorization.confidence * 100)}% confidence`);
      } else {
        toast.error('AI could not categorize this ticket');
      }
    },
    onError: () => {
      toast.error('AI categorization failed');
    },
  });

  // AI Suggestion mutation
  const suggestMutation = useMutation({
    mutationFn: () => api.tickets.ai.suggest(title, description || undefined, type),
    onSuccess: (result) => {
      if (result.suggestions) {
        setAiSuggestion(result.suggestions);
        setShowSuggestions(true);
      } else {
        toast.error('AI could not generate suggestions');
      }
    },
    onError: () => {
      toast.error('AI suggestion failed');
    },
  });

  // Auto-categorize when title has enough content
  useEffect(() => {
    if (isAiAvailable && title.length >= 10 && !aiCategorization && !categorizeMutation.isPending) {
      const timer = setTimeout(() => {
        categorizeMutation.mutate();
      }, 1000); // Debounce for 1 second
      return () => clearTimeout(timer);
    }
  }, [title, isAiAvailable]);

  const applySuggestion = (field: keyof TicketSuggestion, value: unknown) => {
    if (field === 'title' && typeof value === 'string') {
      setTitle(value);
    } else if (field === 'description' && typeof value === 'string') {
      setDescription(value);
    } else if (field === 'suggestedLabels' && Array.isArray(value)) {
      setLabels(value.join(', '));
    }
    toast.success(`Applied AI suggestion for ${field}`);
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateTicketInput) => api.tickets.create(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success(`Ticket GLINR-${result.ticket.sequence} created`);
      handleClose();
    },
    onError: (err: Error) => {
      toast.error(`Failed to create ticket: ${err.message}`);
    },
  });

  const handleClose = () => {
    setOpen(false);
    setTitle('');
    setDescription('');
    setType('task');
    setPriority('medium');
    setLabels('');
    setEstimate(null);
    setProjectId(defaultProjectId);
    setParentId(defaultParentId);
    setAiCategorization(null);
    setAiSuggestion(null);
    setShowSuggestions(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    const labelArray = labels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);

    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      priority,
      labels: labelArray.length > 0 ? labelArray : undefined,
      estimate: estimate ?? undefined,
      estimateUnit: estimate !== null ? 'points' : undefined,
      projectId: projectId || undefined,
      parentId: parentId || undefined,
      createdBy: 'human',
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 rounded-xl">
          <Plus className="h-4 w-4" />
          Create Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="glass-heavy rounded-[20px] border-white/10 sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Create Ticket
              {isAiAvailable && (
                <Badge variant="outline" className="text-xs font-normal gap-1 border-primary/30 text-primary">
                  <Brain className="h-3 w-3" />
                  AI Assist
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Create a new ticket for your project. {isAiAvailable ? 'AI will help categorize and suggest improvements.' : 'AI agents can pick this up and work on it.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="Brief description of the ticket..."
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setAiCategorization(null); // Reset categorization when title changes
                }}
                className="bg-white/5 border-white/10 rounded-xl"
                autoFocus
              />
              {/* AI Categorization Status */}
              {isAiAvailable && title.length >= 10 && (
                <div className="flex items-center gap-2 text-xs">
                  {categorizeMutation.isPending ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      AI analyzing...
                    </span>
                  ) : aiCategorization ? (
                    <span className="flex items-center gap-1 text-green-400">
                      <Wand2 className="h-3 w-3" />
                      AI categorized ({Math.round(aiCategorization.confidence * 100)}% confidence)
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Detailed description, acceptance criteria, etc..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-white/5 border-white/10 rounded-xl min-h-[100px] resize-none"
              />
            </div>

            {/* Project and Parent Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  Project
                </Label>
                <Select value={projectId || '__none__'} onValueChange={(v) => {
                  setProjectId(v === '__none__' ? undefined : v);
                  setParentId(undefined); // Reset parent when project changes
                }}>
                  <SelectTrigger className="bg-white/5 border-white/10 rounded-xl">
                    <SelectValue placeholder="Select project..." />
                  </SelectTrigger>
                  <SelectContent className="glass-heavy rounded-xl border-white/10">
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">No project</span>
                    </SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <span className="flex items-center gap-2">
                          <span>{project.icon}</span>
                          <span className="truncate">{project.name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {project.key}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Parent (Epic/Story)
                </Label>
                <Select
                  value={parentId || '__none__'}
                  onValueChange={(v) => setParentId(v === '__none__' ? undefined : v)}
                  disabled={parentTickets.length === 0}
                >
                  <SelectTrigger className={cn(
                    "bg-white/5 border-white/10 rounded-xl",
                    parentTickets.length === 0 && "opacity-50"
                  )}>
                    <SelectValue placeholder={parentTickets.length === 0 ? "No epics/stories" : "Select parent..."} />
                  </SelectTrigger>
                  <SelectContent className="glass-heavy rounded-xl border-white/10 max-h-[200px]">
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">No parent</span>
                    </SelectItem>
                    {parentTickets.map((ticket) => (
                      <SelectItem key={ticket.id} value={ticket.id}>
                        <span className="flex items-center gap-2">
                          {ticket.type === 'epic' ? (
                            <Layers className="h-3.5 w-3.5 text-amber-400" />
                          ) : (
                            <BookOpen className="h-3.5 w-3.5 text-cyan-400" />
                          )}
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {ticket.projectKey || 'GLINR'}-{ticket.sequence}
                          </span>
                          <span className="truncate max-w-[140px]">{ticket.title}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Type and Priority Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as TicketType)}>
                  <SelectTrigger className="bg-white/5 border-white/10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-heavy rounded-xl border-white/10">
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="flex items-center gap-2">
                          <opt.icon className="h-4 w-4" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                  <SelectTrigger className="bg-white/5 border-white/10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-heavy rounded-xl border-white/10">
                    {PRIORITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className={`flex items-center gap-2 ${opt.color}`}>
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Labels and Estimate Row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 grid gap-2">
                <Label htmlFor="labels">Labels</Label>
                <Input
                  id="labels"
                  placeholder="Comma-separated labels (e.g., frontend, auth)"
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                  className="bg-white/5 border-white/10 rounded-xl"
                />
              </div>
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  Estimate
                </Label>
                <EstimateSelect
                  value={estimate}
                  onChange={setEstimate}
                  placeholder="Points"
                />
              </div>
            </div>

            {/* AI Actions */}
            {isAiAvailable && title.length >= 5 && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => categorizeMutation.mutate()}
                  disabled={categorizeMutation.isPending}
                  className="flex-1 gap-1 rounded-xl border-white/10 text-xs"
                >
                  {categorizeMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  Re-categorize
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => suggestMutation.mutate()}
                  disabled={suggestMutation.isPending}
                  className="flex-1 gap-1 rounded-xl border-white/10 text-xs"
                >
                  {suggestMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Lightbulb className="h-3 w-3" />
                  )}
                  Get AI Suggestions
                </Button>
              </div>
            )}

            {/* AI Suggestions Panel */}
            {showSuggestions && aiSuggestion && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-sm font-medium text-primary">
                    <Lightbulb className="h-4 w-4" />
                    AI Suggestions
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSuggestions(false)}
                    className="h-6 w-6 p-0 rounded-lg"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                {aiSuggestion.title && aiSuggestion.title !== title && (
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">Improved title:</p>
                      <p className="text-sm truncate">{aiSuggestion.title}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => applySuggestion('title', aiSuggestion.title)}
                      className="h-6 px-2 rounded-lg text-xs text-green-400 hover:text-green-300"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {aiSuggestion.description && (
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">Suggested description:</p>
                      <p className="text-sm line-clamp-2">{aiSuggestion.description}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => applySuggestion('description', aiSuggestion.description)}
                      className="h-6 px-2 rounded-lg text-xs text-green-400 hover:text-green-300"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {aiSuggestion.acceptanceCriteria && aiSuggestion.acceptanceCriteria.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Acceptance criteria:</p>
                    <ul className="text-xs space-y-0.5 text-muted-foreground">
                      {aiSuggestion.acceptanceCriteria.slice(0, 3).map((criteria, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-primary">-</span>
                          {criteria}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiSuggestion.suggestedLabels && aiSuggestion.suggestedLabels.length > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-1">Suggested labels:</p>
                      <div className="flex flex-wrap gap-1">
                        {aiSuggestion.suggestedLabels.map((label) => (
                          <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => applySuggestion('suggestedLabels', aiSuggestion.suggestedLabels)}
                      className="h-6 px-2 rounded-lg text-xs text-green-400 hover:text-green-300"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {aiSuggestion.estimatedEffort && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">Estimated effort:</p>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {aiSuggestion.estimatedEffort}
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || createMutation.isPending}
              className="gap-2 rounded-xl"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Ticket
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
