/**
 * Chat Settings Section
 *
 * Combined section for managing chat sessions and semantic memory.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare,
  Brain,
  Trash2,
  RefreshCw,
  FileText,
  Hash,
  Database,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/core/api/client';
import { SettingsCard } from '../components';
import {
  useMemoryStats,
  useSyncMemory,
  useClearAllMemories,
  useWatcherStatus,
} from '@/features/memory/hooks/useMemory';

// Relative time formatter
function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ChatSettingsSection() {
  const queryClient = useQueryClient();
  const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null);

  // Chat Sessions queries
  const { data: conversationsData, isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations', 'recent'],
    queryFn: () => api.chat.conversations.recent(20),
  });

  // Delete conversation mutation
  const deleteConversation = useMutation({
    mutationFn: (id: string) => api.chat.conversations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation deleted');
      setDeleteConversationId(null);
    },
    onError: (error) => {
      toast.error('Failed to delete conversation', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Clear all conversations mutation
  const clearAllConversations = useMutation({
    mutationFn: async () => {
      const conversations = conversationsData?.conversations || [];
      await Promise.all(conversations.map((c) => api.chat.conversations.delete(c.id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('All conversations cleared');
    },
    onError: (error) => {
      toast.error('Failed to clear conversations', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Memory queries
  const { data: memoryStats, isLoading: statsLoading } = useMemoryStats();
  const { data: watcherStatus } = useWatcherStatus();

  // Memory mutations
  const syncMutation = useSyncMemory();
  const clearMemoryMutation = useClearAllMemories();

  const conversations = conversationsData?.conversations || [];

  return (
    <>
      {/* Chat Sessions */}
      <SettingsCard title="Chat Sessions" description="Manage your conversation history">
        <div className="space-y-4">
          {/* Stats row */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{conversations.length}</span>
              <span className="text-muted-foreground">conversations</span>
            </div>
            <Link
              to="/chat"
              className="ml-auto text-primary hover:underline flex items-center gap-1 text-xs"
            >
              Open Chat
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {/* Recent conversations list */}
          {conversationsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No conversations yet. Start chatting to see them here.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {conversations.slice(0, 10).map((conv) => (
                <div
                  key={conv.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{conv.title || 'Untitled'}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{getRelativeTime(conv.updatedAt)}</span>
                      <span>·</span>
                      <span>{conv.messageCount} messages</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteConversationId(conv.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-destructive hover:text-destructive"
                  disabled={conversations.length === 0}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All Sessions
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Conversations?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {conversations.length} conversation(s). This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearAllConversations.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {clearAllConversations.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Clear All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </SettingsCard>

      {/* Memory */}
      <SettingsCard title="Semantic Memory" description="AI-powered context and search">
        <div className="space-y-4">
          {/* Memory stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <FileText className="h-3 w-3" />
                Files
              </div>
              <p className="text-lg font-bold">
                {statsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  memoryStats?.totalFiles ?? 0
                )}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Hash className="h-3 w-3" />
                Chunks
              </div>
              <p className="text-lg font-bold">
                {statsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  memoryStats?.totalChunks ?? 0
                )}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Database className="h-3 w-3" />
                Tokens
              </div>
              <p className="text-lg font-bold">
                {statsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  ((memoryStats?.totalTokensEstimate ?? 0) / 1000).toFixed(1) + 'k'
                )}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Brain className="h-3 w-3" />
                Status
              </div>
              <p className={cn(
                "text-sm font-medium",
                watcherStatus?.enabled ? "text-green-500" : "text-muted-foreground"
              )}>
                {watcherStatus?.enabled ? 'Active' : 'Inactive'}
              </p>
            </div>
          </div>

          {/* Sync status messages */}
          {syncMutation.isSuccess && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              <span className="text-xs text-green-700 dark:text-green-400">
                Sync complete: {syncMutation.data?.added} added, {syncMutation.data?.updated} updated
              </span>
            </div>
          )}

          {syncMutation.isError && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-xs text-destructive">Sync failed: {syncMutation.error?.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => syncMutation.mutate(undefined)}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync Memory
            </Button>
            <Link to="/memory">
              <Button variant="outline" size="sm" className="rounded-xl">
                <FolderOpen className="h-4 w-4 mr-2" />
                Browse Files
              </Button>
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-destructive hover:text-destructive ml-auto"
                  disabled={(memoryStats?.totalFiles ?? 0) === 0}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Memory
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Memories?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all indexed memories, chunks, and cached embeddings.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearMemoryMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {clearMemoryMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Clear All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </SettingsCard>

      {/* Delete single conversation dialog */}
      <AlertDialog open={!!deleteConversationId} onOpenChange={() => setDeleteConversationId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This conversation and all its messages will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConversationId && deleteConversation.mutate(deleteConversationId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConversation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
