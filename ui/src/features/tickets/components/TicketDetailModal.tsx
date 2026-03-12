/**
 * Ticket Detail Modal
 *
 * A Jira-style modal overlay for viewing and editing ticket details
 * without navigating away from the board view.
 * Redesigned for wider, cleaner, and more professional appearance.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import {
  Loader2,
  X,
  CheckCircle2,
  Circle,
  Play,
  Archive,
  Eye,
  Bug,
  Sparkles,
  Layers,
  BookOpen,
  Bot,
  User,
  MessageSquare,
  Send,
  Pencil,
  Calendar,
  Maximize2,
  ChevronRight,
  MoreHorizontal,
  Share2,
  Lock,
  History,
  Activity,
  Plus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api, type Ticket, type TicketStatus, type TicketType, type TicketComment } from '@/core/api/client';
import { RichTextEditor, RichTextDisplay } from '@/components/ui/rich-text-editor';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LabelPicker } from './LabelPicker';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/shared/UserAvatar';

interface TicketDetailModalProps {
  ticketId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_OPTIONS: Array<{ value: TicketStatus; label: string; icon: typeof CheckCircle2; color: string; bgColor: string }> = [
  { value: 'backlog', label: 'Backlog', icon: Archive, color: 'text-gray-400', bgColor: 'bg-gray-400/10' },
  { value: 'todo', label: 'Todo', icon: Circle, color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  { value: 'in_progress', label: 'In Progress', icon: Play, color: 'text-amber-400', bgColor: 'bg-amber-400/10' },
  { value: 'in_review', label: 'In Review', icon: Eye, color: 'text-indigo-400', bgColor: 'bg-indigo-400/10' },
  { value: 'done', label: 'Done', icon: CheckCircle2, color: 'text-green-400', bgColor: 'bg-green-400/10' },
  { value: 'cancelled', label: 'Cancelled', icon: X, color: 'text-gray-500', bgColor: 'bg-gray-500/10' },
];

const typeConfig: Record<TicketType, { icon: typeof Bug; color: string; bgColor: string }> = {
  task: { icon: CheckCircle2, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  bug: { icon: Bug, color: 'text-red-500', bgColor: 'bg-red-500/10' },
  feature: { icon: Sparkles, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10' },
  enhancement: { icon: Sparkles, color: 'text-indigo-500', bgColor: 'bg-indigo-500/10' },
  documentation: { icon: BookOpen, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10' },
  epic: { icon: Layers, color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
  story: { icon: BookOpen, color: 'text-green-500', bgColor: 'bg-green-500/10' },
  subtask: { icon: Circle, color: 'text-gray-500', bgColor: 'bg-gray-500/10' },
};

const priorityConfig: Record<string, { color: string; bgColor: string; label: string }> = {
  urgent: { color: 'text-red-500', bgColor: 'bg-red-500', label: 'Urgent' },
  high: { color: 'text-orange-500', bgColor: 'bg-orange-500', label: 'High' },
  medium: { color: 'text-yellow-500', bgColor: 'bg-yellow-500', label: 'Medium' },
  low: { color: 'text-blue-500', bgColor: 'bg-blue-500', label: 'Low' },
  none: { color: 'text-gray-400', bgColor: 'bg-gray-400', label: 'None' },
};

export function TicketDetailModal({ ticketId, open, onOpenChange }: TicketDetailModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [newComment, setNewComment] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editingDescription, setEditingDescription] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');

  // Fetch ticket data
  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.tickets.get(ticketId!, true),
    enabled: !!ticketId && open,
  });

  // Fetch Sprints for the project
  const { data: sprintsData } = useQuery({
    queryKey: ['project-sprints', ticket?.projectId],
    queryFn: () => api.projects.sprints.list(ticket!.projectId!),
    enabled: !!ticket?.projectId,
  });

  // Fetch Agents
  const { data: agentsData } = useQuery({
    queryKey: ['gateway-agents'],
    queryFn: () => api.gateway.agents(),
    enabled: open,
  });

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setNewComment('');
      setIsEditingDescription(false);
      setEditingDescription('');
      setIsEditingTitle(false);
      setEditingTitle('');
    }
  }, [open]);

  // Transition mutation
  const transitionMutation = useMutation({
    mutationFn: (status: TicketStatus) => api.tickets.transition(ticketId!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Status updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update status: ${err.message}`);
    },
  });

  // Update ticket mutation (for title, priority, labels, etc.)
  const updateTicketMutation = useMutation({
    mutationFn: (data: Partial<Ticket>) => api.tickets.update(ticketId!, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setIsEditingTitle(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update ticket: ${err.message}`);
    },
  });

  // Update description mutation
  const updateDescriptionMutation = useMutation({
    mutationFn: (description: string) => api.tickets.update(ticketId!, { description } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setIsEditingDescription(false);
      toast.success('Description updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update description: ${err.message}`);
    },
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: (content: string) =>
      api.tickets.addComment(ticketId!, content, {
        type: 'human',
        name: user?.name || 'Anonymous',
        platform: 'profclaw',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setNewComment('');
      toast.success('Comment added');
    },
    onError: (err: Error) => {
      toast.error(`Failed to add comment: ${err.message}`);
    },
  });

  // Create child ticket mutation
  const createChildMutation = useMutation({
    mutationFn: (data: { title: string; type: TicketType }) =>
      api.tickets.create({
        title: data.title,
        type: data.type,
        parentId: ticketId!,
        projectId: ticket?.projectId,
        priority: 'medium',
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Child issue created');
      onOpenChange(false);
      navigate(`/tickets/${result.ticket.id}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to create: ${err.message}`);
    },
  });

  // Sprint assignment mutation
  const sprintMutation = useMutation({
    mutationFn: async ({ newSprintId, oldSprintId }: { newSprintId: string | null; oldSprintId: string | null }) => {
      const projectId = ticket?.projectId;
      if (!projectId) throw new Error('No project ID');

      // Remove from old sprint if exists
      if (oldSprintId) {
        await api.projects.sprints.removeTicket(projectId, oldSprintId, ticketId!);
      }

      // Add to new sprint if not backlog
      if (newSprintId) {
        await api.projects.sprints.addTickets(projectId, newSprintId, [ticketId!]);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['project-sprints'] });
      toast.success('Sprint updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update sprint: ${err.message}`);
    },
  });

  const handleSprintChange = (newSprintId: string) => {
    const currentSprintId = (ticketData as any)?.sprintId || null;
    const targetSprintId = newSprintId === 'backlog' ? null : newSprintId;

    if (currentSprintId !== targetSprintId) {
      sprintMutation.mutate({ newSprintId: targetSprintId, oldSprintId: currentSprintId });
    }
  };

  const handleAddChildIssue = (type: TicketType = 'subtask') => {
    const title = type === 'epic' ? 'New Epic' : `New ${type}`;
    createChildMutation.mutate({ title, type });
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    addCommentMutation.mutate(newComment);
  };

  const handleOpenFull = () => {
    onOpenChange(false);
    navigate(`/tickets/${ticketId}`);
  };

  if (!open) return null;

  const ticketData = ticket as Ticket & {
    comments?: TicketComment[];
    projectKey?: string;
    sequence?: string | number;
    projectIcon?: string;
    projectColor?: string;
    sprintId?: string;
  };

  const TypeIcon = ticketData ? typeConfig[ticketData.type]?.icon || Circle : Circle;
  const typeStyle = ticketData ? typeConfig[ticketData.type] : typeConfig.task;
  const statusConfig = ticketData ? STATUS_OPTIONS.find(s => s.value === ticketData.status) : STATUS_OPTIONS[0];
  const priorityStyle = ticketData ? priorityConfig[ticketData.priority] || priorityConfig.none : priorityConfig.none;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[1100px] w-[95vw] h-[90vh] md:h-[85vh] p-0 gap-0 overflow-hidden bg-background border-border rounded-2xl shadow-2xl [&>button]:hidden"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>
            {ticketData ? `${ticketData.projectKey || 'PROFCLAW'}-${ticketData.sequence}: ${ticketData.title}` : 'Loading ticket...'}
          </DialogTitle>
        </VisuallyHidden>

        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium animate-pulse text-muted-foreground">Opening ticket...</p>
            </div>
          </div>
        ) : error || !ticketData ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="h-16 w-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <X className="h-8 w-8 text-red-500" />
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">Failed to load ticket</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                {error ? (error as Error).message : 'The ticket might have been deleted or moved.'}
              </p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
              Go Back
            </Button>
          </div>
        ) : (
          <div className="flex flex-col h-full bg-card">
            {/* Redesigned Premium Header (Jira style) */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-4">
                <nav className="flex items-center gap-2 text-xs font-bold text-muted-foreground/60 uppercase tracking-widest">
                   <Link to={`/projects/${ticketData.projectId}`} className="hover:text-primary transition-colors">
                     {ticketData.projectKey || 'PROJECT'}
                   </Link>
                   <ChevronRight className="h-3 w-3 opacity-30" />
                   <span className="text-foreground/80 font-mono tracking-tight normal-case">{ticketData.projectKey || 'PROFCLAW'}-{ticketData.sequence}</span>
                </nav>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9 gap-2 rounded-xl" onClick={() => {
                  navigator.clipboard.writeText(window.location.origin + `/tickets/${ticketId}`);
                  toast.success("Link copied to clipboard");
                }}>
                  <Share2 className="h-4 w-4" />
                  <span className="text-xs font-medium">Share</span>
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={handleOpenFull}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-destructive/10 hover:text-destructive transition-colors" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Main Layout Grid */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_340px] overflow-hidden bg-card">

              {/* Left Side: Main Content - Scrollable */}
              <div className="flex-1 min-h-0 overflow-y-auto p-6 md:p-8 space-y-8 bg-card">
                
                {/* Title Section */}
                <div className="space-y-4 group">
                  <div className="flex items-center gap-3">
                     <div className={cn('flex items-center gap-2 px-3 py-1 rounded-full border border-current/20 shadow-sm', typeStyle.color, typeStyle.bgColor)}>
                        <TypeIcon className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em]">{ticketData.type}</span>
                     </div>
                  </div>
                  
                  {isEditingTitle ? (
                    <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-300">
                      <Input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        className="text-3xl font-bold h-14 bg-muted border-border rounded-2xl focus:ring-primary/20"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') updateTicketMutation.mutate({ title: editingTitle });
                          if (e.key === 'Escape') setIsEditingTitle(false);
                        }}
                      />
                      <div className="flex gap-1">
                        <Button 
                          size="icon" 
                          className="h-10 w-10 rounded-xl btn-primary-filled"
                          onClick={() => updateTicketMutation.mutate({ title: editingTitle })}
                        >
                          <CheckCircle2 className="h-5 w-5" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-10 w-10 rounded-xl"
                          onClick={() => setIsEditingTitle(false)}
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <h1
                      className="text-4xl font-bold tracking-tight text-foreground leading-tight cursor-text hover:bg-muted px-2 -mx-2 rounded-xl transition-colors py-1"
                      onClick={() => {
                        setEditingTitle(ticketData.title);
                        setIsEditingTitle(true);
                      }}
                    >
                      {ticketData.title}
                    </h1>
                  )}
                </div>

                {/* Main Action Bar (Jira Style) */}
                <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-border/50">
                   <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                       <Button variant="outline" size="sm" className="h-9 gap-2 rounded-xl">
                          <Plus className="h-4 w-4" />
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
                       <Button variant="outline" size="sm" className="h-9 gap-2 rounded-xl">
                          <Layers className="h-4 w-4" />
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
                         <span className="text-xs text-muted-foreground">Link existing epic (soon)</span>
                       </DropdownMenuItem>
                     </DropdownMenuContent>
                   </DropdownMenu>

                   <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
                      <MoreHorizontal className="h-4 w-4" />
                   </Button>
                </div>

                {/* Description Section */}
                <div className="space-y-3 group">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-foreground/70 uppercase tracking-wider">Description</h3>
                    {!isEditingDescription && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          setEditingDescription(ticketData.description || '');
                          setIsEditingDescription(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="text-xs">Edit</span>
                      </Button>
                    )}
                  </div>

                  {isEditingDescription ? (
                    <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                      <div className="rounded-2xl overflow-hidden border border-border bg-muted">
                        <RichTextEditor
                          value={editingDescription}
                          onChange={setEditingDescription}
                          placeholder="What is this issue about?"
                          minHeight="200px"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="rounded-xl px-6 font-bold"
                          onClick={() => updateDescriptionMutation.mutate(editingDescription)}
                          disabled={updateDescriptionMutation.isPending}
                        >
                          {updateDescriptionMutation.isPending && (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => {
                            setIsEditingDescription(false);
                            setEditingDescription('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer rounded-2xl p-4 -mx-4 hover:bg-muted transition-all min-h-[100px] border border-transparent hover:border-border"
                      onClick={() => {
                        setEditingDescription(ticketData.description || '');
                        setIsEditingDescription(true);
                      }}
                    >
                      {ticketData.description ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed">
                          <RichTextDisplay content={ticketData.description} />
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic flex items-center gap-2">
                          <Sparkles className="h-4 w-4 opacity-50 text-primary" />
                          Describe the problem or feature requirement...
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Activity Tabs Section */}
                <div className="pt-8 border-t border-border">
                   <Tabs defaultValue="comments" className="w-full">
                      <div className="flex items-center justify-between mb-6">
                         <h3 className="text-sm font-bold text-foreground/70 uppercase tracking-wider">Activity</h3>
                         <TabsList className="bg-muted border border-border p-1 rounded-xl h-9">
                            <TabsTrigger value="comments" className="rounded-lg px-4 gap-2 text-xs font-bold data-[state=active]:bg-primary">
                               <MessageSquare className="h-3.5 w-3.5" />
                               Comments
                            </TabsTrigger>
                            <TabsTrigger value="history" className="rounded-lg px-4 gap-2 text-xs font-bold">
                               <History className="h-3.5 w-3.5" />
                               History
                            </TabsTrigger>
                            <TabsTrigger value="activity" className="rounded-lg px-4 gap-2 text-xs font-bold">
                               <Activity className="h-3.5 w-3.5" />
                               All
                            </TabsTrigger>
                         </TabsList>
                      </div>

                      <TabsContent value="comments" className="space-y-8 mt-0 animate-in fade-in slide-in-from-top-2 duration-300">
                         {/* Add Comment Input */}
                         <div className="flex gap-4">
                            <UserAvatar
                              name={user?.name}
                              email={user?.email}
                              variant="primary"
                              size="md"
                            />
                            <div className="flex-1 space-y-3">
                               <div className="rounded-2xl overflow-hidden border border-border bg-muted">
                                 <RichTextEditor
                                   value={newComment}
                                   onChange={setNewComment}
                                   placeholder="Add a comment..."
                                   minHeight="80px"
                                 />
                               </div>
                               <div className="flex justify-end">
                                 <Button
                                   size="sm"
                                   onClick={handleAddComment}
                                   disabled={!newComment.trim() || addCommentMutation.isPending}
                                   className="rounded-xl px-6 gap-2 font-bold shadow-lg shadow-primary/20"
                                 >
                                   {addCommentMutation.isPending ? (
                                     <Loader2 className="h-4 w-4 animate-spin" />
                                   ) : (
                                     <Send className="h-3.5 w-3.5" />
                                   )}
                                   Comment
                                 </Button>
                               </div>
                            </div>
                         </div>

                         {/* Comments List */}
                         {ticketData.comments && ticketData.comments.length > 0 ? (
                           <div className="space-y-8 pb-10">
                             {ticketData.comments.map((comment: TicketComment, idx: number) => (
                               <div key={comment.id} className="group relative flex gap-4 animate-in fade-in slide-in-from-left-2 duration-300" style={{ animationDelay: `${idx * 50}ms` }}>
                                 {/* Connector line */}
                                 {idx < ticketData.comments!.length - 1 && (
                                    <div className="absolute left-5 top-12 -bottom-8 w-px bg-border" />
                                 )}

                                 <UserAvatar
                                   name={comment.author.name}
                                   isAI={comment.author.type === 'ai'}
                                   size="md"
                                   className="relative z-10"
                                 />
                                 <div className="flex-1 min-w-0">
                                   <div className="flex items-center justify-between mb-1.5">
                                     <div className="flex items-center gap-2">
                                       <span className="font-bold text-sm tracking-tight">{comment.author.name}</span>
                                       {comment.author.type === 'ai' && (
                                         <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-none text-[10px] font-bold h-4">AI AGENT</Badge>
                                       )}
                                       <span className="text-[10px] text-muted-foreground/40 font-bold uppercase tracking-widest mt-0.5">• {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                     </div>
                                     <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 rounded-lg">
                                        <Share2 className="h-3.5 w-3.5 text-muted-foreground/40" />
                                     </Button>
                                   </div>
                                   <div className="text-[13px] text-foreground bg-muted rounded-2xl p-4 border border-border">
                                     <RichTextDisplay content={comment.content} />
                                   </div>
                                 </div>
                               </div>
                             ))}
                           </div>
                         ) : (
                           <div className="flex flex-col items-center justify-center py-16 text-muted-foreground rounded-3xl border-2 border-dashed border-border bg-muted/50">
                             <MessageSquare className="h-12 w-12 mb-4 opacity-30" />
                             <p className="text-sm font-medium">No activity on this issue yet.</p>
                             <p className="text-xs text-muted-foreground/70">Start a conversation by adding a comment.</p>
                           </div>
                         )}
                      </TabsContent>
                    </Tabs>
                </div>
              </div>

              {/* Right Side: Sidebar Details (Jira Style) */}
              <div className="border-l border-border overflow-y-auto p-5 space-y-6 bg-muted/80">
                
                {/* Status Picker (Giant style) */}
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Status</label>
                  <Select
                    value={ticketData.status}
                    onValueChange={(v) => transitionMutation.mutate(v as TicketStatus)}
                    disabled={transitionMutation.isPending}
                  >
                    <SelectTrigger className={cn("w-full h-11 bg-muted border-border rounded-xl px-4 transition-all focus:ring-primary/20", statusConfig?.color)}>
                      <SelectValue>
                         {statusConfig && (
                            <div className="flex items-center gap-2.5">
                               <statusConfig.icon className="h-4 w-4" />
                               <span className="font-bold text-xs uppercase tracking-wider">{statusConfig.label}</span>
                            </div>
                         )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border rounded-2xl">
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="rounded-xl my-0.5 mx-1 focus:bg-primary/20">
                          <div className="flex items-center gap-2.5">
                            <opt.icon className={cn('h-4 w-4', opt.color)} />
                            <span className="text-xs font-bold uppercase tracking-wider">{opt.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Properties Grid */}
                <div className="space-y-6">
                   <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Key Details</h4>
                   </div>

                   <div className="space-y-1">
                      <DetailRow label="Assignee">
                         <Select
                            value={ticketData.assigneeAgent || 'unassigned'}
                            onValueChange={(v) => updateTicketMutation.mutate({ assigneeAgent: v === 'unassigned' ? null : v } as any)}
                         >
                            <SelectTrigger className="h-8 border-none bg-transparent hover:bg-muted p-1 -m-1 rounded-lg transition-colors w-fit focus:ring-0">
                               <div className="flex items-center gap-2.5">
                                  <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center">
                                     {ticketData.assigneeAgent ? <Bot className="h-3.5 w-3.5 text-primary" /> : <User className="h-3.5 w-3.5 text-muted-foreground" />}
                                  </div>
                                  <span className={cn("text-xs font-semibold", ticketData.assigneeAgent ? "text-primary" : "text-muted-foreground")}>
                                     {ticketData.assigneeAgent || 'Unassigned'}
                                  </span>
                               </div>
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border rounded-2xl">
                               <SelectItem value="unassigned" className="rounded-xl mx-1 focus:bg-primary/20">
                                  <div className="flex items-center gap-2.5">
                                     <User className="h-4 w-4 text-muted-foreground" />
                                     <span className="text-xs font-bold uppercase tracking-wider">Unassigned</span>
                                  </div>
                               </SelectItem>
                               {agentsData?.agents.map((agent) => (
                                  <SelectItem key={agent.type} value={agent.type} className="rounded-xl mx-1 focus:bg-primary/20">
                                     <div className="flex items-center gap-2.5">
                                        <Bot className="h-4 w-4 text-primary" />
                                        <span className="text-xs font-bold uppercase tracking-wider">{agent.name}</span>
                                     </div>
                                  </SelectItem>
                               ))}
                            </SelectContent>
                         </Select>
                      </DetailRow>

                      <DetailRow label="Priority">
                         <Select
                            value={ticketData.priority}
                            onValueChange={(v) => updateTicketMutation.mutate({ priority: v as any })}
                         >
                            <SelectTrigger className="h-8 border-none bg-transparent hover:bg-muted p-1 -m-1 rounded-lg transition-colors w-fit focus:ring-0">
                               <div className="flex items-center gap-2.5 p-1 -m-1 cursor-pointer rounded-lg transition-colors">
                                  <div className={cn('h-2 w-2 rounded-full shadow-[0_0_8px_current]', priorityStyle.color, priorityStyle.bgColor.replace('/10', ''))} />
                                  <span className={cn('text-xs font-bold uppercase tracking-wider', priorityStyle.color)}>
                                    {priorityStyle.label}
                                  </span>
                               </div>
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border rounded-2xl">
                               {Object.entries(priorityConfig).map(([key, config]) => (
                                  <SelectItem key={key} value={key} className="rounded-xl mx-1 focus:bg-primary/20">
                                     <div className="flex items-center gap-2.5">
                                        <div className={cn('h-2 w-2 rounded-full shadow-[0_0_8px_current]', config.color)} />
                                        <span className={cn('text-xs font-bold uppercase tracking-wider', config.color)}>{config.label}</span>
                                     </div>
                                  </SelectItem>
                               ))}
                            </SelectContent>
                         </Select>
                      </DetailRow>

                      <DetailRow label="Labels">
                          <LabelPicker
                             ticketId={ticketId!}
                             projectId={ticketData.projectId!}
                             className="p-0"
                          />
                      </DetailRow>

                      <DetailRow label="Reporter">
                         <div className="flex items-center gap-2.5">
                            <div className="h-6 w-6 rounded-lg bg-muted flex items-center justify-center">
                               {ticketData.createdBy === 'ai' ? <Bot className="h-3.5 w-3.5 text-blue-500" /> : <User className="h-3.5 w-3.5 text-blue-400" />}
                            </div>
                            <span className="text-xs font-semibold">{ticketData.createdBy === 'ai' ? 'AI Agent' : 'Human Operator'}</span>
                         </div>
                      </DetailRow>

                      <DetailRow label="Sprint">
                         <Select
                            value={ticketData.sprintId || 'backlog'}
                            onValueChange={handleSprintChange}
                            disabled={sprintMutation.isPending}
                         >
                            <SelectTrigger className="h-8 border-none bg-transparent hover:bg-muted p-1 -m-1 rounded-lg transition-colors w-fit focus:ring-0">
                               <div className="flex items-center gap-2 bg-indigo-500/10 rounded-lg px-2 py-1 border border-indigo-500/20 w-fit cursor-pointer">
                                  <Play className="h-3 w-3 text-indigo-400 fill-indigo-400/50" />
                                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest leading-none">
                                     {sprintsData?.sprints.find(s => s.id === ticketData.sprintId)?.name || 'Backlog'}
                                  </span>
                               </div>
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border rounded-2xl">
                               <SelectItem value="backlog" className="rounded-xl mx-1 focus:bg-indigo-500/20">
                                  <div className="flex items-center gap-2.5">
                                     <Archive className="h-4 w-4 text-muted-foreground" />
                                     <span className="text-xs font-bold uppercase tracking-wider">Backlog</span>
                                  </div>
                               </SelectItem>
                               {sprintsData?.sprints.map((sprint) => (
                                  <SelectItem key={sprint.id} value={sprint.id} className="rounded-xl mx-1 focus:bg-indigo-500/20">
                                     <div className="flex items-center gap-2.5">
                                        <Play className="h-4 w-4 text-indigo-400 fill-indigo-400/50" />
                                        <span className="text-xs font-bold uppercase tracking-wider">{sprint.name}</span>
                                     </div>
                                  </SelectItem>
                               ))}
                            </SelectContent>
                         </Select>
                      </DetailRow>
                   </div>
                </div>

                {/* Dates & Timestamps */}
                <div className="space-y-4 pt-4">
                   <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Dates</h4>
                   </div>

                   <div className="space-y-3">
                      <div className="flex justify-between items-center text-[11px]">
                         <span className="text-muted-foreground/60 font-medium tracking-tight">Created</span>
                         <span className="font-semibold text-foreground/80">{new Date(ticketData.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                         <span className="text-muted-foreground/60 font-medium tracking-tight">Updated</span>
                         <span className="font-semibold text-foreground/80">{new Date(ticketData.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                      {ticketData.dueDate && (
                         <div className="flex justify-between items-center text-[11px] p-2 bg-red-500/5 rounded-lg border border-red-500/10">
                            <span className="text-red-400/80 font-bold tracking-tight">Due Date</span>
                            <span className="font-bold text-red-400">{new Date(ticketData.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                         </div>
                      )}
                   </div>
                </div>

                {/* Help/Tips */}
                <div className="mt-auto pt-10">
                   <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 space-y-2">
                       <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 text-primary" />
                          <span className="text-xs font-bold text-primary tracking-tight">PRO TIP</span>
                       </div>
                       <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Press <kbd className="bg-white/5 px-1 rounded border border-white/10 uppercase">M</kbd> to quickly focus on the comment input.
                       </p>
                   </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] py-2 items-start">
      <span className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-tighter mt-1">{label}</span>
      <div className="min-h-[28px] flex items-center">
        {children}
      </div>
    </div>
  );
}
