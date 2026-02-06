/**
 * Ticket Checklist Component
 *
 * Displays checklists with items that can be checked/unchecked.
 * Supports adding, editing, and deleting items.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Square,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Loader2,
} from 'lucide-react';
import { api, type TicketChecklist, type TicketChecklistItem } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TicketChecklistProps {
  ticketId: string;
  checklists: TicketChecklist[];
}

export function TicketChecklistSection({ ticketId, checklists }: TicketChecklistProps) {
  const queryClient = useQueryClient();
  const [isAddingChecklist, setIsAddingChecklist] = useState(false);
  const [newChecklistTitle, setNewChecklistTitle] = useState('');

  // Create checklist mutation
  const createChecklistMutation = useMutation({
    mutationFn: (title: string) => api.tickets.checklists.create(ticketId, { title: title || 'Checklist' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setIsAddingChecklist(false);
      setNewChecklistTitle('');
      toast.success('Checklist created');
    },
    onError: (err: Error) => {
      toast.error(`Failed to create checklist: ${err.message}`);
    },
  });

  const handleAddChecklist = () => {
    if (!newChecklistTitle.trim()) {
      createChecklistMutation.mutate('Checklist');
    } else {
      createChecklistMutation.mutate(newChecklistTitle.trim());
    }
  };

  return (
    <div className="space-y-4">
      {/* Existing Checklists */}
      {checklists.map((checklist) => (
        <ChecklistCard
          key={checklist.id}
          ticketId={ticketId}
          checklist={checklist}
        />
      ))}

      {/* Add Checklist */}
      {isAddingChecklist ? (
        <div className="glass rounded-[16px] p-4 space-y-3">
          <Input
            value={newChecklistTitle}
            onChange={(e) => setNewChecklistTitle(e.target.value)}
            placeholder="Checklist title (optional)"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddChecklist();
              if (e.key === 'Escape') {
                setIsAddingChecklist(false);
                setNewChecklistTitle('');
              }
            }}
            className="bg-white/5 border-white/10 rounded-xl"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleAddChecklist}
              disabled={createChecklistMutation.isPending}
              className="rounded-xl"
            >
              {createChecklistMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add Checklist
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsAddingChecklist(false);
                setNewChecklistTitle('');
              }}
              className="rounded-xl"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAddingChecklist(true)}
          className="w-full gap-2 rounded-xl border-dashed border-white/10 hover:bg-white/5"
        >
          <ListTodo className="h-4 w-4" />
          Add Checklist
        </Button>
      )}
    </div>
  );
}

interface ChecklistCardProps {
  ticketId: string;
  checklist: TicketChecklist;
}

function ChecklistCard({ ticketId, checklist }: ChecklistCardProps) {
  const queryClient = useQueryClient();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(checklist.title);
  const [newItemContent, setNewItemContent] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);

  const completedCount = checklist.items?.filter((item) => item.completed).length ?? 0;
  const totalCount = checklist.items?.length ?? 0;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Delete checklist mutation
  const deleteChecklistMutation = useMutation({
    mutationFn: () => api.tickets.checklists.delete(ticketId, checklist.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      toast.success('Checklist deleted');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete checklist: ${err.message}`);
    },
  });

  // Update checklist title mutation
  const updateTitleMutation = useMutation({
    mutationFn: (title: string) => api.tickets.checklists.update(ticketId, checklist.id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setIsEditingTitle(false);
      toast.success('Title updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update title: ${err.message}`);
    },
  });

  // Add item mutation
  const addItemMutation = useMutation({
    mutationFn: (content: string) => api.tickets.checklists.addItem(ticketId, checklist.id, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setNewItemContent('');
      setIsAddingItem(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to add item: ${err.message}`);
    },
  });

  const handleSaveTitle = () => {
    if (editTitle.trim() && editTitle !== checklist.title) {
      updateTitleMutation.mutate(editTitle.trim());
    } else {
      setIsEditingTitle(false);
      setEditTitle(checklist.title);
    }
  };

  const handleAddItem = () => {
    if (newItemContent.trim()) {
      addItemMutation.mutate(newItemContent.trim());
    }
  };

  return (
    <div className="glass rounded-[16px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 hover:bg-white/5 rounded transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {isEditingTitle ? (
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveTitle();
              if (e.key === 'Escape') {
                setIsEditingTitle(false);
                setEditTitle(checklist.title);
              }
            }}
            autoFocus
            className="h-7 text-sm font-semibold bg-transparent border-0 border-b border-primary/50 rounded-none focus-visible:ring-0 px-0"
          />
        ) : (
          <h4
            className="text-sm font-semibold flex-1 cursor-pointer hover:text-primary transition-colors"
            onClick={() => setIsEditingTitle(true)}
          >
            {checklist.title}
          </h4>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalCount}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setIsEditingTitle(true)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => deleteChecklistMutation.mutate()}
                className="text-red-500 focus:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Progress Bar */}
      {totalCount > 0 && (
        <div className="h-1 bg-muted">
          <div
            className={cn(
              'h-full transition-all duration-300',
              progress === 100 ? 'bg-green-500' : 'bg-primary'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Items */}
      {!isCollapsed && (
        <div className="p-2">
          {(checklist.items ?? []).map((item) => (
            <ChecklistItemRow
              key={item.id}
              ticketId={ticketId}
              checklistId={checklist.id}
              item={item}
            />
          ))}

          {/* Add Item */}
          {isAddingItem ? (
            <div className="flex items-center gap-2 py-2 px-2">
              <Square className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={newItemContent}
                onChange={(e) => setNewItemContent(e.target.value)}
                placeholder="Add an item..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newItemContent.trim()) handleAddItem();
                  if (e.key === 'Escape') {
                    setIsAddingItem(false);
                    setNewItemContent('');
                  }
                }}
                className="h-8 text-sm bg-transparent border-0 focus-visible:ring-0 px-0"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleAddItem}
                disabled={!newItemContent.trim() || addItemMutation.isPending}
                className="h-7 text-xs"
              >
                {addItemMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Add'
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAddingItem(false);
                  setNewItemContent('');
                }}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingItem(true)}
              className="flex items-center gap-2 w-full py-2 px-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add an item
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ChecklistItemRowProps {
  ticketId: string;
  checklistId: string;
  item: TicketChecklistItem;
}

function ChecklistItemRow({ ticketId, checklistId, item }: ChecklistItemRowProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(item.content);

  // Toggle item completed state
  const toggleMutation = useMutation({
    mutationFn: (completed: boolean) =>
      api.tickets.checklists.updateItem(ticketId, checklistId, item.id, { completed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to update item: ${err.message}`);
    },
  });

  // Update item content
  const updateMutation = useMutation({
    mutationFn: (content: string) =>
      api.tickets.checklists.updateItem(ticketId, checklistId, item.id, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setIsEditing(false);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update item: ${err.message}`);
    },
  });

  // Delete item
  const deleteMutation = useMutation({
    mutationFn: () => api.tickets.checklists.deleteItem(ticketId, checklistId, item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete item: ${err.message}`);
    },
  });

  const handleSave = () => {
    if (editContent.trim() && editContent !== item.content) {
      updateMutation.mutate(editContent.trim());
    } else {
      setIsEditing(false);
      setEditContent(item.content);
    }
  };

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 group hover:bg-white/5 rounded-lg transition-colors">
      <button
        onClick={() => toggleMutation.mutate(!item.completed)}
        disabled={toggleMutation.isPending}
        className="mt-0.5 shrink-0"
      >
        {item.completed ? (
          <CheckSquare className="h-4 w-4 text-green-500" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
        )}
      </button>

      {isEditing ? (
        <Input
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') {
              setIsEditing(false);
              setEditContent(item.content);
            }
          }}
          autoFocus
          className="h-6 text-sm bg-transparent border-0 focus-visible:ring-0 px-0 flex-1"
        />
      ) : (
        <span
          onClick={() => setIsEditing(true)}
          className={cn(
            'text-sm flex-1 cursor-pointer',
            item.completed && 'line-through text-muted-foreground'
          )}
        >
          {item.content}
        </span>
      )}

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="h-6 w-6 p-0"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export default TicketChecklistSection;
