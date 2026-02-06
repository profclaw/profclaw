/**
 * Inline Ticket Editor
 *
 * A professional Notion/Plane-style ticket detail panel.
 * Clean two-column layout with properties sidebar.
 *
 * Features:
 * - Clean white/dark background (no grey)
 * - Proper scrolling
 * - Two-column layout (content + properties)
 * - Working action buttons for child issues
 * - Professional visual hierarchy
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  Circle,
  CheckCircle2,
  Play,
  Eye,
  Archive,
  X as XIcon,
  AlertCircle,
  Bug,
  Sparkles,
  Layers,
  BookOpen,
  Bot,
  User,
  Users,
  Calendar,
  Loader2,
  Plus,
  MoreHorizontal,
  Check,
  Share2,
  Maximize2,
  ChevronRight,
  MessageSquare,
  History,
  Target,
  Zap,
} from 'lucide-react';
import { api } from '@/core/api/client';
import type {
  Ticket,
  TicketStatus,
  TicketType,
  TicketPriority,
  TicketWithRelations,
} from '@/core/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RichTextEditor, RichTextDisplay } from '@/components/ui/rich-text-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ActivityFeed } from './ActivityFeed';

// === Constants ===

const STATUS_OPTIONS: Array<{
  value: TicketStatus;
  label: string;
  icon: typeof Circle;
  color: string;
  bgColor: string;
}> = [
  { value: 'backlog', label: 'Backlog', icon: Archive, color: 'text-slate-400', bgColor: 'bg-slate-400/10' },
  { value: 'todo', label: 'Todo', icon: Circle, color: 'text-slate-500', bgColor: 'bg-slate-500/10' },
  { value: 'in_progress', label: 'In Progress', icon: Play, color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  { value: 'in_review', label: 'In Review', icon: Eye, color: 'text-indigo-500', bgColor: 'bg-indigo-500/10' },
  { value: 'done', label: 'Done', icon: CheckCircle2, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  { value: 'cancelled', label: 'Cancelled', icon: XIcon, color: 'text-slate-400', bgColor: 'bg-slate-400/10' },
];

const TYPE_OPTIONS: Array<{ value: TicketType; label: string; icon: typeof Bug; color: string }> = [
  { value: 'task', label: 'Task', icon: CheckCircle2, color: 'text-blue-500' },
  { value: 'bug', label: 'Bug', icon: Bug, color: 'text-red-500' },
  { value: 'feature', label: 'Feature', icon: Sparkles, color: 'text-cyan-500' },
  { value: 'epic', label: 'Epic', icon: Layers, color: 'text-amber-500' },
  { value: 'story', label: 'Story', icon: BookOpen, color: 'text-cyan-500' },
  { value: 'subtask', label: 'Subtask', icon: Circle, color: 'text-slate-400' },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority; label: string; color: string; dot: string }> = [
  { value: 'urgent', label: 'Urgent', color: 'text-red-500', dot: 'bg-red-500' },
  { value: 'high', label: 'High', color: 'text-orange-500', dot: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-500', dot: 'bg-yellow-500' },
  { value: 'low', label: 'Low', color: 'text-blue-500', dot: 'bg-blue-500' },
  { value: 'none', label: 'None', color: 'text-slate-400', dot: 'bg-slate-400' },
];

// === Detail Item Component ===

interface DetailItemProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

function DetailItem({ label, children, className }: DetailItemProps) {
  return (
    <div className={cn('flex items-center justify-between py-2.5', className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

// === Main Component ===

interface InlineTicketEditorProps {
  ticketId: string;
  onClose?: () => void;
  className?: string;
}

export function InlineTicketEditor({ ticketId, onClose, className }: InlineTicketEditorProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Edit states
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [activeTab, setActiveTab] = useState<'comments' | 'history'>('comments');

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Fetch ticket with relations
  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: () => api.tickets.get(ticketId, true),
    enabled: !!ticketId,
  });

  // Fetch projects for dropdown
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list({ limit: 50 }),
  });

  const projects = projectsData?.projects || [];

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Ticket>) => api.tickets.update(ticketId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to update: ${err.message}`);
    },
  });

  // Create child ticket mutation
  const createChildMutation = useMutation({
    mutationFn: (data: { title: string; type: TicketType }) =>
      api.tickets.create({
        title: data.title,
        type: data.type,
        parentId: ticketId,
        projectId: ticket?.projectId,
        priority: 'medium',
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Child issue created');
      navigate(`/tickets/${result.ticket.id}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to create: ${err.message}`);
    },
  });

  // Initialize edit values when ticket loads
  useEffect(() => {
    if (ticket) {
      setEditedTitle(ticket.title);
      setEditedDescription(ticket.description || '');
    }
  }, [ticket]);

  // Focus title input when editing
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Save handlers
  const saveTitle = useCallback(() => {
    if (editedTitle.trim() && editedTitle !== ticket?.title) {
      updateMutation.mutate({ title: editedTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editedTitle, ticket?.title, updateMutation]);

  const saveDescription = useCallback(() => {
    if (editedDescription !== ticket?.description) {
      updateMutation.mutate({ description: editedDescription });
    }
    setIsEditingDescription(false);
  }, [editedDescription, ticket?.description, updateMutation]);

  // Quick update helpers
  const updateField = useCallback((field: string, value: unknown) => {
    updateMutation.mutate({ [field]: value } as Partial<Ticket>);
  }, [updateMutation]);

  // Create child issue
  const handleAddChildIssue = (type: TicketType = 'subtask') => {
    const title = type === 'epic' ? 'New Epic' : 'New subtask';
    createChildMutation.mutate({ title, type });
  };

  // Copy link
  const handleCopyLink = () => {
    const url = `${window.location.origin}/tickets/${ticketId}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  };

  // Get display info helpers
  const getStatusInfo = (status: TicketStatus) => {
    return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
  };

  const getTypeInfo = (type: TicketType) => {
    return TYPE_OPTIONS.find(t => t.value === type) || TYPE_OPTIONS[0];
  };

  const getPriorityInfo = (priority: TicketPriority) => {
    return PRIORITY_OPTIONS.find(p => p.value === priority) || PRIORITY_OPTIONS[4];
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentProject = projects.find((p: any) => p.id === ticket?.projectId);

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center h-full bg-background', className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (error || !ticket) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full gap-4 bg-background', className)}>
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-lg text-muted-foreground">Failed to load ticket</p>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    );
  }

  const statusInfo = getStatusInfo(ticket.status as TicketStatus);
  const typeInfo = getTypeInfo(ticket.type as TicketType);
  const priorityInfo = getPriorityInfo(ticket.priority as TicketPriority);
  const ticketWithRelations = ticket as TicketWithRelations;

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* === Header === */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 bg-background sticky top-0 z-10">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">PROJECT</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">
            {currentProject?.key || 'GLINR'}-{ticket.sequence}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="gap-1.5 h-8" onClick={handleCopyLink}>
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Share</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate(`/tickets/${ticketId}`)}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <XIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* === Main Content Area === */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left Column - Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6 max-w-3xl">
            {/* Type Badge */}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn('gap-1.5 font-medium', typeInfo.color)}>
                <typeInfo.icon className="h-3.5 w-3.5" />
                {typeInfo.label.toUpperCase()}
              </Badge>
            </div>

            {/* Title - Click to edit */}
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  ref={titleInputRef}
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    if (e.key === 'Escape') {
                      setEditedTitle(ticket.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  className="text-2xl font-bold border-0 border-b-2 border-primary rounded-none px-0 focus-visible:ring-0 bg-transparent h-auto py-1"
                />
                <Button size="sm" variant="ghost" onClick={saveTitle}>
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <h1
                className="text-2xl font-bold cursor-text hover:bg-accent/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
                onClick={() => setIsEditingTitle(true)}
              >
                {ticket.title}
              </h1>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-2 pb-4 border-b border-border/50">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                    <Plus className="h-3.5 w-3.5" />
                    Add child issue
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleAddChildIssue('subtask')}>
                    <Circle className="h-4 w-4 mr-2 text-slate-400" />
                    Subtask
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAddChildIssue('task')}>
                    <CheckCircle2 className="h-4 w-4 mr-2 text-blue-500" />
                    Task
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAddChildIssue('bug')}>
                    <Bug className="h-4 w-4 mr-2 text-red-500" />
                    Bug
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                    <Layers className="h-3.5 w-3.5" />
                    Add epic
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleAddChildIssue('epic')}>
                    <Layers className="h-4 w-4 mr-2 text-amber-500" />
                    Create new epic
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>
                    <span className="text-xs text-muted-foreground">
                      Link to existing epic coming soon
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs text-muted-foreground">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Description
              </h3>
              {isEditingDescription ? (
                <div className="space-y-3">
                  <RichTextEditor
                    value={editedDescription}
                    onChange={setEditedDescription}
                    placeholder="Add a description..."
                    minHeight="150px"
                    autofocus
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={saveDescription}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditedDescription(ticket.description || '');
                        setIsEditingDescription(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="cursor-text hover:bg-accent/30 rounded-lg p-3 -m-3 transition-colors min-h-[80px]"
                  onClick={() => setIsEditingDescription(true)}
                >
                  {ticket.description ? (
                    <RichTextDisplay content={ticket.description} className="text-sm leading-relaxed" />
                  ) : (
                    <p className="text-muted-foreground text-sm italic">
                      Click to add a description...
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Activity Section */}
            <div className="pt-6">
              <div className="flex items-center gap-4 border-b border-border/50 mb-4">
                <button
                  onClick={() => setActiveTab('comments')}
                  className={cn(
                    'flex items-center gap-2 pb-3 text-sm font-medium border-b-2 -mb-[2px] transition-colors',
                    activeTab === 'comments'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                  Comments
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={cn(
                    'flex items-center gap-2 pb-3 text-sm font-medium border-b-2 -mb-[2px] transition-colors',
                    activeTab === 'history'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <History className="h-4 w-4" />
                  History
                </button>
              </div>

              {activeTab === 'comments' && (
                <ActivityFeed
                  ticketId={ticketId}
                  comments={ticketWithRelations.comments}
                />
              )}

              {activeTab === 'history' && (
                <div className="space-y-3">
                  {ticketWithRelations.history && ticketWithRelations.history.length > 0 ? (
                    ticketWithRelations.history.map((entry) => (
                      <div key={entry.id} className="flex items-start gap-3 text-sm">
                        <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                          <History className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div>
                          <span className="font-medium">{entry.changedBy.name}</span>
                          <span className="text-muted-foreground"> changed </span>
                          <span className="font-medium">{entry.field}</span>
                          {entry.oldValue && (
                            <>
                              <span className="text-muted-foreground"> from </span>
                              <span className="text-red-400">{entry.oldValue}</span>
                            </>
                          )}
                          {entry.newValue && (
                            <>
                              <span className="text-muted-foreground"> to </span>
                              <span className="text-green-400">{entry.newValue}</span>
                            </>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No history yet
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Properties */}
        <div className="w-72 border-l border-border/50 overflow-y-auto bg-accent/5">
          <div className="p-4 space-y-6">
            {/* Status */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Status
              </h4>
              <Select
                value={ticket.status}
                onValueChange={(v) => updateField('status', v)}
              >
                <SelectTrigger className={cn('w-full h-10 gap-2 font-medium', statusInfo.bgColor, statusInfo.color)}>
                  <div className="flex items-center gap-2">
                    <statusInfo.icon className="h-4 w-4" />
                    <span>{statusInfo.label.toUpperCase()}</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <opt.icon className={cn('h-4 w-4', opt.color)} />
                        <span>{opt.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Key Details Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Key Details
                </h4>
              </div>

              <div className="space-y-1 divide-y divide-border/30">
                {/* Assignee */}
                <DetailItem label="Assignee">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-2 hover:bg-accent rounded px-2 py-1 -mr-2 transition-colors">
                        {ticket.assignee ? (
                          <>
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                              {ticket.assignee.charAt(0).toUpperCase()}
                            </div>
                            <span>{ticket.assignee}</span>
                          </>
                        ) : (
                          <>
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Unassigned</span>
                          </>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="end">
                      <Input placeholder="Search assignees..." className="h-8 mb-2" />
                      <p className="text-xs text-muted-foreground py-2 text-center">
                        No users available
                      </p>
                    </PopoverContent>
                  </Popover>
                </DetailItem>

                {/* Priority */}
                <DetailItem label="Priority">
                  <Select
                    value={ticket.priority}
                    onValueChange={(v) => updateField('priority', v)}
                  >
                    <SelectTrigger className="w-auto h-8 border-0 bg-transparent hover:bg-accent gap-2 px-2 -mr-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-2 h-2 rounded-full', priorityInfo.dot)} />
                        <span className={cn('font-medium uppercase text-xs', priorityInfo.color)}>
                          {priorityInfo.label}
                        </span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <span className={cn('w-2 h-2 rounded-full', opt.dot)} />
                            <span>{opt.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DetailItem>

                {/* Labels */}
                <DetailItem label="Labels">
                  <div className="flex flex-wrap items-center gap-1">
                    {ticket.labels && ticket.labels.length > 0 ? (
                      ticket.labels.slice(0, 2).map((label: string) => (
                        <Badge key={label} variant="outline" className="text-xs">
                          {label}
                        </Badge>
                      ))
                    ) : (
                      <button className="text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <Plus className="h-3 w-3" />
                        <span className="text-xs">Add</span>
                      </button>
                    )}
                  </div>
                </DetailItem>

                {/* Reporter */}
                <DetailItem label="Reporter">
                  <div className="flex items-center gap-2">
                    {ticket.createdBy === 'ai' ? (
                      <Bot className="h-4 w-4 text-blue-500" />
                    ) : (
                      <User className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>{ticket.createdBy === 'ai' ? 'AI Agent' : 'Human Operator'}</span>
                  </div>
                </DetailItem>

                {/* Sprint/Cycle */}
                <DetailItem label="Sprint">
                  <button className="flex items-center gap-2 hover:bg-accent rounded px-2 py-1 -mr-2 transition-colors text-muted-foreground">
                    <Play className="h-4 w-4" />
                    <span className="uppercase text-xs">Backlog</span>
                  </button>
                </DetailItem>
              </div>
            </div>

            {/* Dates Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Dates
                </h4>
              </div>

              <div className="space-y-1 divide-y divide-border/30">
                <DetailItem label="Created">
                  <span className="text-sm">
                    {new Date(ticket.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </DetailItem>
                <DetailItem label="Updated">
                  <span className="text-sm">
                    {new Date(ticket.updatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </DetailItem>
              </div>
            </div>

            {/* Pro Tip */}
            <div className="rounded-lg bg-accent/50 p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wide">Pro Tip</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Press <kbd className="px-1.5 py-0.5 bg-background rounded text-[10px] font-mono border">M</kbd> to quickly focus on the comment input.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
