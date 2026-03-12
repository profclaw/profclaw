import { describe, it, expect, beforeAll } from 'vitest';
import { initStorage } from '../../storage/index.js';
import { 
  createTicket, 
  getTicket, 
  getTicketWithRelations, 
  updateTicket, 
  queryTickets, 
  bulkUpdateTickets, 
  bulkDeleteTickets,
  deleteTicket 
} from '../index.js';
import { createProject } from '../../projects/index.js';

describe('Ticket Service', () => {
  let projectId: string;

  beforeAll(async () => {
    process.env.STORAGE_TIER = 'memory';
    await initStorage();
    const project = await createProject({ key: 'TKT', name: 'Ticket Project' });
    projectId = project.id;
  });

  describe('CRUD Operations', () => {
    it('should create and retrieve a ticket', async () => {
      const input = {
        projectId,
        title: 'Test Ticket',
        description: 'Testing tickets',
        priority: 'high' as const,
        type: 'bug' as const
      };

      const ticket = await createTicket(input);
      expect(ticket.id).toBeDefined();
      expect(ticket.title).toBe(input.title);

      const retrieved = await getTicket(ticket.id);
      expect(retrieved?.id).toBe(ticket.id);
    });

    it('should update a ticket', async () => {
      const ticket = await createTicket({ projectId, title: 'Old Title' });
      const updated = await updateTicket(ticket.id, { title: 'New Title', status: 'in_progress' });
      expect(updated?.title).toBe('New Title');
      expect(updated?.status).toBe('in_progress');
      expect(updated?.startedAt).toBeDefined();
    });

    it('should delete a ticket', async () => {
      const ticket = await createTicket({ projectId, title: 'To Delete' });
      const success = await deleteTicket(ticket.id);
      expect(success).toBe(true);
      const retrieved = await getTicket(ticket.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Queries and Bulk Operations', () => {
    it('should query tickets with filters', async () => {
      await createTicket({ projectId, title: 'Query 1', status: 'backlog' });
      await createTicket({ projectId, title: 'Query 2', status: 'todo' });

      const { tickets, total } = await queryTickets({ projectId, status: 'todo' });
      expect(total).toBeGreaterThanOrEqual(1);
      expect(tickets.every(t => t.status === 'todo')).toBe(true);
    });

    it('should bulk update tickets', async () => {
      const t1 = await createTicket({ projectId, title: 'Bulk 1' });
      const t2 = await createTicket({ projectId, title: 'Bulk 2' });

      const result = await bulkUpdateTickets({
        ids: [t1.id, t2.id],
        updates: { status: 'done' }
      });

      expect(result.updated.length).toBe(2);
      expect(result.updated.every(t => t.status === 'done')).toBe(true);
    });

    it('should bulk delete tickets', async () => {
        const t1 = await createTicket({ projectId, title: 'Del 1' });
        const t2 = await createTicket({ projectId, title: 'Del 2' });

        const result = await bulkDeleteTickets({ ids: [t1.id, t2.id] });
        expect(result.deletedIds.length).toBe(2);
        
        const retrieved = await getTicket(t1.id);
        expect(retrieved).toBeNull();
    });
  });

  describe('Relations and History', () => {
    it('should get a ticket with full relations', async () => {
      const ticket = await createTicket({ projectId, title: 'Full Ticket' });
      const withRelations = await getTicketWithRelations(ticket.id);
      expect(withRelations).not.toBeNull();
      expect(withRelations?.history).toBeDefined();
      expect(withRelations?.comments).toBeDefined();
    });

    it('should link tickets with relations', async () => {
        const t1 = await createTicket({ projectId, title: 'Source' });
        const t2 = await createTicket({ projectId, title: 'Target' });
  
        const { createTicketRelation, getTicketRelations } = await import('../index.js');
        const relation = await createTicketRelation(t1.id, t2.id, 'blocks' as any);
        expect(relation.relationType).toBe('blocks');
  
        const relations = await getTicketRelations(t1.id);
        expect(relations.length).toBe(1);
      });
  });

  describe('Comments, Watchers, and Assignees', () => {
    it('should handle ticket comments', async () => {
      const ticket = await createTicket({ projectId, title: 'Comment Test' });
      const author = {
        name: 'Tester',
        type: 'human' as const,
        platform: 'profclaw'
      };

      const { addComment, getComments } = await import('../index.js');
      const comment = await addComment(ticket.id, 'Test comment', author);
      expect(comment.content).toBe('Test comment');

      const comments = await getComments(ticket.id);
      expect(comments.length).toBe(1);
    });

    it('should handle watchers and secondary assignees', async () => {
      const ticket = await createTicket({ projectId, title: 'Subsidiary Test' });
      
      const { addTicketWatcher, getTicketWatchers, addTicketAssignee, getTicketAssignees } = await import('../index.js');
      
      await addTicketWatcher(ticket.id, 'user-1');
      const watchers = await getTicketWatchers(ticket.id);
      expect(watchers.length).toBe(1);

      await addTicketAssignee(ticket.id, 'user-2');
      const assignees = await getTicketAssignees(ticket.id);
      expect(assignees.length).toBe(1);
    });

    it('should handle mentions, attachments, and reactions', async () => {
      const ticket = await createTicket({ projectId, title: 'Extra Test' });
      const { 
        addTicketMention, getTicketMentions, 
        addTicketAttachment, getTicketAttachments,
        addTicketReaction, getTicketReactions 
      } = await import('../index.js');

      await addTicketMention({ ticketId: ticket.id, userId: 'user-3', source: 'description' });
      const mentions = await getTicketMentions(ticket.id);
      expect(mentions.length).toBe(1);

      await addTicketAttachment({ ticketId: ticket.id, fileName: 'test.png', url: 'http://test.com' });
      const attachments = await getTicketAttachments(ticket.id);
      expect(attachments.length).toBe(1);

      await addTicketReaction({ ticketId: ticket.id, userId: 'user-4', emoji: '🚀' });
      const reactions = await getTicketReactions(ticket.id);
      expect(reactions.length).toBe(1);
    });
  });

  describe('Sync Helper Operations', () => {
    it('should create and update tickets from sync', async () => {
      const { createTicketFromSync, updateTicketFromSync, getTicketByExternalLink } = await import('../index.js');
      
      const link = { platform: 'github', externalId: 'repo/issue/1' };
      const now = new Date().toISOString();
      const ticketData = {
        title: 'Sync Ticket',
        description: 'Synced',
        type: 'task' as const,
        priority: 'medium' as const,
        status: 'backlog' as const,
        labels: [],
        createdBy: 'human' as const,
        linkedPRs: [],
        linkedCommits: [],
        createdAt: now,
        updatedAt: now
      } as any;

      const syncTicket = await createTicketFromSync(ticketData, link);
      expect(syncTicket.id).toBeDefined();

      const found = await getTicketByExternalLink('github', 'repo/issue/1');
      expect(found?.id).toBe(syncTicket.id);

      const updated = await updateTicketFromSync(syncTicket.id, { status: 'done' }, 'github');
      expect(updated?.status).toBe('done');
    });

    it('should add comments from sync', async () => {
        const ticket = await createTicket({ projectId, title: 'Sync Comment' });
        const { addCommentFromSync } = await import('../index.js');
        
        const comment = await addCommentFromSync(
            ticket.id, 
            'External comment', 
            { type: 'human', name: 'GitHub User', platform: 'github' },
            'ext-id-123'
        );
        expect(comment.externalId).toBe('ext-id-123');
    });
  });

  describe('Advanced Queries', () => {
    it('should filter by labels', async () => {
      await createTicket({ projectId, title: 'Label A', labels: ['urgent', 'frontend'] });
      await createTicket({ projectId, title: 'Label B', labels: ['frontend'] });

      const { tickets } = await queryTickets({ label: 'urgent' });
      expect(tickets.length).toBe(1);
      expect(tickets[0].title).toBe('Label A');
    });
  });

  describe('Edge Cases', () => {
    it('should return null when updating non-existent ticket', async () => {
      const result = await updateTicket('non-existent', { title: 'New' });
      expect(result).toBeNull();
    });
  });
});
