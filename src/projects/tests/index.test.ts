import { describe, it, expect, beforeAll } from 'vitest';
import { initStorage } from '../../storage/index.js';
import { 
  createProject, 
  getProject, 
  getProjectByKey, 
  updateProject, 
  queryProjects, 
  archiveProject,
  createProjectExternalLink,
  getProjectExternalLinks,
  findProjectByExternalId,
  createSprint, 
  getSprint,
  getProjectSprints,
  getActiveSprint,
  startSprint,
  completeSprint,
  cancelSprint,
  updateSprint,
  deleteSprint,
  getSprintWithStats,
  querySprints
} from '../index.js';
import { randomUUID } from 'crypto';

describe('Projects Service', () => {
  beforeAll(async () => {
    process.env.STORAGE_TIER = 'memory';
    await initStorage();
  });

  describe('Projects', () => {
    it('should create and retrieve a project', async () => {
      const key = `TST${Math.floor(Math.random() * 1000)}`;
      const input = {
        key,
        name: 'Test Project',
        description: 'A test project'
      };

      const project = await createProject(input);
      expect(project.id).toBeDefined();
      expect(project.key).toBe(key);

      const retrieved = await getProject(project.id);
      expect(retrieved?.name).toBe(input.name);

      const byKey = await getProjectByKey(key);
      expect(byKey?.id).toBe(project.id);
    });

    it('should update a project', async () => {
      const project = await createProject({
        key: `UPD${Math.floor(Math.random() * 1000)}`,
        name: 'Old Name'
      });

      const updated = await updateProject(project.id, { name: 'New Name' });
      expect(updated.name).toBe('New Name');
    });

    it('should query projects', async () => {
      await createProject({ key: 'Q1', name: 'Query Test 1' });
      await createProject({ key: 'Q2', name: 'Query Test 2' });

      const { projects, total } = await queryProjects({ search: 'Query Test' });
      expect(projects.length).toBeGreaterThanOrEqual(2);
      expect(total).toBeGreaterThanOrEqual(2);
    });

    it('should archive a project', async () => {
      const project = await createProject({ key: 'ARC', name: 'To Archive' });
      await archiveProject(project.id);
      const archived = await getProject(project.id);
      expect(archived?.status).toBe('archived');
      expect(archived?.archivedAt).toBeDefined();
    });

    it('should handled external links', async () => {
      const project = await createProject({ key: 'EXT', name: 'External Project' });
      await createProjectExternalLink(project.id, {
        platform: 'linear',
        externalId: 'team-123',
        externalUrl: 'https://linear.app/team-123'
      });

      const links = await getProjectExternalLinks(project.id);
      expect(links.length).toBe(1);
      expect(links[0].platform).toBe('linear');

      const found = await findProjectByExternalId('linear', 'team-123');
      expect(found?.id).toBe(project.id);
    });
  });

  describe('Sprints', () => {
    it('should manage sprint lifecycle', async () => {
      const project = await createProject({ key: 'LC', name: 'Lifecycle Project' });
      const sprint = await createSprint(project.id, { name: 'Lifecycle Sprint' });
      
      expect(sprint.status).toBe('planning');

      const started = await startSprint(sprint.id);
      expect(started.status).toBe('active');
      expect(started.startDate).toBeDefined();

      const completed = await completeSprint(sprint.id);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();

      const cancelledSprint = await createSprint(project.id, { name: 'Cancel Me' });
      const cancelled = await cancelSprint(cancelledSprint.id);
      expect(cancelled.status).toBe('cancelled');
    });

    it('should get sprint with stats', async () => {
      const project = await createProject({ key: 'STS', name: 'Stats Project' });
      const sprint = await createSprint(project.id, { name: 'Stats Sprint' });
      
      const stats = await getSprintWithStats(sprint.id);
      expect(stats).not.toBeNull();
      expect(stats?.ticketCount).toBe(0);
    });

    it('should handle sprint ticket assignments and reordering', async () => {
      const project = await createProject({ key: 'STK', name: 'Sprint Tickets' });
      const sprint = await createSprint(project.id, { name: 'Sprint 1', startDate: new Date().toISOString(), endDate: new Date().toISOString() });
      
      const { createTicket } = await import('../../tickets/index.js');
      const t1 = await createTicket({ projectId: project.id, title: 'Ticket 1' });
      const t2 = await createTicket({ projectId: project.id, title: 'Ticket 2' });

      const { addTicketsToSprint, getSprintTickets, reorderSprintTickets, removeTicketFromSprint } = await import('../index.js');
      
      await addTicketsToSprint(sprint.id, { ticketIds: [t1.id, t2.id] });
      const tickets = await getSprintTickets(sprint.id);
      expect(tickets.length).toBe(2);
      expect(tickets[0]).toBe(t1.id);

      await reorderSprintTickets(sprint.id, [t2.id, t1.id]);
      const reordered = await getSprintTickets(sprint.id);
      expect(reordered[0]).toBe(t2.id);

      await removeTicketFromSprint(sprint.id, t1.id);
      const afterRemoval = await getSprintTickets(sprint.id);
      expect(afterRemoval.length).toBe(1);
    });
  });

  describe('Query Sprints', () => {
    it('should query sprints with search', async () => {
      const project = await createProject({ key: 'QS', name: 'Query Sprints' });
      await createSprint(project.id, { name: 'Alpha Sprint' });
      await createSprint(project.id, { name: 'Beta Sprint' });

      const { querySprints } = await import('../index.js');
      const { sprints, total } = await querySprints({ search: 'Alpha' });
      expect(sprints.length).toBe(1);
      expect(sprints[0].name).toBe('Alpha Sprint');
      expect(total).toBe(1);
    });

    it('should sort sprints by start date', async () => {
        const project = await createProject({ key: 'SRT', name: 'Sort Sprints' });
        const d1 = new Date('2025-01-01').toISOString();
        const d2 = new Date('2025-02-01').toISOString();
        await createSprint(project.id, { name: 'S1', startDate: d1 });
        await createSprint(project.id, { name: 'S2', startDate: d2 });

        const { querySprints } = await import('../index.js');
        const { sprints } = await querySprints({ projectId: project.id, sortBy: 'startDate', sortOrder: 'desc' });
        expect(sprints[0].name).toBe('S2');
    });
  });

  describe('Edge Cases', () => {
    it('should throw if starting a sprint not in planning', async () => {
      const project = await createProject({ key: 'ERR', name: 'Error Project' });
      const sprint = await createSprint(project.id, { name: 'Err Sprint' });
      await startSprint(sprint.id);
      
      await expect(startSprint(sprint.id)).rejects.toThrow(/cannot be started/);
    });

    it('should throw if completing a sprint not active', async () => {
        const project = await createProject({ key: 'ERR2', name: 'Error Project 2' });
        const sprint = await createSprint(project.id, { name: 'Err Sprint' });
        await expect(completeSprint(sprint.id)).rejects.toThrow(/cannot be completed/);
    });

    it('should return null if project not found', async () => {
      const project = await getProject('non-existent');
      expect(project).toBeNull();
    });
  });

  describe('Default Project Management', () => {
    it('should get or create default project', async () => {
      const { getOrCreateDefaultProject } = await import('../index.js');
      const project = await getOrCreateDefaultProject();
      expect(project.key).toBe('GLINR');
    });

    it('should migrate tickets to default project', async () => {
      const { createTicket } = await import('../../tickets/index.js');
      await createTicket({ title: 'Unassigned Ticket' }); // null projectId

      const { migrateTicketsToDefaultProject } = await import('../index.js');
      const result = await migrateTicketsToDefaultProject();
      expect(result.migrated).toBeGreaterThan(0);
    });
  });

  describe('Advanced Sprint Operations', () => {
    it('should calculate sprint stats correctly', async () => {
      const key = `ST${Math.floor(Math.random() * 10000)}`;
      const project = await createProject({ key, name: 'Stat project' });
      const sprint = await createSprint(project.id, { name: 'Stat Sprint' });
      
      const { createTicket } = await import('../../tickets/index.js');
      const t1 = await createTicket({ projectId: project.id, title: 'T1', estimate: 5 });
      const t2 = await createTicket({ projectId: project.id, title: 'T2', status: 'done', estimate: 3 });
      
      const { addTicketsToSprint } = await import('../index.js');
      await addTicketsToSprint(sprint.id, { ticketIds: [t1.id, t2.id] });
      
      const stats = await getSprintWithStats(sprint.id);
      expect(stats?.ticketCount).toBe(2);
      expect(stats?.completedCount).toBe(1);
      expect(stats?.totalPoints).toBe(8);
      expect(stats?.completedPoints).toBe(3);
    });

    it('should update a sprint with dates', async () => {
        const key = `UP${Math.floor(Math.random() * 10000)}`;
        const project = await createProject({ key, name: 'Update project' });
        const sprint = await createSprint(project.id, { name: 'Old' });
        
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const updated = await updateSprint(sprint.id, { name: 'New', startDate: nextWeek });
        expect(updated.name).toBe('New');
        expect(updated.startDate).toBeDefined();
    });

    it('should delete a sprint and its assignments', async () => {
        const key = `DL${Math.floor(Math.random() * 10000)}`;
        const project = await createProject({ key, name: 'Delete project' });
        const sprint = await createSprint(project.id, { name: 'Gone' });
        const success = await deleteSprint(sprint.id);
        expect(success).toBe(true);
        expect(await getSprint(sprint.id)).toBeNull();
    });

    it('should query sprints with array status and sorting', async () => {
        const key = `QS${Math.floor(Math.random() * 10000)}`;
        const project = await createProject({ key, name: 'Query project' });
        await createSprint(project.id, { name: 'S1' });
        
        const results = await querySprints({ 
            status: ['planning', 'active'],
            sortBy: 'endDate',
            sortOrder: 'asc'
        });
        expect(results.sprints.length).toBeGreaterThan(0);
    });
  });

  describe('Sprint Helpers', () => {
    it('should get project sprints', async () => {
      const project = await createProject({ key: 'PH', name: 'Helper Project' });
      await createSprint(project.id, { name: 'S1' });
      
      const sprints = await getProjectSprints(project.id);
      expect(sprints.length).toBe(1);
    });

    it('should get active sprint', async () => {
      const project = await createProject({ key: 'PH2', name: 'Helper Project 2' });
      const sprint = await createSprint(project.id, { name: 'S1' });
      await startSprint(sprint.id);

      const active = await getActiveSprint(project.id);
      expect(active?.id).toBe(sprint.id);
    });
  });

  describe('Project Deletion', () => {
    it('should delete a project and its links', async () => {
      const project = await createProject({ key: 'DEL', name: 'Delete Me' });
      await createProjectExternalLink(project.id, { platform: 'github', externalId: 'repo' });
      
      const { deleteProject } = await import('../index.js');
      const success = await deleteProject(project.id);
      expect(success).toBe(true);

      const retrieved = await getProject(project.id);
      expect(retrieved).toBeNull();
    });
  });
});
