import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../storage/index.js', () => ({
  getStorage: vi.fn(() => ({})),
}));

vi.mock('../../ai/embedding-service.js', () => ({
  getEmbeddingService: vi.fn(() => ({
    provider: 'mock-embeddings',
    generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  })),
}));

vi.mock('../../summaries/index.js', () => ({
  getSummary: vi.fn(),
  searchSummaries: vi.fn(async () => []),
}));

vi.mock('../../queue/index.js', () => ({
  getTask: vi.fn(),
  getTasks: vi.fn(() => []),
}));

import { Hono } from 'hono';
import { getEmbeddingService } from '../../ai/embedding-service.js';
import { searchRoutes } from '../search.js';

function makeApp() {
  const app = new Hono();
  app.route('/api/search', searchRoutes);
  return app;
}

describe('search routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for an invalid text-search type', async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request('http://localhost/api/search/text?q=test&type=invalid'),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid search type');
  });

  it('returns 400 for an invalid semantic-search type', async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request('http://localhost/api/search/semantic?q=test&type=invalid'),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid search type');
  });

  it('reports the embedding provider in capabilities', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://localhost/api/search/capabilities'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.embeddingProvider).toBe('mock-embeddings');
    expect(getEmbeddingService).toHaveBeenCalledOnce();
  });
});
