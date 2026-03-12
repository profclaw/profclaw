import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Play,
  Circle,
  Inbox,
  Eye,
  X,
  Bug,
  Sparkles,
  Layers,
  BookOpen,
  Bot,
  MessageSquare,
  History,
  Link as LinkIcon,
  ExternalLink,
  Send,
  User,
  Calendar,
  Tag,
  GitBranch,
  GitCommit,
  Brain,
  Ticket as TicketIcon,
  Lightbulb,
  Pencil,
  FolderInput,
  Trash2,
  MoreVertical,
  Copy,
} from 'lucide-react';
import { api, type Ticket, type TicketStatus, type TicketType, type TicketComment, type TicketHistoryEntry, type TicketExternalLink, type TicketRelation } from '@/core/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import type { TicketPriority as TPriority, TicketType as TType } from '@/core/types';
import { LabelPicker } from '../components/LabelPicker';
import { EstimateSelect } from '../components/EstimateSelect';
import { RelationsWidget } from '../components/RelationsWidget';

const STATUS_OPTIONS: Array<{ value: TicketStatus; label: string; icon: typeof CheckCircle2 }> = [
  { value: 'backlog', label: 'Backlog', icon: Inbox },
  { value: 'todo', label: 'Todo', icon: Circle },
  { value: 'in_progress', label: 'In Progress', icon: Play },
  { value: 'in_review', label: 'In Review', icon: Eye },
  { value: 'done', label: 'Done', icon: CheckCircle2 },
  { value: 'cancelled', label: 'Cancelled', icon: X },
];

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const [activeTab, setActiveTab] = useState<'comments' | 'history' | 'links'>('comments');

  // Edit/Action state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    priority: 'medium' as TPriority,
    type: 'task' as TType,
    estimate: null as number | null,
  });

  const { data: ticket, isLoading, error } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.tickets.get(id!, true),
    enabled: !!id,
  });

  // Fetch projects for "Move to Project" feature
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list({ limit: 50 }),
  });

  // AI-powered similar tickets
  const { data: similarTickets, isLoading: isSimilarLoading } = useQuery({
    queryKey: ['ticket-similar', id],
    queryFn: () => api.tickets.ai.similar(id!, 5),
    enabled: !!id && !!ticket,
  });

  // AI-generated summary
  const { data: aiSummary, isLoading: isSummaryLoading } = useQuery({
    queryKey: ['ticket-summary', id],
    queryFn: () => api.tickets.ai.summary(id!),
    enabled: !!id && !!ticket,
    staleTime: 300000, // Cache for 5 minutes
  });

  // AI status
  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.tickets.ai.status(),
    staleTime: 60000,
  });

  const isAiAvailable = aiStatus?.available ?? false;

  const transitionMutation = useMutation({
    mutationFn: (status: TicketStatus) => api.tickets.transition(id!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Status updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update status: ${err.message}`);
    },
  });

  // Edit ticket mutation
  const editMutation = useMutation({
    mutationFn: (data: Partial<{ title: string; description: string; priority: TPriority; type: TType; projectId: string; estimate: number; estimateUnit: string }>) =>
      api.tickets.update(id!, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setIsEditOpen(false);
      toast.success('Ticket updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update ticket: ${err.message}`);
    },
  });

  // Delete ticket mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.tickets.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Ticket deleted');
      navigate('/tickets');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete ticket: ${err.message}`);
    },
  });

  // Move to project mutation
  const moveToProjectMutation = useMutation({
    mutationFn: (projectId: string) => api.tickets.update(id!, { projectId } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast.success('Ticket moved to project');
    },
    onError: (err: Error) => {
      toast.error(`Failed to move ticket: ${err.message}`);
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => api.tickets.addComment(id!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      setNewComment('');
      toast.success('Comment added');
    },
    onError: (err: Error) => {
      toast.error(`Failed to add comment: ${err.message}`);
    },
  });

  // AI Response mutation
  const aiRespondMutation = useMutation({
    mutationFn: (options: { commentId?: string; autoPost?: boolean }) =>
      api.tickets.ai.respond(id!, options),
    onSuccess: (result) => {
      if (result.posted && result.comment) {
        queryClient.invalidateQueries({ queryKey: ['ticket', id] });
        toast.success('AI response posted');
      } else if (result.response) {
        // Show the response for review
        setAiResponse(result.response);
        setAiConfidence(result.confidence);
        toast.success(`AI generated response (${Math.round(result.confidence * 100)}% confidence)`);
      } else if (result.skipped) {
        toast.info(result.reason || 'AI chose not to respond');
      }
    },
    onError: (err: Error) => {
      toast.error(`AI response failed: ${err.message}`);
    },
  });

  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number>(0);

  const handlePostAiResponse = async () => {
    if (!aiResponse) return;
    await addCommentMutation.mutateAsync(aiResponse);
    setAiResponse(null);
    setAiConfidence(0);
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    addCommentMutation.mutate(newComment);
  };

  const handleOpenEdit = () => {
    if (ticket) {
      setEditForm({
        title: ticket.title,
        description: ticket.description || '',
        priority: ticket.priority,
        type: ticket.type,
        estimate: ticket.estimate ?? null,
      });
      setIsEditOpen(true);
    }
  };

  const handleSaveEdit = () => {
    editMutation.mutate({
      ...editForm,
      estimate: editForm.estimate ?? undefined,
      estimateUnit: editForm.estimate !== null ? 'points' : undefined,
    });
  };

  const handleMoveToProject = (projectId: string) => {
    moveToProjectMutation.mutate(projectId);
  };

  const handleDuplicate = async () => {
    if (!ticket) return;
    try {
      const result = await api.tickets.create({
        title: `${ticket.title} (Copy)`,
        description: ticket.description,
        type: ticket.type,
        priority: ticket.priority,
        labels: ticket.labels,
        projectId: ticket.projectId,
      });
      toast.success('Ticket duplicated');
      navigate(`/tickets/${result.ticket.id}`);
    } catch (err) {
      toast.error('Failed to duplicate ticket');
    }
  };

  const getStatusBadge = (status: TicketStatus) => {
    const config: Record<TicketStatus, { variant: 'success' | 'destructive' | 'info' | 'secondary' | 'warning'; icon: typeof CheckCircle2 }> = {
      done: { variant: 'success', icon: CheckCircle2 },
      cancelled: { variant: 'destructive', icon: X },
      in_progress: { variant: 'info', icon: Play },
      in_review: { variant: 'warning', icon: Eye },
      todo: { variant: 'secondary', icon: Circle },
      backlog: { variant: 'secondary', icon: Inbox },
    };
    const statusConfig = config[status];
    const { variant, icon: Icon } = statusConfig;
    return (
      <Badge variant={variant} className="gap-1 text-sm px-3 py-1">
        <Icon className="h-4 w-4" />
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const getTypeBadge = (type: TicketType) => {
    const config: Record<TicketType, { icon: typeof Bug; color: string }> = {
      task: { icon: CheckCircle2, color: 'text-blue-500' },
      bug: { icon: Bug, color: 'text-red-500' },
      feature: { icon: Sparkles, color: 'text-cyan-500' },
      enhancement: { icon: Sparkles, color: 'text-indigo-500' },
      documentation: { icon: BookOpen, color: 'text-cyan-500' },
      epic: { icon: Layers, color: 'text-orange-500' },
      story: { icon: BookOpen, color: 'text-green-500' },
      subtask: { icon: Circle, color: 'text-gray-500' },
    };
    const typeConfig = config[type];
    const { icon: Icon, color } = typeConfig;
    return (
      <span className={`flex items-center gap-1.5 text-sm ${color}`}>
        <Icon className="h-4 w-4" />
        {type}
      </span>
    );
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      urgent: 'text-red-500',
      high: 'text-orange-500',
      medium: 'text-yellow-500',
      low: 'text-blue-500',
      none: 'text-gray-400',
    };
    return colors[priority] || 'text-gray-400';
  };

  if (isLoading) {
    return (
      <div className="glass rounded-[28px] p-12 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/tickets')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Tickets
        </Button>
        <div className="glass rounded-[28px] p-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-red-400 mb-4" />
          <p className="text-lg font-bold text-red-400">
            {error ? 'Error loading ticket' : 'Ticket not found'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {error ? (error as Error).message : `No ticket found with ID: ${id}`}
          </p>
        </div>
      </div>
    );
  }

  const ticketData = ticket as Ticket & {
    comments?: TicketComment[];
    history?: TicketHistoryEntry[];
    externalLinks?: TicketExternalLink[];
    relations?: TicketRelation[];
    children?: Ticket[];
    parent?: Ticket;
  };

  const projects = projectsData?.projects || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/tickets')} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Tickets
        </Button>

        <div className="flex items-center gap-2">
          {/* Edit Button */}
          <Button variant="outline" size="sm" onClick={handleOpenEdit} className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>

          {/* Move to Project Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <FolderInput className="h-4 w-4" />
                Move to Project
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {projects.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No projects available
                </div>
              ) : (
                projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => handleMoveToProject(project.id)}
                    disabled={project.id === ticketData.projectId}
                  >
                    <span className="mr-2">{project.icon}</span>
                    {project.name}
                    {project.id === ticketData.projectId && (
                      <span className="ml-auto text-xs text-muted-foreground">(current)</span>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* More Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDuplicate}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate Ticket
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const link = ticketData.externalLinks?.find(l => l.platform === 'jira');
                if (link?.externalUrl) {
                  window.open(link.externalUrl, '_blank');
                } else {
                  toast.info('No Jira link found. Link this ticket to Jira first.');
                }
              }}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in Jira
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-500 focus:text-red-500"
                onClick={() => setIsDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Ticket
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Ticket</DialogTitle>
            <DialogDescription>
              Make changes to the ticket details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Ticket title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Ticket description"
                rows={4}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={editForm.priority}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, priority: v as TPriority }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select
                  value={editForm.type}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, type: v as TType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="bug">Bug</SelectItem>
                    <SelectItem value="feature">Feature</SelectItem>
                    <SelectItem value="enhancement">Enhancement</SelectItem>
                    <SelectItem value="epic">Epic</SelectItem>
                    <SelectItem value="story">Story</SelectItem>
                    <SelectItem value="subtask">Subtask</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Estimate</label>
                <EstimateSelect
                  value={editForm.estimate}
                  onChange={(v) => setEditForm(prev => ({ ...prev, estimate: v }))}
                  placeholder="Points"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={editMutation.isPending}>
              {editMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{ticketData.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-red-500 hover:bg-red-600"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Ticket Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Ticket Header Card */}
          <div className="glass rounded-[20px] p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground bg-white/5 px-2 py-1 rounded-md">
                  {ticketData.projectKey || 'PROFCLAW'}-{ticketData.sequence}
                </span>
                {!ticketData.projectId && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                    No Project
                  </span>
                )}
                {getTypeBadge(ticketData.type)}
              </div>
              {getStatusBadge(ticketData.status)}
            </div>

            <h1 className="text-2xl font-bold mb-4">{ticketData.title}</h1>

            {ticketData.description && (
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-muted-foreground whitespace-pre-wrap">{ticketData.description}</p>
              </div>
            )}

            {/* Linked Artifacts */}
            {(ticketData.linkedPRs.length > 0 || ticketData.linkedCommits.length > 0 || ticketData.linkedBranch) && (
              <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/5">
                {ticketData.linkedBranch && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GitBranch className="h-3.5 w-3.5" />
                    {ticketData.linkedBranch}
                  </span>
                )}
                {ticketData.linkedPRs.length > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GitBranch className="h-3.5 w-3.5" />
                    {ticketData.linkedPRs.length} PR(s)
                  </span>
                )}
                {ticketData.linkedCommits.length > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GitCommit className="h-3.5 w-3.5" />
                    {ticketData.linkedCommits.length} commit(s)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Tabs for Comments/History/Links */}
          <div className="glass rounded-[20px] overflow-hidden">
            <div className="flex border-b border-white/5">
              <button
                onClick={() => setActiveTab('comments')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'comments' ? 'bg-white/5 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <MessageSquare className="h-4 w-4" />
                Comments ({ticketData.comments?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'history' ? 'bg-white/5 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <History className="h-4 w-4" />
                History ({ticketData.history?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('links')}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'links' ? 'bg-white/5 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <LinkIcon className="h-4 w-4" />
                Links ({ticketData.externalLinks?.length || 0})
              </button>
            </div>

            <div className="p-4">
              {activeTab === 'comments' && (
                <div className="space-y-4">
                  {/* Add Comment */}
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <Textarea
                        placeholder="Add a comment..."
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        className="min-h-20"
                      />
                      <div className="flex justify-end mt-2 gap-2">
                        {isAiAvailable && ticketData.comments && ticketData.comments.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => aiRespondMutation.mutate({})}
                            disabled={aiRespondMutation.isPending}
                            className="gap-2"
                          >
                            {aiRespondMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Brain className="h-4 w-4" />
                            )}
                            AI Respond
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="black"
                          onClick={handleAddComment}
                          disabled={!newComment.trim() || addCommentMutation.isPending}
                          className="gap-2"
                        >
                          {addCommentMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Comment
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* AI Response Preview */}
                  {aiResponse && (
                    <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium text-primary">
                          <Brain className="h-4 w-4" />
                          AI Generated Response
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {Math.round(aiConfidence * 100)}% confidence
                          </Badge>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAiResponse(null);
                            setAiConfidence(0);
                          }}
                          className="h-6 w-6 p-0 rounded-lg"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {aiResponse}
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setNewComment(aiResponse);
                            setAiResponse(null);
                            setAiConfidence(0);
                          }}
                          className="gap-1 rounded-xl border-white/10 text-xs"
                        >
                          Edit First
                        </Button>
                        <Button
                          size="sm"
                          onClick={handlePostAiResponse}
                          disabled={addCommentMutation.isPending}
                          className="gap-1 rounded-xl text-xs"
                        >
                          {addCommentMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Post Response
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Comments List */}
                  {ticketData.comments && ticketData.comments.length > 0 ? (
                    <div className="space-y-4 pt-4 border-t border-white/5">
                      {ticketData.comments.map((comment: TicketComment) => (
                        <div key={comment.id} className="flex gap-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${comment.author.type === 'ai' ? 'bg-blue-500/20' : 'bg-blue-500/20'}`}>
                            {comment.author.type === 'ai' ? (
                              <Bot className="h-4 w-4 text-blue-500" />
                            ) : (
                              <User className="h-4 w-4 text-blue-400" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{comment.author.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(comment.createdAt).toLocaleString()}
                              </span>
                              {comment.source !== 'profclaw' && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {comment.source}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{comment.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No comments yet</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-3">
                  {ticketData.history && ticketData.history.length > 0 ? (
                    ticketData.history.map((entry: TicketHistoryEntry) => (
                      <div key={entry.id} className="flex items-start gap-3 py-2">
                        <div className="h-6 w-6 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <History className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm">
                            <span className="font-medium">{entry.changedBy.name}</span>
                            <span className="text-muted-foreground"> changed </span>
                            <span className="font-medium">{entry.field}</span>
                            {entry.oldValue && (
                              <>
                                <span className="text-muted-foreground"> from </span>
                                <span className="text-red-400/80">{entry.oldValue}</span>
                              </>
                            )}
                            {entry.newValue && (
                              <>
                                <span className="text-muted-foreground"> to </span>
                                <span className="text-green-400/80">{entry.newValue}</span>
                              </>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(entry.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <History className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No history yet</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'links' && (
                <div className="space-y-3">
                  {ticketData.externalLinks && ticketData.externalLinks.length > 0 ? (
                    ticketData.externalLinks.map((link: TicketExternalLink) => (
                      <div key={link.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center">
                            <LinkIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium text-sm capitalize">{link.platform}</p>
                            <p className="text-xs text-muted-foreground">{link.externalId}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={link.syncEnabled ? 'success' : 'secondary'} className="text-[10px]">
                            {link.syncDirection}
                          </Badge>
                          {link.externalUrl && (
                            <a
                              href={link.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                            >
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <LinkIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No external links yet</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-4">
          {/* Status Control */}
          <div className="glass rounded-[20px] p-4">
            <h3 className="text-sm font-semibold mb-3">Status</h3>
            <Select
              value={ticketData.status}
              onValueChange={(v) => transitionMutation.mutate(v as TicketStatus)}
              disabled={transitionMutation.isPending}
            >
              <SelectTrigger className="w-full bg-white/5 border-white/10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-heavy rounded-xl border-white/10">
                {STATUS_OPTIONS.map((opt) => (
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

          {/* Details */}
          <div className="glass rounded-[20px] p-4 space-y-4">
            <h3 className="text-sm font-semibold">Details</h3>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Project</span>
                {ticketData.projectId ? (
                  <Link
                    to={`/projects/${ticketData.projectId}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {ticketData.projectName || ticketData.projectKey || 'View Project'}
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground italic">No project</span>
                )}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Priority</span>
                <span className={`text-sm font-medium capitalize ${getPriorityColor(ticketData.priority)}`}>
                  {ticketData.priority}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Type</span>
                {getTypeBadge(ticketData.type)}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Created By</span>
                <span className="flex items-center gap-1.5 text-sm">
                  {ticketData.createdBy === 'ai' ? (
                    <>
                      <Bot className="h-3.5 w-3.5 text-indigo-400" />
                      AI
                    </>
                  ) : (
                    <>
                      <User className="h-3.5 w-3.5 text-blue-400" />
                      Human
                    </>
                  )}
                </span>
              </div>

              {ticketData.assigneeAgent && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Assigned Agent</span>
                  <span className="flex items-center gap-1.5 text-sm text-primary">
                    <Bot className="h-3.5 w-3.5" />
                    {ticketData.assigneeAgent}
                  </span>
                </div>
              )}

              {ticketData.aiAgent && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">AI Agent</span>
                  <span className="text-sm">{ticketData.aiAgent}</span>
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Estimate</span>
                <EstimateSelect
                  value={ticketData.estimate ?? null}
                  onChange={(value) => {
                    editMutation.mutate({
                      estimate: value ?? undefined,
                      estimateUnit: value !== null ? 'points' : undefined,
                    });
                  }}
                  compact
                  placeholder="—"
                  className="w-[90px] h-8 text-xs"
                />
              </div>

              {ticketData.dueDate && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Due Date</span>
                  <span className="flex items-center gap-1.5 text-sm">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(ticketData.dueDate).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Labels */}
          <div className="glass rounded-[20px] p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Labels
            </h3>
            {ticketData.projectId ? (
              <LabelPicker
                ticketId={ticketData.id}
                projectId={ticketData.projectId}
              />
            ) : (
              <div className="text-center py-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Assign to a project to add labels
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                      <FolderInput className="h-3 w-3" />
                      Select Project
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-48">
                    {projects.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        No projects available
                      </div>
                    ) : (
                      projects.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          onClick={() => handleMoveToProject(project.id)}
                          className="text-sm"
                        >
                          <span className="mr-2">{project.icon}</span>
                          {project.name}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {/* Relations Widget */}
          <RelationsWidget
            ticketId={ticketData.id}
            relations={ticketData.relations || []}
          />

          {/* Parent Ticket (if this is a child/subtask) */}
          {ticketData.parent && (
            <div className="glass rounded-[20px] p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-amber-400" />
                Parent Ticket
              </h3>
              <Link
                to={`/tickets/${ticketData.parent.id}`}
                className="block p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">
                    {ticketData.parent.projectKey || 'PROFCLAW'}-{ticketData.parent.sequence}
                  </span>
                  {ticketData.parent.type === 'epic' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                      EPIC
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium group-hover:text-primary transition-colors">
                  {ticketData.parent.title}
                </p>
              </Link>
            </div>
          )}

          {/* Child Tickets (if this is an epic or has children) */}
          {ticketData.children && ticketData.children.length > 0 && (
            <div className="glass rounded-[20px] p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Child Tickets ({ticketData.children.length})
                <span className="ml-auto text-xs text-muted-foreground">
                  {ticketData.children.filter(c => c.status === 'done').length}/{ticketData.children.length} done
                </span>
              </h3>
              {/* Progress bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all"
                  style={{
                    width: `${(ticketData.children.filter(c => c.status === 'done').length / ticketData.children.length) * 100}%`
                  }}
                />
              </div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {ticketData.children.map((child: Ticket) => (
                  <Link
                    key={child.id}
                    to={`/tickets/${child.id}`}
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                  >
                    <div className={`flex-shrink-0 ${child.status === 'done' ? 'text-green-500' : child.status === 'in_progress' ? 'text-blue-500' : 'text-muted-foreground'}`}>
                      {child.status === 'done' ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : child.status === 'in_progress' ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-muted-foreground mb-0.5">
                        {child.projectKey || 'PROFCLAW'}-{child.sequence}
                      </p>
                      <p className={`text-sm truncate group-hover:text-primary transition-colors ${child.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                        {child.title}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {child.type}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="glass rounded-[20px] p-4 space-y-3">
            <h3 className="text-sm font-semibold">Timestamps</h3>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Created</span>
                <span className="text-xs">{new Date(ticketData.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Updated</span>
                <span className="text-xs">{new Date(ticketData.updatedAt).toLocaleString()}</span>
              </div>
              {ticketData.startedAt && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Started</span>
                  <span className="text-xs">{new Date(ticketData.startedAt).toLocaleString()}</span>
                </div>
              )}
              {ticketData.completedAt && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Completed</span>
                  <span className="text-xs">{new Date(ticketData.completedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* AI Summary */}
          {isAiAvailable && (
            <div className="glass rounded-[20px] p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" />
                AI Summary
              </h3>
              {isSummaryLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Generating summary...
                </div>
              ) : aiSummary?.summary ? (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {aiSummary.summary}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Summary not available
                </p>
              )}
            </div>
          )}

          {/* Similar Tickets */}
          <div className="glass rounded-[20px] p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              Similar Tickets
            </h3>
            {isSimilarLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Finding similar tickets...
              </div>
            ) : similarTickets?.similar && similarTickets.similar.length > 0 ? (
              <div className="space-y-2">
                {similarTickets.similar.map((similar: { id: string; sequence: number; title: string; status: TicketStatus; type: TicketType; similarity: number; projectKey?: string }) => (
                  <Link
                    key={similar.id}
                    to={`/tickets/${similar.id}`}
                    className="block p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <TicketIcon className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {similar.projectKey || 'PROFCLAW'}-{similar.sequence}
                          </span>
                        </div>
                        <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                          {similar.title}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 flex-shrink-0 tabular-nums"
                      >
                        {Math.round(similar.similarity * 100)}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Badge
                        variant={similar.status === 'done' ? 'success' : similar.status === 'in_progress' ? 'info' : 'secondary'}
                        className="text-[9px] px-1 py-0"
                      >
                        {similar.status.replace('_', ' ')}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {similar.type}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <TicketIcon className="h-6 w-6 mx-auto mb-1 opacity-40" />
                <p className="text-xs">No similar tickets found</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
