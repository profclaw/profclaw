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
