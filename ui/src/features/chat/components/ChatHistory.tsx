/**
 * Chat History Sheet Component
 *
 * Side panel showing recent conversations.
 */

import {
  History,
  MessageSquarePlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { Conversation } from '../types';

interface ChatHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

export function ChatHistory({
  open,
  onOpenChange,
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewChat,
}: ChatHistoryProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="glass border-l-0 p-0 w-[280px]">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-border/50">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-sm">
                <History className="h-4 w-4" />
                History
              </SheetTitle>
              <SheetDescription className="text-xs">
                Recent conversations
              </SheetDescription>
            </SheetHeader>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                <MessageSquarePlus className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">No conversations yet</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Start a new chat to see history
                </p>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  aria-label={`Select conversation: ${conv.title}`}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-xl transition-all group',
                    currentConversationId === conv.id
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquarePlus className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {conv.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {conv.preview || 'No messages'}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground/70">
                        <span>{conv.messageCount} msgs</span>
                        <span>·</span>
                        <span>{new Date(conv.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-border/50">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                onNewChat();
                onOpenChange(false);
              }}
            >
              <MessageSquarePlus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              New Conversation
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
