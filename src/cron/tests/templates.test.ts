import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from '../templates.js';
import { getDb } from '../../storage/index.js';

vi.mock('../../storage/index.js', () => ({
  getDb: vi.fn()
}));

describe('TemplateService', () => {
  let service: TemplateService;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      select: vi.fn(),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({ rowsAffected: 1 }) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) }),
    };
    (getDb as any).mockResolvedValue(mockDb);
    service = new TemplateService();
  });

  it('should list templates and handle filters', async () => {
    const mockTemplates = [
      { id: '1', name: 'T1', category: 'sync', jobType: 'tool', isBuiltIn: true, createdAt: Date.now(), updatedAt: Date.now() },
      { id: '2', name: 'T2', category: 'report', jobType: 'tool', isBuiltIn: false, userId: 'u1', createdAt: Date.now(), updatedAt: Date.now() }
    ];
    mockDb.select.mockReturnValue({ from: vi.fn().mockResolvedValue(mockTemplates) });

    const all = await service.listTemplates();
    expect(all.length).toBe(2);

    const filtered = await service.listTemplates({ category: 'sync' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('1');
  });

  it('should apply template with variables', () => {
    const template: any = {
      jobType: 'tool',
      payloadTemplate: {
        repo: '{{owner}}/{{repo}}',
        nested: { key: '{{val}}' }
      }
    };
    const variables = { owner: 'glinr', repo: 'tm', val: 'foo' };
    
    const result = service.applyTemplate(template, variables);
    expect(result.payload.repo).toBe('glinr/tm');
    expect(result.payload.nested.key).toBe('foo');
  });

  it('should not allow deleting built-in templates', async () => {
    mockDb.select.mockReturnValue({ 
      from: vi.fn().mockReturnValue({ 
        where: vi.fn().mockResolvedValue([{ id: 'builtin-test', isBuiltIn: true }]) 
      }) 
    });

    const success = await service.deleteTemplate('builtin-test');
    expect(success).toBe(false);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
