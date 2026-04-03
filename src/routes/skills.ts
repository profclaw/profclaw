/**
 * Skills API Routes
 *
 * REST API for managing the skills system:
 * - List all skills with status
 * - Get skill details
 * - Reload skills from disk
 * - Install skill dependencies
 * - Get skills prompt/snapshot
 */

import { Hono } from 'hono';
import { getSkillsRegistry } from '../skills/index.js';
import { installSkillDependencies } from '../skills/installer.js';
import { buildSkillsStatus } from '../skills/loader.js';
import { DEFAULT_SKILLS_CONFIG } from '../skills/types.js';

export const skillsRoutes = new Hono();

/**
 * GET /api/skills - List all skills with status
 */
skillsRoutes.get('/', async (c) => {
  const registry = getSkillsRegistry();
  const allEntries = registry.getAllEntries();
  const stats = registry.getStats();
  const status = buildSkillsStatus(allEntries, 0);

  return c.json({
    skills: status.skills.map((s) => ({
      name: s.name,
      source: s.source,
      enabled: s.enabled,
      eligible: s.eligible,
      errors: s.errors,
      emoji: s.metadata?.emoji,
      description: allEntries.find((e) => e.name === s.name)?.description ?? '',
      userInvocable: allEntries.find((e) => e.name === s.name)?.invocation.userInvocable ?? false,
      modelInvocable: allEntries.find((e) => e.name === s.name)?.invocation.modelInvocable ?? false,
      toolCategories: s.metadata?.toolCategories ?? [],
    })),
    stats: {
      total: status.totalLoaded,
      eligible: status.totalEligible,
      enabled: status.totalEnabled,
      bySource: status.sources,
      mcpServers: stats.mcpServers,
      estimatedTokens: stats.estimatedTokens,
    },
  });
});

/**
 * GET /api/skills/:name - Get skill details
 */
skillsRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const registry = getSkillsRegistry();
  const skill = registry.getSkill(name);

  if (!skill) {
    return c.json({ error: `Skill not found: ${name}` }, 404);
  }

  return c.json({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    dirPath: skill.dirPath,
    eligible: skill.eligible,
    eligibilityErrors: skill.eligibilityErrors,
    enabled: skill.enabled,
    invocation: skill.invocation,
    metadata: skill.metadata,
    command: skill.command,
    instructions: skill.instructions,
    frontmatter: skill.frontmatter,
  });
});

/**
 * POST /api/skills/reload - Reload all skills from disk
 */
skillsRoutes.post('/reload', async (c) => {
  const registry = getSkillsRegistry();
  await registry.reload();

  const stats = registry.getStats();
  return c.json({
    message: 'Skills reloaded',
    stats,
  });
});

/**
 * POST /api/skills/:name/install - Install dependencies for a skill
 */
skillsRoutes.post('/:name/install', async (c) => {
  const name = c.req.param('name');
  const registry = getSkillsRegistry();
  const skill = registry.getSkill(name);

  if (!skill) {
    return c.json({ error: `Skill not found: ${name}` }, 404);
  }

  if (!skill.metadata?.install || skill.metadata.install.length === 0) {
    return c.json({ error: 'No install specs for this skill' }, 400);
  }

  const results = await installSkillDependencies(
    skill.metadata.install,
    DEFAULT_SKILLS_CONFIG,
  );

  // Re-check eligibility after install
  await registry.reload();

  return c.json({
    skill: name,
    results,
    allSucceeded: results.every((r) => r.success),
  });
});

/**
 * GET /api/skills/snapshot/prompt - Get current skills prompt
 */
skillsRoutes.get('/snapshot/prompt', async (c) => {
  const registry = getSkillsRegistry();
  const prompt = await registry.getSkillsPrompt();
  const stats = registry.getStats();

  return c.json({
    prompt,
    estimatedTokens: stats.estimatedTokens,
    skillCount: stats.totalSkills,
  });
});

/**
 * GET /api/skills/mcp-servers - List registered MCP servers
 */
skillsRoutes.get('/mcp-servers', async (c) => {
  const registry = getSkillsRegistry();
  const servers = registry.getMCPServers();

  return c.json({
    servers: servers.map((s) => ({
      name: s.name,
      connected: s.connected,
      toolCount: s.tools.length,
      tools: s.tools.map((t) => t.name),
    })),
  });
});

/**
 * POST /api/skills/:name/toggle - Enable/disable a skill
 */
skillsRoutes.post('/:name/toggle', async (c) => {
  const name = c.req.param('name');
  const registry = getSkillsRegistry();
  const skill = registry.getSkill(name);

  if (!skill) {
    return c.json({ error: `Skill not found: ${name}` }, 404);
  }

  // Toggle the enabled state
  skill.enabled = !skill.enabled;

  return c.json({
    name: skill.name,
    enabled: skill.enabled,
  });
});

// --- Marketplace Routes ---

import { getMarketplace } from '../skills/marketplace.js';
import { getSkillEffectiveness } from '../skills/compiler.js';

/** Search marketplace for skills */
skillsRoutes.get('/marketplace/search', async (c) => {
  const marketplace = getMarketplace();
  const query = c.req.query('q');
  const category = c.req.query('category');
  const tag = c.req.query('tag');
  const sortBy = c.req.query('sortBy') as 'installs' | 'rating' | 'updated' | 'name' | undefined;
  const limit = c.req.query('limit');

  const results = await marketplace.search({
    query: query || undefined,
    category: category || undefined,
    tag: tag || undefined,
    sortBy,
    limit: limit ? parseInt(limit) : undefined,
  });

  return c.json({ success: true, data: results });
});

/** Install a skill from marketplace, GitHub, or URL */
skillsRoutes.post('/marketplace/install', async (c) => {
  const body = await c.req.json() as { source?: string };
  if (!body.source) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'source is required' } }, 400);
  }

  const marketplace = getMarketplace();
  const result = await marketplace.install(body.source);

  if (result.success) {
    // Reload skills registry to pick up new skill
    const registry = getSkillsRegistry();
    await registry.reload();
  }

  return c.json({ success: result.success, data: result });
});

/** Uninstall a managed skill */
skillsRoutes.delete('/marketplace/:name', async (c) => {
  const marketplace = getMarketplace();
  const removed = await marketplace.uninstall(c.req.param('name'));

  if (removed) {
    const registry = getSkillsRegistry();
    await registry.reload();
  }

  return c.json({ success: removed });
});

/** Check for skill updates */
skillsRoutes.get('/marketplace/updates', async (c) => {
  const marketplace = getMarketplace();
  const updates = await marketplace.checkUpdates();
  return c.json({ success: true, data: updates });
});

/** List configured registries */
skillsRoutes.get('/marketplace/registries', (c) => {
  const marketplace = getMarketplace();
  return c.json({ success: true, data: marketplace.listRegistries() });
});

/** Get all categories from installed skills */
skillsRoutes.get('/categories', (_c) => {
  const registry = getSkillsRegistry();
  const entries = registry.getAllEntries();
  const categories = new Map<string, number>();

  for (const entry of entries) {
    const cats = entry.metadata?.toolCategories ?? [];
    if (cats.length === 0) {
      categories.set('uncategorized', (categories.get('uncategorized') ?? 0) + 1);
    }
    for (const cat of cats) {
      categories.set(cat, (categories.get(cat) ?? 0) + 1);
    }
  }

  const sorted = [...categories.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return _c.json({ success: true, data: sorted });
});

/** Get skill effectiveness/usage stats */
skillsRoutes.get('/:name/effectiveness', (c) => {
  const name = c.req.param('name');
  const records = getSkillEffectiveness(name);

  const totalAttempts = records.reduce((s, r) => s + r.attempts, 0);
  const totalSuccesses = records.reduce((s, r) => s + r.successes, 0);
  const overallRate = totalAttempts > 0 ? totalSuccesses / totalAttempts : 0;

  return c.json({
    success: true,
    data: {
      skillId: name,
      totalAttempts,
      totalSuccesses,
      overallSuccessRate: Math.round(overallRate * 100),
      byModel: records.map(r => ({
        model: r.modelId,
        attempts: r.attempts,
        successRate: Math.round(r.successRate * 100),
        avgDurationMs: Math.round(r.avgDurationMs),
      })),
    },
  });
});

/** Get aggregate skill stats for dashboard */
skillsRoutes.get('/stats/overview', (_c) => {
  const registry = getSkillsRegistry();
  const entries = registry.getAllEntries();
  const registryStats = registry.getStats();

  // Group by category
  const byCategory: Record<string, number> = {};
  for (const entry of entries) {
    for (const cat of entry.metadata?.toolCategories ?? ['other']) {
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
  }

  // Count user vs model invocable
  const userInvocable = entries.filter(e => e.invocation.userInvocable).length;
  const modelInvocable = entries.filter(e => e.invocation.modelInvocable).length;
  const eligible = entries.filter(e => e.eligible !== false).length;
  const enabled = entries.filter(e => e.enabled !== false).length;

  return _c.json({
    success: true,
    data: {
      total: registryStats.totalSkills,
      enabled,
      eligible,
      bySource: registryStats.bySource,
      byCategory,
      userInvocable,
      modelInvocable,
      mcpServers: registryStats.mcpServers,
    },
  });
});
