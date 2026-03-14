import { describe, expect, it } from 'vitest';
import { getRouteDefinitionsForMode } from './route-loader.js';

function getRouteIds(mode: 'pico' | 'mini' | 'pro'): string[] {
  return getRouteDefinitionsForMode(mode).map((definition) => definition.id);
}

describe('route loader mode planning', () => {
  it('keeps pico focused on core routes', () => {
    const ids = getRouteIds('pico');

    expect(ids).toContain('tasks');
    expect(ids).toContain('auth');
    expect(ids).toContain('webchat');
    expect(ids).not.toContain('dlq');
    expect(ids).not.toContain('cron');
    expect(ids).not.toContain('tickets');
    expect(ids).not.toContain('sync');
    expect(ids).not.toContain('telegram');
  });

  it('adds dashboard, integrations, cron, and channels in mini', () => {
    const ids = getRouteIds('mini');

    expect(ids).toContain('dlq');
    expect(ids).toContain('cron');
    expect(ids).toContain('tickets');
    expect(ids).toContain('projects');
    expect(ids).toContain('telegram');
    expect(ids).toContain('discord');
    expect(ids).not.toContain('sync');
    expect(ids).not.toContain('import');
  });

  it('adds pro-only sync routes', () => {
    const ids = getRouteIds('pro');
    const authDefinition = getRouteDefinitionsForMode('pro').find((definition) => definition.id === 'auth');

    expect(ids).toContain('sync');
    expect(ids).toContain('import');
    expect(authDefinition?.mountPaths).toEqual(['/auth', '/api/auth']);
  });
});
