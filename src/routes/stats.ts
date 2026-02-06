/**
 * Stats API Routes - Dashboard Analytics
 */
import { Hono } from 'hono';
import { getDb } from '../storage/index.js';
import { tasks, tickets, summaries, projects, sprints } from '../storage/schema.js';
import { eq, and, sql, type InferSelectModel } from 'drizzle-orm';

// Infer types from schema
type Task = InferSelectModel<typeof tasks>;
type Ticket = InferSelectModel<typeof tickets>;
type Summary = InferSelectModel<typeof summaries>;
type Project = InferSelectModel<typeof projects>;
type Sprint = InferSelectModel<typeof sprints>;

export const statsRoutes = new Hono();

/**
 * GET /api/stats/dashboard - Get comprehensive dashboard statistics
 */
statsRoutes.get('/dashboard', async (c) => {
  const db = getDb();

  // Get date 30 days ago for velocity data
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get date 7 days ago for weekly stats
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    // Task stats
    const allTasks: Task[] = await db.select().from(tasks);
    const taskStats = {
      total: allTasks.length,
      pending: allTasks.filter((t: Task) => t.status === 'pending').length,
      queued: allTasks.filter((t: Task) => t.status === 'queued').length,
      inProgress: allTasks.filter((t: Task) => t.status === 'in_progress').length,
      completed: allTasks.filter((t: Task) => t.status === 'completed').length,
      failed: allTasks.filter((t: Task) => t.status === 'failed').length,
      cancelled: allTasks.filter((t: Task) => t.status === 'cancelled').length,
    };

    // Ticket stats
    const allTickets: Ticket[] = await db.select().from(tickets);
    const ticketStats = {
      total: allTickets.length,
      open: allTickets.filter((t: Ticket) => ['backlog', 'todo', 'in_progress', 'in_review'].includes(t.status)).length,
      inProgress: allTickets.filter((t: Ticket) => t.status === 'in_progress').length,
      done: allTickets.filter((t: Ticket) => t.status === 'done').length,
      byType: allTickets.reduce((acc: Record<string, number>, t: Ticket) => {
        acc[t.type] = (acc[t.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byPriority: allTickets.reduce((acc: Record<string, number>, t: Ticket) => {
        acc[t.priority] = (acc[t.priority] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      aiCreated: allTickets.filter((t: Ticket) => t.createdBy === 'ai').length,
    };

    // Project stats
    const allProjects: Project[] = await db.select().from(projects);
    const activeProjects = allProjects.filter((p: Project) => p.status === 'active');

    // Sprint stats
    const allSprints: Sprint[] = await db.select().from(sprints);
    const sprintStats = {
      active: allSprints.filter((s: Sprint) => s.status === 'active').length,
      planning: allSprints.filter((s: Sprint) => s.status === 'planning').length,
      completed: allSprints.filter((s: Sprint) => s.status === 'completed').length,
    };

    // Summary stats
    const allSummaries: Summary[] = await db.select().from(summaries);
    const summaryStats = {
      total: allSummaries.length,
      byAgent: allSummaries.reduce((acc: Record<string, number>, s: Summary) => {
        acc[s.agent] = (acc[s.agent] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    // Helper to safely parse date
    const safeGetDateStr = (dateValue: any): string | null => {
      if (!dateValue) return null;
      try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split('T')[0];
      } catch {
        return null;
      }
    };

    // Velocity data - tasks per day for last 30 days
    const velocityData: Array<{ date: string; created: number; completed: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const created = allTasks.filter(t => {
        const taskDate = safeGetDateStr(t.createdAt);
        return taskDate === dateStr;
      }).length;

      const completed = allTasks.filter(t => {
        if (!t.completedAt) return false;
        const taskDate = safeGetDateStr(t.completedAt);
        return taskDate === dateStr;
      }).length;

      velocityData.push({ date: dateStr, created, completed });
    }

    // Calculate weekly averages
    const lastWeekData = velocityData.slice(-7);
    const weeklyCreated = lastWeekData.reduce((sum, d) => sum + d.created, 0);
    const weeklyCompleted = lastWeekData.reduce((sum, d) => sum + d.completed, 0);

    // Ticket velocity data
    const ticketVelocity: Array<{ date: string; created: number; completed: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const created = allTickets.filter(t => {
        const ticketDate = safeGetDateStr(t.createdAt);
        return ticketDate === dateStr;
      }).length;

      const completed = allTickets.filter(t => {
        if (!t.completedAt) return false;
        const ticketDate = safeGetDateStr(t.completedAt);
        return ticketDate === dateStr;
      }).length;

      ticketVelocity.push({ date: dateStr, created, completed });
    }

    return c.json({
      tasks: taskStats,
      tickets: ticketStats,
      projects: {
        total: allProjects.length,
        active: activeProjects.length,
      },
      sprints: sprintStats,
      summaries: summaryStats,
      velocity: {
        tasks: velocityData,
        tickets: ticketVelocity,
        weeklyAvg: {
          created: Math.round(weeklyCreated / 7 * 10) / 10,
          completed: Math.round(weeklyCompleted / 7 * 10) / 10,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return c.json({
      tasks: { total: 0, pending: 0, queued: 0, inProgress: 0, completed: 0, failed: 0, cancelled: 0 },
      tickets: { total: 0, open: 0, inProgress: 0, done: 0, byType: {}, byPriority: {}, aiCreated: 0 },
      projects: { total: 0, active: 0 },
      sprints: { active: 0, planning: 0, completed: 0 },
      summaries: { total: 0, byAgent: {} },
      velocity: { tasks: [], tickets: [], weeklyAvg: { created: 0, completed: 0 } },
    });
  }
});

// Type for sprint ticket query results
type SprintTicketRow = {
  ticketId: string;
  estimate: number | null;
  status: string;
  completedAt: Date | null;
};

type SprintTicketSimpleRow = {
  estimate: number | null;
  status: string;
};

/**
 * GET /api/stats/sprints/:id/burndown - Get sprint burndown data
 */
statsRoutes.get('/sprints/:id/burndown', async (c) => {
  const sprintId = c.req.param('id');
  const db = getDb();

  try {
    // Get sprint details
    const sprintResult = await db
      .select()
      .from(sprints)
      .where(eq(sprints.id, sprintId))
      .limit(1);

    if (sprintResult.length === 0) {
      return c.json({ error: 'Sprint not found' }, 404);
    }

    const sprint = sprintResult[0];

    // Get all tickets in this sprint with their estimates and completion status
    const sprintTicketsResult: SprintTicketRow[] = await db
      .select({
        ticketId: tickets.id,
        estimate: tickets.estimate,
        status: tickets.status,
        completedAt: tickets.completedAt,
      })
      .from(tickets)
      .innerJoin(
        sql`sprint_tickets`,
        sql`sprint_tickets.ticket_id = ${tickets.id}`
      )
      .where(sql`sprint_tickets.sprint_id = ${sprintId}`);

    // Calculate total points
    const totalPoints = sprintTicketsResult.reduce((sum: number, t: SprintTicketRow) => sum + (t.estimate || 0), 0);
    const ticketCount = sprintTicketsResult.length;

    // If sprint has no dates, return simple stats
    if (!sprint.startDate || !sprint.endDate) {
      return c.json({
        sprint: {
          id: sprint.id,
          name: sprint.name,
          status: sprint.status,
          capacity: sprint.capacity,
        },
        totalPoints,
        ticketCount,
        completedPoints: sprintTicketsResult
          .filter((t: SprintTicketRow) => t.status === 'done')
          .reduce((sum: number, t: SprintTicketRow) => sum + (t.estimate || 0), 0),
        burndown: [],
        ideal: [],
      });
    }

    // Generate day-by-day burndown
    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate);
    const burndown: Array<{ date: string; remaining: number; ideal: number }> = [];

    // Calculate sprint duration in days
    const sprintDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const pointsPerDay = totalPoints / (sprintDays - 1);

    // Generate burndown data for each day
    const today = new Date();
    for (let day = 0; day < sprintDays; day++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + day);
      const dateStr = currentDate.toISOString().split('T')[0];

      // Calculate ideal remaining (linear burndown)
      const idealRemaining = Math.max(0, totalPoints - (pointsPerDay * day));

      // Calculate actual remaining (points not yet completed by this date)
      let remaining = totalPoints;
      if (currentDate <= today) {
        for (const ticket of sprintTicketsResult) {
          if (ticket.status === 'done' && ticket.completedAt) {
            const completedDate = new Date(ticket.completedAt);
            if (completedDate <= currentDate) {
              remaining -= (ticket.estimate || 0);
            }
          }
        }
      } else {
        // Future dates - no actual data
        remaining = -1; // Indicates no data
      }

      burndown.push({
        date: dateStr,
        remaining: remaining >= 0 ? remaining : undefined,
        ideal: Math.round(idealRemaining * 10) / 10,
      } as any);
    }

    return c.json({
      sprint: {
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        capacity: sprint.capacity,
      },
      totalPoints,
      ticketCount,
      completedPoints: sprintTicketsResult
        .filter((t: SprintTicketRow) => t.status === 'done')
        .reduce((sum: number, t: SprintTicketRow) => sum + (t.estimate || 0), 0),
      burndown,
    });
  } catch (error) {
    console.error('Error fetching sprint burndown:', error);
    return c.json({ error: 'Failed to fetch sprint burndown' }, 500);
  }
});

/**
 * GET /api/stats/projects/:id/velocity - Get project velocity data
 */
statsRoutes.get('/projects/:id/velocity', async (c) => {
  const projectId = c.req.param('id');
  const db = getDb();

  try {
    // Get completed sprints for this project
    const completedSprints: Sprint[] = await db
      .select()
      .from(sprints)
      .where(and(
        eq(sprints.projectId, projectId),
        eq(sprints.status, 'completed')
      ))
      .orderBy(sql`${sprints.completedAt} ASC`)
      .limit(10);

    // Calculate velocity for each sprint
    const velocityData: Array<{
      sprintId: string;
      sprintName: string;
      completedAt: string;
      plannedPoints: number;
      completedPoints: number;
      ticketCount: number;
      completedTickets: number;
    }> = [];

    for (const sprint of completedSprints) {
      // Get tickets for this sprint
      const sprintTicketsResult: SprintTicketSimpleRow[] = await db
        .select({
          estimate: tickets.estimate,
          status: tickets.status,
        })
        .from(tickets)
        .innerJoin(
          sql`sprint_tickets`,
          sql`sprint_tickets.ticket_id = ${tickets.id}`
        )
        .where(sql`sprint_tickets.sprint_id = ${sprint.id}`);

      const plannedPoints = sprintTicketsResult.reduce((sum: number, t: SprintTicketSimpleRow) => sum + (t.estimate || 0), 0);
      const completedPoints = sprintTicketsResult
        .filter((t: SprintTicketSimpleRow) => t.status === 'done')
        .reduce((sum: number, t: SprintTicketSimpleRow) => sum + (t.estimate || 0), 0);

      velocityData.push({
        sprintId: sprint.id,
        sprintName: sprint.name,
        completedAt: sprint.completedAt?.toString() || '',
        plannedPoints,
        completedPoints,
        ticketCount: sprintTicketsResult.length,
        completedTickets: sprintTicketsResult.filter((t: SprintTicketSimpleRow) => t.status === 'done').length,
      });
    }

    // Calculate average velocity
    const avgVelocity = velocityData.length > 0
      ? Math.round(velocityData.reduce((sum, v) => sum + v.completedPoints, 0) / velocityData.length)
      : 0;

    return c.json({
      projectId,
      sprints: velocityData,
      averageVelocity: avgVelocity,
      sprintCount: velocityData.length,
    });
  } catch (error) {
    console.error('Error fetching project velocity:', error);
    return c.json({ error: 'Failed to fetch velocity data' }, 500);
  }
});

/**
 * GET /api/stats/projects/:id - Get project-specific statistics
 */
statsRoutes.get('/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const db = getDb();

  try {
    // Get project tickets
    const projectTickets: Ticket[] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.projectId, projectId));

    // Get project sprints
    const projectSprints: Sprint[] = await db
      .select()
      .from(sprints)
      .where(eq(sprints.projectId, projectId));

    const ticketStats = {
      total: projectTickets.length,
      byStatus: projectTickets.reduce((acc: Record<string, number>, t: Ticket) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byType: projectTickets.reduce((acc: Record<string, number>, t: Ticket) => {
        acc[t.type] = (acc[t.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byPriority: projectTickets.reduce((acc: Record<string, number>, t: Ticket) => {
        acc[t.priority] = (acc[t.priority] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    const sprintStats = {
      total: projectSprints.length,
      active: projectSprints.filter((s: Sprint) => s.status === 'active').length,
      completed: projectSprints.filter((s: Sprint) => s.status === 'completed').length,
    };

    return c.json({
      tickets: ticketStats,
      sprints: sprintStats,
    });
  } catch (error) {
    console.error('Error fetching project stats:', error);
    return c.json({ error: 'Failed to fetch project stats' }, 500);
  }
});
