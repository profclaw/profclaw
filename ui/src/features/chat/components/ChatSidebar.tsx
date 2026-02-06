/**
 * Chat Sidebar Component
 *
 * Collapsible sidebar for chat history with:
 * - Time-based grouping (Today, Yesterday, Last 7 days, etc.)
 * - Relative time display
 * - Search functionality
 * - Delete conversations
 * - Project grouping
 * - localStorage persistence for open/close state
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  History,
  MessageSquarePlus,
  Search,
  X,
  Trash2,
  ChevronDown,
  Plus,
  FolderOpen,
  Folder,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { CollapsibleSidebar } from '@/components/shared/CollapsibleSidebar';
import { cn } from '@/lib/utils';
import type { Conversation } from '../types';

// Storage key for sidebar state
const SIDEBAR_STATE_KEY = 'chat-sidebar-open';

// Project type
interface Project {
  id: string;
  name: string;
  color?: string;
}

// Time grouping categories
type TimeGroup = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'older';

const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7days: 'Last 7 Days',
  last30days: 'Last 30 Days',
  older: 'Older',
};

/**
 * Get relative time string (e.g., "2h ago", "yesterday")
 */
function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Get time group for a date
 */
function getTimeGroup(date: Date): TimeGroup {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const last7days = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30days = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= last7days) return 'last7days';
  if (date >= last30days) return 'last30days';
  return 'older';
}

/**
 * Group conversations by time period
 */
function groupConversationsByTime(conversations: Conversation[]): Record<TimeGroup, Conversation[]> {
  const groups: Record<TimeGroup, Conversation[]> = {
    today: [],
    yesterday: [],
    last7days: [],
    last30days: [],
    older: [],
  };

  conversations.forEach((conv) => {
    const date = new Date(conv.updatedAt);
    const group = getTimeGroup(date);
    groups[group].push(conv);
  });

  return groups;
}

type GroupBy = 'time' | 'project';

interface ChatSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation?: (id: string) => void;
  projects?: Project[];
  width?: number;
  persistState?: boolean;
}

export function ChatSidebar({
  isOpen,
  onToggle,
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  projects = [],
  width = 300,
  persistState = true,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>('time');

  // Persist sidebar state to localStorage
  useEffect(() => {
    if (persistState) {
      localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(isOpen));
    }
  }, [isOpen, persistState]);

  // Filter and group conversations
  const { filteredConversations, groupedByTime, groupedByProject } = useMemo(() => {
    const filtered = searchQuery.trim()
      ? conversations.filter((conv) =>
          conv.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          conv.preview?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : conversations;

    // Group by project
    const byProject: Record<string, Conversation[]> = { _none: [] };
    projects.forEach((p) => {
      byProject[p.id] = [];
    });
    filtered.forEach((conv) => {
      const projectId = (conv as Conversation & { projectId?: string }).projectId;
      if (projectId && byProject[projectId]) {
        byProject[projectId].push(conv);
      } else {
        byProject._none.push(conv);
      }
    });

    return {
      filteredConversations: filtered,
      groupedByTime: groupConversationsByTime(filtered),
      groupedByProject: byProject,
    };
  }, [conversations, searchQuery, projects]);

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const timeGroups: TimeGroup[] = ['today', 'yesterday', 'last7days', 'last30days', 'older'];
  const projectGroups = ['_none', ...projects.map((p) => p.id)];

  return (
    <CollapsibleSidebar
      isOpen={isOpen}
      onToggle={onToggle}
      title="Chats"
      subtitle={`${conversations.length} conversation${conversations.length !== 1 ? 's' : ''}`}
      icon={<History className="h-4 w-4" />}
      width={width}
      headerActions={
        <div className="flex items-center">
          {projects.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setGroupBy(groupBy === 'time' ? 'project' : 'time')}
              className="h-6 w-6 rounded hover:bg-muted/60"
              aria-label={groupBy === 'time' ? 'Group by project' : 'Group by time'}
            >
              {groupBy === 'time' ? (
                <FolderOpen className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              ) : (
                <History className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewChat}
            className="h-6 w-6 rounded hover:bg-muted/60"
            aria-label="New chat"
          >
            <Plus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </Button>
        </div>
      }
      footer={
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs border-dashed border-border/50 hover:border-primary/30 hover:bg-primary/5"
          onClick={onNewChat}
          aria-label="Start new chat"
        >
          <Plus className="h-3 w-3 mr-1.5" aria-hidden="true" />
          New Chat
        </Button>
      }
    >
      {/* Search */}
      <div className="px-3 py-3 border-b border-white/[0.03]">
        <div className="relative group/search">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/30 group-focus-within/search:text-primary transition-colors" aria-hidden="true" />
          <Input
            placeholder="Search conversations..."
            aria-label="Search chat history"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-10 pr-10 text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground/40" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 px-2 pb-2">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-center px-6">
            <div className="w-16 h-16 rounded-[1.25rem] bg-gradient-to-br from-muted/20 to-muted/5 flex items-center justify-center mb-4 shadow-inner border border-white/5">
              <MessageSquarePlus className="h-8 w-8 text-muted-foreground/20" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground/90 tracking-tight">
              {searchQuery ? 'No results found' : 'Empty history'}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1.5 leading-relaxed">
              {searchQuery ? `We couldn't find any chats matching "${searchQuery}"` : 'Start your first conversation to see it here.'}
            </p>
          </div>
        ) : groupBy === 'time' ? (
          <div className="py-1 space-y-0.5">
            {timeGroups.map((group) => {
              const groupConvs = groupedByTime[group];
              if (groupConvs.length === 0) return null;

              const isCollapsed = collapsedGroups.has(group);

              return (
                <div key={group}>
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(group)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${TIME_GROUP_LABELS[group]} group`}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors"
                  >
                    <div className={cn(
                      "transition-transform duration-300",
                      isCollapsed ? "-rotate-90" : "rotate-0"
                    )}>
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    </div>
                    <span className="nav-group-label">{TIME_GROUP_LABELS[group]}</span>
                    <div className="flex-1 h-px bg-white/[0.03] mx-2" />
                    <span className="text-[10px] tabular-nums opacity-60">
                      {groupConvs.length}
                    </span>
                  </button>

                  {/* Group Items */}
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {groupConvs.map((conv) => (
                        <ConversationItem
                          key={conv.id}
                          conversation={conv}
                          isActive={currentConversationId === conv.id}
                          onSelect={() => onSelectConversation(conv.id)}
                          onDelete={onDeleteConversation ? () => onDeleteConversation(conv.id) : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-1 space-y-0.5">
            {projectGroups.map((projectId) => {
              const groupConvs = groupedByProject[projectId] || [];
              if (groupConvs.length === 0) return null;

              const isCollapsed = collapsedGroups.has(projectId);
              const project = projects.find((p) => p.id === projectId);
              const projectName = projectId === '_none' ? 'No Project' : project?.name || 'Unknown';

              return (
                <div key={projectId}>
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(projectId)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${projectName} group`}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground/50 hover:text-muted-foreground/70 rounded-md hover:bg-muted/30 transition-colors"
                  >
                    {isCollapsed ? (
                      <Folder className="h-3 w-3" />
                    ) : (
                      <FolderOpen className="h-3 w-3" />
                    )}
                    <span className="truncate">{projectName}</span>
                    <span className="ml-auto text-xs text-muted-foreground/40">
                      {groupConvs.length}
                    </span>
                  </button>

                  {/* Group Items */}
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {groupConvs.map((conv) => (
                        <ConversationItem
                          key={conv.id}
                          conversation={conv}
                          isActive={currentConversationId === conv.id}
                          onSelect={() => onSelectConversation(conv.id)}
                          onDelete={onDeleteConversation ? () => onDeleteConversation(conv.id) : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CollapsibleSidebar>
  );
}

/**
 * Individual conversation item
 */
function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const relativeTime = useMemo(
    () => getRelativeTime(new Date(conversation.updatedAt)),
    [conversation.updatedAt]
  );

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-300 cursor-pointer mx-1',
        isActive
          ? 'bg-[#0a0a0b] text-white shadow-lg shadow-black/20 nav-item-active z-10'
          : 'text-muted-foreground hover:nav-item-hover'
      )}
      onClick={onSelect}
    >
      <div className={cn(
        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm border transition-all duration-300',
        isActive 
          ? 'bg-white/10 border-white/20 shadow-md text-white' 
          : 'bg-white/[0.03] border-white/5'
      )}>
        <MessageSquarePlus className={cn(
          'h-4 w-4 transition-transform duration-500',
          isActive ? 'text-white scale-110' : 'text-muted-foreground/40 group-hover:scale-110'
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-[13px] font-semibold truncate leading-tight tracking-tight',
          isActive ? 'text-white' : 'text-foreground/80'
        )}>{conversation.title}</p>
        <div className="flex items-center gap-2 mt-1 text-[10px] font-medium tracking-wide">
          <span className={cn(isActive ? "text-white/70" : "text-muted-foreground/40")}>{conversation.messageCount} messages</span>
          <span className="h-0.5 w-0.5 rounded-full bg-current opacity-20" />
          <span className={cn(isActive ? "text-white/70" : "text-muted-foreground/40")}>{relativeTime}</span>
        </div>
      </div>

      {/* Delete button - show on hover */}
      {onDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className={cn(
                'absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded transition-all',
                'opacity-0 group-hover:opacity-100',
                'hover:bg-destructive/15 hover:text-destructive',
                'focus:opacity-100 focus:outline-none'
              )}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Delete conversation ${conversation.title}`}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Delete Conversation
              </AlertDialogTitle>
              <AlertDialogDescription className="pt-2">
                Are you sure you want to delete <span className="font-medium text-foreground">"{conversation.title}"</span>?
                This will permanently remove all {conversation.messageCount} messages and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

export default ChatSidebar;
