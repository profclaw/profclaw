import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext, ToolSession } from '../types.js';

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------

const { mockDeps } = vi.hoisted(() => ({
  mockDeps: {
    // drizzle client returned by getDb()
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
    // logger
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('../../../storage/index.js', () => ({
  getDb: vi.fn(() => mockDeps.db),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: mockDeps.logger,
}));

// drizzle-orm operators are used as tagged template helpers; mock as no-ops
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ _eq: true })),
  sql: new Proxy(
    (strings: TemplateStringsArray, ...vals: unknown[]) => strings.raw.join('') + vals.join(''),
    { get: (_t, p) => (p === Symbol.toPrimitive ? String : vi.fn()) }
  ),
  desc: vi.fn((col: unknown) => col),
  and: vi.fn((...conds: unknown[]) => conds.filter(Boolean)),
  like: vi.fn((_col: unknown, _val: unknown) => ({ _like: true })),
  or: vi.fn((...conds: unknown[]) => ({ _or: conds })),
}));

// Schema tables - referenced by drizzle query builders as column descriptors
vi.mock('../../../storage/schema.js', () => ({
  projects: {
    key: 'projects.key',
    id: 'projects.id',
    name: 'projects.name',
    status: 'projects.status',
    sequence: 'projects.sequence',
  },
  tickets: {
    id: 'tickets.id',
    projectId: 'tickets.projectId',
    sequence: 'tickets.sequence',
    status: 'tickets.status',
    type: 'tickets.type',
    priority: 'tickets.priority',
    title: 'tickets.title',
    description: 'tickets.description',
    labels: 'tickets.labels',
    estimate: 'tickets.estimate',
    createdAt: 'tickets.createdAt',
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are in place
// ---------------------------------------------------------------------------

import {
  _resetDbAvailabilityCache,
  createTicketTool,
  createProjectTool,
  listTicketsTool,
  listProjectsTool,
  updateTicketTool,
  getTicketTool,
} from './profclaw-ops.js';

import { getDb } from '../../../storage/index.js';

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

function createContext(): ToolExecutionContext {
  return {
    toolCallId: 'tool-call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    workdir: '/tmp',
    env: {},
    securityPolicy: { mode: 'ask' },
    sessionManager: {
      create(session: Omit<ToolSession, 'id' | 'createdAt'>): ToolSession {
        return { ...session, id: 'session-1', createdAt: Date.now() };
      },
      get() { return undefined; },
      update() {},
      list() { return []; },
      async kill() {},
      cleanup() {},
    },
  };
}

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const MOCK_PROJECT = {
  id: 'proj-1',
  name: 'profClaw',
  key: 'PC',
  description: 'Main project',
  icon: '🐾',
  color: '#6366f1',
  status: 'active',
  sequence: 1,
};

const MOCK_TICKET = {
  id: 'ticket-1',
  projectId: 'proj-1',
  sequence: 42,
  title: 'Fix login',
  description: 'Details here',
  status: 'backlog',
  type: 'bug',
  priority: 'high',
  labels: ['frontend'],
  estimate: 3,
  createdAt: new Date('2026-03-12T00:00:00Z'),
  projectKey: 'PC',
};

// ---------------------------------------------------------------------------
// Chainable drizzle query builder factory
//
// Returns an object where every method chains back to itself and the object
// is thenable so that `await client.select().from(...).where(...).limit(...)`
// resolves to `rows`.
// ---------------------------------------------------------------------------

function makeDrizzleChain(rows: unknown[]) {
  let resolveRef: ((v: unknown[]) => void) | undefined;
  const pending = new Promise<unknown[]>(res => { resolveRef = res; });

  const chain: Record<string, unknown> = {
    then: (onfulfilled: (v: unknown[]) => unknown, onrejected?: (r: unknown) => unknown) =>
      pending.then(onfulfilled, onrejected),
    catch: (onrejected: (r: unknown) => unknown) => pending.catch(onrejected),
    finally: (onfinally?: () => void) => pending.finally(onfinally),
  };

  for (const m of ['from', 'where', 'limit', 'orderBy', 'values', 'set']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  // Resolve immediately so await works
  resolveRef!(rows);
  return chain;
}

/** Queue of select results - each call consumes one entry */
let selectQueue: unknown[][] = [];

function resetSelectQueue(entries: unknown[][] = []) {
  selectQueue = [...entries];
}

function setupSelectMock() {
  vi.mocked(mockDeps.db.select).mockImplementation(() => {
    const rows = selectQueue.shift() ?? [];
    return makeDrizzleChain(rows) as ReturnType<typeof mockDeps.db.select>;
  });
}

function mockInsertOk() {
  const chain = makeDrizzleChain([]);
  vi.mocked(mockDeps.db.insert).mockReturnValue(chain as ReturnType<typeof mockDeps.db.insert>);
}

function mockUpdateOk() {
  const chain = makeDrizzleChain([]);
  vi.mocked(mockDeps.db.update).mockReturnValue(chain as ReturnType<typeof mockDeps.db.update>);
}

// ---------------------------------------------------------------------------
// DB availability checks (isAvailable)
// ---------------------------------------------------------------------------

describe('checkDatabaseAvailability (isAvailable)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDbAvailabilityCache();
    vi.mocked(getDb).mockReturnValue(mockDeps.db);
  });

  it('returns available:true when getDb() succeeds', () => {
    const avail = createTicketTool.isAvailable?.();
    expect(avail).toMatchObject({ available: true });
  });

  it('returns available:false when getDb() throws', () => {
    vi.mocked(getDb).mockImplementationOnce(() => { throw new Error('not init'); });

    const avail = createTicketTool.isAvailable?.();
    expect(avail).toMatchObject({ available: false, reason: 'Database not initialized' });
  });
});

// ---------------------------------------------------------------------------
// create_ticket
// ---------------------------------------------------------------------------

describe('createTicketTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDbAvailabilityCache();
    vi.mocked(getDb).mockReturnValue(mockDeps.db);
    setupSelectMock();
  });

  it('creates a ticket and returns its key and url', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],   // getProjectByKey
      [{ maxNum: 10 }], // getNextTicketSequence
    ]);
    setupSelectMock();
    mockInsertOk();

    const result = await createTicketTool.execute(createContext(), {
      projectKey: 'PC',
      title: 'Fix login',
      type: 'bug',
      priority: 'high',
    });

    expect(result.success).toBe(true);
    expect(result.data?.key).toBe('PC-11');
    expect(result.data?.url).toMatch(/^\/tickets\//);
    expect(result.data?.status).toBe('backlog');
    expect(mockDeps.db.insert).toHaveBeenCalled();
  });

  it('includes labels in the output when provided', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ maxNum: 5 }],
    ]);
    setupSelectMock();
    mockInsertOk();

    const result = await createTicketTool.execute(createContext(), {
      projectKey: 'PC',
      title: 'Dark mode',
      type: 'feature',
      priority: 'medium',
      labels: ['ui', 'settings'],
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('ui, settings');
    expect(result.data?.labels).toEqual(['ui', 'settings']);
  });

  it('returns PROJECT_NOT_FOUND when project does not exist', async () => {
    resetSelectQueue([[]]); // empty result = project not found
    setupSelectMock();

    const result = await createTicketTool.execute(createContext(), {
      projectKey: 'GHOST',
      title: 'Unreachable',
      type: 'task',
      priority: 'medium',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PROJECT_NOT_FOUND');
    expect(result.error?.message).toContain('GHOST');
  });

  it('returns CREATE_FAILED on DB insert error', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ maxNum: 0 }],
    ]);
    setupSelectMock();
    vi.mocked(mockDeps.db.insert).mockImplementationOnce(() => {
      throw new Error('DB write failed');
    });

    const result = await createTicketTool.execute(createContext(), {
      projectKey: 'PC',
      title: 'Should fail',
      type: 'task',
      priority: 'low',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CREATE_FAILED');
    expect(result.error?.message).toContain('DB write failed');
  });

  it('uses "task" as the default type', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ maxNum: 0 }],
    ]);
    setupSelectMock();
    mockInsertOk();

    const result = await createTicketTool.execute(createContext(), {
      projectKey: 'PC',
      title: 'Default type',
      priority: 'medium',
      type: 'task',
    });

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe('task');
  });

  it('sets storyPoints when provided', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ maxNum: 7 }],
    ]);
    setupSelectMock();
    mockInsertOk();

    const result = await createTicketTool.execute(createContext(), {
      projectKey: 'PC',
      title: 'Sized task',
      type: 'story',
      priority: 'high',
      storyPoints: 8,
    });

    expect(result.success).toBe(true);
    expect(result.data?.storyPoints).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// create_project
// ---------------------------------------------------------------------------

describe('createProjectTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDeps.db);
    setupSelectMock();
  });

  it('creates a project and returns its id, key, and status', async () => {
    resetSelectQueue([
      [],              // key does not exist
      [{ max: 3 }],   // current max sequence
    ]);
    setupSelectMock();
    mockInsertOk();

    const result = await createProjectTool.execute(createContext(), {
      name: 'Mobile App',
      key: 'MOBILE',
      description: 'The mobile project',
      icon: '📱',
      color: '#ff6347',
    });

    expect(result.success).toBe(true);
    expect(result.data?.key).toBe('MOBILE');
    expect(result.data?.status).toBe('active');
    expect(result.data?.icon).toBe('📱');
    expect(result.data?.color).toBe('#ff6347');
    expect(mockDeps.db.insert).toHaveBeenCalled();
  });

  it('upcases the project key', async () => {
    resetSelectQueue([
      [],
      [{ max: 0 }],
    ]);
    setupSelectMock();
    mockInsertOk();

    const result = await createProjectTool.execute(createContext(), {
      name: 'Lowercase Key',
      key: 'lower',
    });

    expect(result.success).toBe(true);
    expect(result.data?.key).toBe('LOWER');
  });

  it('returns KEY_EXISTS when the key is already taken', async () => {
    resetSelectQueue([[MOCK_PROJECT]]); // key already exists
    setupSelectMock();

    const result = await createProjectTool.execute(createContext(), {
      name: 'Duplicate',
      key: 'PC',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('KEY_EXISTS');
    expect(result.error?.message).toContain('PC');
  });

  it('returns CREATE_FAILED on insert exception', async () => {
    resetSelectQueue([
      [],
      [{ max: 0 }],
    ]);
    setupSelectMock();
    vi.mocked(mockDeps.db.insert).mockImplementationOnce(() => {
      throw new Error('insert boom');
    });

    const result = await createProjectTool.execute(createContext(), {
      name: 'Boom',
      key: 'BOOM',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CREATE_FAILED');
    expect(result.error?.message).toContain('insert boom');
  });

  it('uses default icon and color when not provided', async () => {
    resetSelectQueue([
      [],
      [{ max: 0 }],
    ]);
    setupSelectMock();
    mockInsertOk();

    const result = await createProjectTool.execute(createContext(), {
      name: 'Plain',
      key: 'PLAIN',
    });

    expect(result.success).toBe(true);
    expect(result.data?.icon).toBe('📁');
    expect(result.data?.color).toBe('#6366f1');
  });
});

// ---------------------------------------------------------------------------
// list_tickets
// ---------------------------------------------------------------------------

describe('listTicketsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDeps.db);
    setupSelectMock();
  });

  it('returns a table of tickets with keys when tickets exist', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],  // getProjectByKey (for projectKey filter)
      [MOCK_TICKET],   // main tickets query
      [MOCK_PROJECT],  // projectMap lookup by projectId
    ]);
    setupSelectMock();

    const result = await listTicketsTool.execute(createContext(), {
      projectKey: 'PC',
      limit: 20,
    });

    expect(result.success).toBe(true);
    expect(result.data?.tickets).toHaveLength(1);
    expect(result.data?.tickets[0].key).toBe('PC-42');
    expect(result.data?.tickets[0].url).toBe('/tickets/ticket-1');
    expect(result.output).toContain('PC-42');
    expect(result.output).toContain('Fix login');
  });

  it('returns empty message when no tickets match', async () => {
    resetSelectQueue([[]]); // main query returns nothing
    setupSelectMock();

    const result = await listTicketsTool.execute(createContext(), { limit: 20 });

    expect(result.success).toBe(true);
    expect(result.data?.tickets).toHaveLength(0);
    expect(result.output).toContain('No tickets found');
  });

  it('returns LIST_FAILED on DB error', async () => {
    vi.mocked(mockDeps.db.select).mockImplementationOnce(() => {
      throw new Error('select fail');
    });

    const result = await listTicketsTool.execute(createContext(), { limit: 20 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('LIST_FAILED');
    expect(result.error?.message).toContain('select fail');
  });

  it('includes total count equal to number of returned tickets', async () => {
    const t2 = { ...MOCK_TICKET, id: 'ticket-2', sequence: 43 };
    resetSelectQueue([
      [MOCK_TICKET, t2], // no projectKey filter - straight to main query
      [MOCK_PROJECT],    // projectMap for proj-1
    ]);
    setupSelectMock();

    const result = await listTicketsTool.execute(createContext(), { limit: 20 });

    expect(result.success).toBe(true);
    expect(result.data?.total).toBe(result.data?.tickets.length);
  });

  it('filters output by status when status param is provided', async () => {
    resetSelectQueue([
      [{ ...MOCK_TICKET, status: 'done' }],
      [MOCK_PROJECT],
    ]);
    setupSelectMock();

    const result = await listTicketsTool.execute(createContext(), {
      status: 'done',
      limit: 20,
    });

    expect(result.success).toBe(true);
    expect(result.data?.tickets[0].status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------

describe('listProjectsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDeps.db);
    setupSelectMock();
  });

  it('returns active projects with ticket counts', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],    // projects query
      [{ count: 7 }],   // ticket count for proj-1
    ]);
    setupSelectMock();

    const result = await listProjectsTool.execute(createContext(), { status: 'active' });

    expect(result.success).toBe(true);
    expect(result.data?.projects).toHaveLength(1);
    expect(result.data?.projects[0].key).toBe('PC');
    expect(result.data?.projects[0].ticketCount).toBe(7);
    expect(result.output).toContain('PC');
  });

  it('returns a hint with project keys for create_ticket', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ count: 0 }],
    ]);
    setupSelectMock();

    const result = await listProjectsTool.execute(createContext(), { status: 'active' });

    expect(result.success).toBe(true);
    expect(result.data?.hint).toContain('PC');
    expect(result.data?.hint).toContain('create_ticket');
  });

  it('returns empty message and creation hint when no projects exist', async () => {
    resetSelectQueue([[]]); // no projects
    setupSelectMock();

    const result = await listProjectsTool.execute(createContext(), { status: 'active' });

    expect(result.success).toBe(true);
    expect(result.data?.projects).toHaveLength(0);
    expect(result.output).toContain('create_project');
    expect(result.data?.hint).toContain('create_project');
  });

  it('returns LIST_FAILED on DB exception', async () => {
    vi.mocked(mockDeps.db.select).mockImplementationOnce(() => {
      throw new Error('list fail');
    });

    const result = await listProjectsTool.execute(createContext(), { status: 'all' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('LIST_FAILED');
  });

  it('queries all projects when status is "all"', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ count: 2 }],
    ]);
    setupSelectMock();

    const result = await listProjectsTool.execute(createContext(), { status: 'all' });

    expect(result.success).toBe(true);
    expect(result.data?.projects).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// update_ticket
// ---------------------------------------------------------------------------

describe('updateTicketTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDeps.db);
    setupSelectMock();
  });

  it('updates ticket status and returns change summary', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],                          // getProjectByKey (first getTicketByKey)
      [MOCK_TICKET],                           // getTicketByKey - existing ticket
      [MOCK_PROJECT],                          // getProjectByKey (second getTicketByKey)
      [{ ...MOCK_TICKET, status: 'done' }],    // getTicketByKey - updated ticket
    ]);
    setupSelectMock();
    mockUpdateOk();

    const result = await updateTicketTool.execute(createContext(), {
      ticketKey: 'PC-42',
      status: 'done',
    });

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('done');
    expect(result.output).toContain('backlog');
    expect(result.output).toContain('done');
    expect(mockDeps.db.update).toHaveBeenCalled();
  });

  it('returns TICKET_NOT_FOUND for an invalid ticket key (no sequence)', async () => {
    resetSelectQueue([
      [MOCK_PROJECT], // project found
      [],             // but no ticket at that sequence
    ]);
    setupSelectMock();

    const result = await updateTicketTool.execute(createContext(), {
      ticketKey: 'PC-999',
      status: 'done',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns TICKET_NOT_FOUND when the project does not exist', async () => {
    resetSelectQueue([[]]); // project not found
    setupSelectMock();

    const result = await updateTicketTool.execute(createContext(), {
      ticketKey: 'GONE-42',
      status: 'done',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns TICKET_NOT_FOUND for a key with no dash separator', async () => {
    const result = await updateTicketTool.execute(createContext(), {
      ticketKey: 'NODASH',
      status: 'done',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns UPDATE_FAILED on DB update error', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [MOCK_TICKET],
    ]);
    setupSelectMock();
    vi.mocked(mockDeps.db.update).mockImplementationOnce(() => {
      throw new Error('update exploded');
    });

    const result = await updateTicketTool.execute(createContext(), {
      ticketKey: 'PC-42',
      priority: 'critical',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UPDATE_FAILED');
    expect(result.error?.message).toContain('update exploded');
  });

  it('can update multiple fields simultaneously', async () => {
    const updatedTicket = { ...MOCK_TICKET, status: 'in_review', priority: 'critical', estimate: 5 };
    resetSelectQueue([
      [MOCK_PROJECT],
      [MOCK_TICKET],
      [MOCK_PROJECT],
      [updatedTicket],
    ]);
    setupSelectMock();
    mockUpdateOk();

    const result = await updateTicketTool.execute(createContext(), {
      ticketKey: 'PC-42',
      status: 'in_review',
      priority: 'critical',
      storyPoints: 5,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('in_review');
    expect(result.output).toContain('critical');
  });
});

// ---------------------------------------------------------------------------
// get_ticket
// ---------------------------------------------------------------------------

describe('getTicketTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDeps.db);
    setupSelectMock();
  });

  it('returns ticket details for a valid key', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [MOCK_TICKET],
    ]);
    setupSelectMock();

    const result = await getTicketTool.execute(createContext(), { ticketKey: 'PC-42' });

    expect(result.success).toBe(true);
    expect(result.data?.key).toBe('PC-42');
    expect(result.data?.title).toBe('Fix login');
    expect(result.data?.status).toBe('backlog');
    expect(result.data?.url).toBe('/tickets/ticket-1');
    expect(result.output).toContain('PC-42');
    expect(result.output).toContain('Fix login');
  });

  it('includes labels in the output when the ticket has them', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ ...MOCK_TICKET, labels: ['frontend', 'urgent'] }],
    ]);
    setupSelectMock();

    const result = await getTicketTool.execute(createContext(), { ticketKey: 'PC-42' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('frontend');
    expect(result.output).toContain('urgent');
  });

  it('returns TICKET_NOT_FOUND when the ticket does not exist', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [],
    ]);
    setupSelectMock();

    const result = await getTicketTool.execute(createContext(), { ticketKey: 'PC-9999' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TICKET_NOT_FOUND');
    expect(result.error?.message).toContain('PC-9999');
  });

  it('returns TICKET_NOT_FOUND for a non-existent project', async () => {
    resetSelectQueue([[]]); // project not found
    setupSelectMock();

    const result = await getTicketTool.execute(createContext(), { ticketKey: 'GONE-1' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TICKET_NOT_FOUND');
  });

  it('returns GET_FAILED on DB exception', async () => {
    vi.mocked(mockDeps.db.select).mockImplementationOnce(() => {
      throw new Error('db gone');
    });

    const result = await getTicketTool.execute(createContext(), { ticketKey: 'PC-1' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('GET_FAILED');
    expect(result.error?.message).toContain('db gone');
  });

  it('handles a numeric Unix timestamp in createdAt gracefully', async () => {
    const tsSeconds = Math.floor(Date.now() / 1000);
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ ...MOCK_TICKET, createdAt: tsSeconds }],
    ]);
    setupSelectMock();

    const result = await getTicketTool.execute(createContext(), { ticketKey: 'PC-42' });

    expect(result.success).toBe(true);
    // formatDateSafe should produce a valid ISO string
    expect(result.data?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns description in the output when the ticket has one', async () => {
    resetSelectQueue([
      [MOCK_PROJECT],
      [{ ...MOCK_TICKET, description: 'Detailed reproduction steps here' }],
    ]);
    setupSelectMock();

    const result = await getTicketTool.execute(createContext(), { ticketKey: 'PC-42' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Detailed reproduction steps here');
  });
});
