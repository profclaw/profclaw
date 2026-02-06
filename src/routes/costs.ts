import { Hono } from 'hono';
import { getUsageSummary } from '../costs/token-tracker.js';
import { getBudgetStatus } from '../costs/budget.js';
import { getStorage } from '../storage/index.js';

const costs = new Hono();

// Get usage summary
costs.get('/summary', (c) => {
  const summary = getUsageSummary();
  return c.json(summary);
});

// Get budget status
costs.get('/budget', (c) => {
  const status = getBudgetStatus();
  return c.json(status);
});

// Get historical cost analytics
costs.get('/analytics', async (c) => {
  const storage = getStorage();
  const analytics = await storage.getCostAnalytics();
  return c.json(analytics);
});

// Export cost report as CSV
costs.get('/export', async (c) => {
  const format = c.req.query('format') || 'csv';
  const storage = getStorage();
  const summary = getUsageSummary();
  const analytics = await storage.getCostAnalytics();

  if (format === 'json') {
    return c.json({
      exportedAt: new Date().toISOString(),
      summary,
      analytics,
    });
  }

  // Generate CSV
  const rows: string[] = [];

  // Header
  rows.push('Report Type,Category,Value,Unit');

  // Summary section
  rows.push(`Summary,Total Tokens,${summary.totalTokens},tokens`);
  rows.push(`Summary,Input Tokens,${summary.inputTokens},tokens`);
  rows.push(`Summary,Output Tokens,${summary.outputTokens},tokens`);
  rows.push(`Summary,Total Cost,${summary.totalCost.toFixed(6)},USD`);
  rows.push(`Summary,Task Count,${summary.taskCount},tasks`);

  // By model
  if (summary.byModel) {
    for (const [model, data] of Object.entries(summary.byModel)) {
      const modelData = data as { tokens: number; cost: number; tasks: number };
      rows.push(`By Model,${model} - Tokens,${modelData.tokens},tokens`);
      rows.push(`By Model,${model} - Cost,${modelData.cost.toFixed(6)},USD`);
      rows.push(`By Model,${model} - Tasks,${modelData.tasks},tasks`);
    }
  }

  // By agent
  if (summary.byAgent) {
    for (const [agent, data] of Object.entries(summary.byAgent)) {
      const agentData = data as { tokens: number; cost: number; tasks: number };
      rows.push(`By Agent,${agent} - Tokens,${agentData.tokens},tokens`);
      rows.push(`By Agent,${agent} - Cost,${agentData.cost.toFixed(6)},USD`);
      rows.push(`By Agent,${agent} - Tasks,${agentData.tasks},tasks`);
    }
  }

  // Daily data
  if (analytics.daily && Array.isArray(analytics.daily)) {
    rows.push(''); // Empty row separator
    rows.push('Date,Tokens,Cost (USD)');
    for (const day of analytics.daily) {
      rows.push(`${day.date},${day.tokens},${day.cost.toFixed(6)}`);
    }
  }

  const csv = rows.join('\n');
  const filename = `glinr-cost-report-${new Date().toISOString().split('T')[0]}.csv`;

  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  return c.text(csv);
});

export { costs as costsRoutes };
