import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Link2,
  ArrowRight,
  Ban,
  Copy,
  Loader2,
  Search,
} from 'lucide-react';
import { api } from '@/core/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { TicketRelation, TicketRelationType } from '@/core/types';

interface RelationsWidgetProps {
  ticketId: string;
  relations?: TicketRelation[];
}

const RELATION_TYPES: Array<{
  value: TicketRelationType;
  label: string;
  icon: typeof ArrowRight;
  color: string;
  description: string;
}> = [
  {
    value: 'blocks',
    label: 'Blocks',
    icon: Ban,
    color: 'text-red-400',
    description: 'This ticket blocks another',
  },
  {
    value: 'blocked_by',
    label: 'Blocked by',
    icon: Ban,
    color: 'text-orange-400',
    description: 'This ticket is blocked by another',
  },
  {
    value: 'relates_to',
    label: 'Relates to',
    icon: Link2,
    color: 'text-blue-400',
    description: 'Related tickets',
  },
  {
    value: 'duplicates',
    label: 'Duplicates',
    icon: Copy,
    color: 'text-purple-400',
    description: 'This ticket duplicates another',
  },
  {
    value: 'start_before',
    label: 'Start before',
    icon: ArrowRight,
    color: 'text-cyan-400',
    description: 'Must start before another ticket',
  },
  {
    value: 'finish_before',
    label: 'Finish before',
    icon: ArrowRight,
    color: 'text-emerald-400',
    description: 'Must finish before another ticket',
  },
];

function getRelationConfig(type: TicketRelationType) {
  return RELATION_TYPES.find((r) => r.value === type) || RELATION_TYPES[2];
}

export function RelationsWidget({ ticketId, relations = [] }: RelationsWidgetProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [relationType, setTicketRelationType] = useState<TicketRelationType>('relates_to');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Search for tickets to link
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['tickets-search', searchQuery],
    queryFn: () =>
      api.tickets.list({
        search: searchQuery,
        limit: 10,
      }),
    enabled: searchQuery.length >= 2,
    staleTime: 10000,
  });

  const searchTickets = searchResults?.tickets?.filter((t) => t.id !== ticketId) || [];

  // Add relation mutation
  const addRelationMutation = useMutation({
    mutationFn: ({
      targetTicketId,
      type,
    }: {
      targetTicketId: string;
      type: TicketRelationType;
    }) => api.tickets.addRelation(ticketId, targetTicketId, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      setIsAddOpen(false);
      setSearchQuery('');
      setSelectedTicketId(null);
      toast.success('Relation added');
    },
    onError: (err: Error) => {
      toast.error(`Failed to add relation: ${err.message}`);
    },
  });

  // Remove relation mutation
  const removeRelationMutation = useMutation({
    mutationFn: (relationId: string) =>
      api.tickets.removeRelation(ticketId, relationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      toast.success('Relation removed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to remove relation: ${err.message}`);
    },
  });

  const handleAddRelation = () => {
    if (!selectedTicketId) {
      toast.error('Please select a ticket');
      return;
    }
    addRelationMutation.mutate({
      targetTicketId: selectedTicketId,
      type: relationType,
    });
  };

  // Group relations by type
  const groupedRelations = relations.reduce(
    (acc, rel) => {
      const type = rel.relationType;
      if (!acc[type]) acc[type] = [];
      acc[type].push(rel);
      return acc;
    },
    {} as Record<TicketRelationType, TicketRelation[]>
  );

  const relationCount = relations.length;

  return (
    <div className="glass rounded-[20px] p-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition-colors">
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Link2 className="h-4 w-4" />
              Relations
              {relationCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {relationCount}
                </Badge>
              )}
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="h-7 w-7 p-0 rounded-lg"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <CollapsibleContent className="pt-3 space-y-3">
          {relationCount === 0 ? (
            <div className="text-center py-4">
              <Link2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No relations</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddOpen(true)}
                className="mt-2 h-7 text-xs gap-1"
              >
                <Plus className="h-3 w-3" />
                Add relation
              </Button>
            </div>
          ) : (
            Object.entries(groupedRelations).map(([type, rels]) => {
              const config = getRelationConfig(type as TicketRelationType);
              return (
                <div key={type} className="space-y-1.5">
                  <div className={cn('flex items-center gap-1.5 text-xs font-medium', config.color)}>
                    <config.icon className="h-3 w-3" />
                    {config.label}
                  </div>
                  <div className="space-y-1">
                    {rels.map((rel) => {
                      const linkedTicket =
                        rel.sourceTicketId === ticketId
                          ? rel.targetTicket
                          : rel.sourceTicket;
                      if (!linkedTicket) return null;

                      return (
                        <div
                          key={rel.id}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/5 group"
                        >
                          <Link
                            to={`/tickets/${linkedTicket.id}`}
                            className="flex-1 min-w-0 hover:text-primary transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-muted-foreground">
                                {linkedTicket.projectKey || 'PROFCLAW'}-
                                {linkedTicket.sequence}
                              </span>
                              <span className="text-xs truncate">
                                {linkedTicket.title}
                              </span>
                            </div>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeRelationMutation.mutate(rel.id)}
                            disabled={removeRelationMutation.isPending}
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            {removeRelationMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3 text-muted-foreground hover:text-red-400" />
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Add Relation Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Relation</DialogTitle>
            <DialogDescription>
              Link this ticket to another ticket.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Relation Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Relation Type</label>
              <Select
                value={relationType}
                onValueChange={(v) => setTicketRelationType(v as TicketRelationType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATION_TYPES.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value}>
                      <span className={cn('flex items-center gap-2', rt.color)}>
                        <rt.icon className="h-4 w-4" />
                        {rt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {RELATION_TYPES.find((r) => r.value === relationType)?.description}
              </p>
            </div>

            {/* Search Tickets */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Search Ticket</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by title or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Search Results */}
            {searchQuery.length >= 2 && (
              <div className="bg-muted/30 rounded-lg divide-y divide-border/20 max-h-48 overflow-y-auto">
                {isSearching ? (
                  <div className="p-4 text-center">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  </div>
                ) : searchTickets.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No tickets found
                  </div>
                ) : (
                  searchTickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className={cn(
                        'w-full text-left p-3 hover:bg-muted/50 transition-colors',
                        selectedTicketId === ticket.id && 'bg-primary/10'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">
                          {ticket.projectKey || 'PROFCLAW'}-{ticket.sequence}
                        </span>
                        <span className="text-sm truncate">{ticket.title}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Selected Ticket Preview */}
            {selectedTicketId && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-xs text-muted-foreground mb-1">Selected:</p>
                <p className="text-sm font-medium">
                  {searchTickets.find((t) => t.id === selectedTicketId)?.title ||
                    'Ticket selected'}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddRelation}
              disabled={!selectedTicketId || addRelationMutation.isPending}
            >
              {addRelationMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Add Relation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
