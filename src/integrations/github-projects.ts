/**
 * GitHub Projects V2 GraphQL Client
 *
 * Handles fetching GitHub Projects, items, and iterations via the GraphQL API.
 * Used by the import wizard to fetch data from GitHub.
 */

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

// Types for GitHub Projects V2 API responses
export interface GitHubProject {
  id: string;
  number: number;
  title: string;
  shortDescription?: string;
  url: string;
  public: boolean;
  creator?: { login: string };
  items: { totalCount: number };
  fields: { totalCount: number };
}

export interface GitHubIteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

export interface GitHubProjectItem {
  id: string;
  title: string;
  body?: string;
  url: string;
  status?: string;
  priority?: string;
  type?: string;
  labels: string[];
  assignees: string[];
  iteration?: string;
  createdAt: string;
  updatedAt: string;
  issueNumber?: number;
  repoOwner?: string;
  repoName?: string;
}

export interface GitHubProjectPreview {
  project: {
    id: string;
    title: string;
    url: string;
  };
  iterations: GitHubIteration[];
  items: GitHubProjectItem[];
  fieldMappings: {
    status: Record<string, string>;
    priority: Record<string, string>;
    type: Record<string, string>;
  };
}

// GraphQL Queries
const LIST_PROJECTS_QUERY = `
  query ListProjects($first: Int!) {
    viewer {
      projectsV2(first: $first) {
        nodes {
          id
          number
          title
          shortDescription
          url
          public
          creator { login }
          items { totalCount }
          fields { totalCount }
        }
      }
    }
  }
`;

const GET_PROJECT_ITEMS_QUERY = `
  query GetProjectItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        title
        url
        items(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            content {
              ... on Issue {
                number
                title
                body
                url
                state
                createdAt
                updatedAt
                labels(first: 10) { nodes { name } }
                assignees(first: 5) { nodes { login } }
                repository {
                  owner { login }
                  name
                }
              }
              ... on DraftIssue {
                title
                body
                createdAt
                updatedAt
              }
              ... on PullRequest {
                number
                title
                body
                url
                state
                createdAt
                updatedAt
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldIterationValue {
                  iterationId
                  title
                  startDate
                  duration
                  field { ... on ProjectV2IterationField { name } }
                }
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  field { ... on ProjectV2Field { name } }
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field { ... on ProjectV2Field { name } }
                }
              }
            }
          }
        }
        fields(first: 20) {
          nodes {
            ... on ProjectV2IterationField {
              name
              configuration {
                iterations {
                  id
                  title
                  startDate
                  duration
                }
              }
            }
            ... on ProjectV2SingleSelectField {
              name
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

const VALIDATE_TOKEN_QUERY = `
  query ValidateToken {
    viewer {
      login
      id
    }
  }
`;

const LIST_REPOS_QUERY = `
  query ListRepos($first: Int!, $after: String) {
    viewer {
      repositories(first: $first, after: $after, orderBy: { field: PUSHED_AT, direction: DESC }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          nameWithOwner
          description
          url
          isPrivate
          isFork
          isArchived
          stargazerCount
          defaultBranchRef { name }
          pushedAt
          owner { login }
          hasIssuesEnabled
          hasProjectsEnabled
        }
      }
    }
  }
`;

export interface GitHubRepo {
  id: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stargazerCount: number;
  defaultBranch: string;
  pushedAt: string | null;
  owner: string;
  hasIssuesEnabled: boolean;
  hasProjectsEnabled: boolean;
}

interface GraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface GitHubRepoNode {
  id: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stargazerCount: number;
  defaultBranchRef?: { name?: string | null } | null;
  pushedAt: string | null;
  owner: { login: string };
  hasIssuesEnabled: boolean;
  hasProjectsEnabled: boolean;
}

interface GitHubProjectNode {
  id: string;
  number: number;
  title: string;
  shortDescription?: string;
  url: string;
  public: boolean;
  creator?: { login: string };
  items: { totalCount: number };
  fields: { totalCount: number };
}

interface GitHubProjectOptionNode {
  id: string;
  name: string;
}

interface GitHubIterationConfigNode {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

interface GitHubProjectFieldNode {
  name?: string;
  options?: GitHubProjectOptionNode[];
  configuration?: {
    iterations?: GitHubIterationConfigNode[];
  };
}

interface GitHubItemFieldValueNode {
  iterationId?: string;
  title?: string;
  name?: string;
  field?: { name?: string };
}

interface GitHubProjectItemContent {
  number?: number;
  title?: string;
  body?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
  labels?: { nodes?: Array<{ name: string }> };
  assignees?: { nodes?: Array<{ login: string }> };
  repository?: {
    owner?: { login: string };
    name?: string;
  };
}

interface GitHubProjectItemNode {
  id: string;
  content?: GitHubProjectItemContent | null;
  fieldValues?: {
    nodes?: GitHubItemFieldValueNode[];
  };
}

interface ListReposResponse {
  viewer: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      nodes: GitHubRepoNode[];
    };
  };
}

interface ListProjectsResponse {
  viewer: {
    projectsV2: {
      nodes: GitHubProjectNode[];
    };
  };
}

interface ProjectItemsResponse {
  node: {
    id: string;
    title: string;
    url: string;
    items: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      nodes: GitHubProjectItemNode[];
    };
    fields: {
      nodes: GitHubProjectFieldNode[];
    };
  };
}

interface ProjectFieldsResponse {
  node: {
    id: string;
    title: string;
    url: string;
    fields: { nodes: GitHubProjectFieldNode[] };
  };
}

/**
 * Execute a GraphQL query against GitHub's API
 */
async function executeGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profClaw',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json() as GraphQLResult<T>;

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors.map((e) => e.message).join(', ');
    throw new Error(`GraphQL error: ${errorMessages}`);
  }

  return result.data as T;
}

/**
 * Validate a GitHub token and get the associated username
 */
export async function validateGitHubToken(token: string): Promise<{ valid: boolean; username?: string; error?: string }> {
  try {
    const data = await executeGraphQL<{ viewer: { login: string; id: string } }>(token, VALIDATE_TOKEN_QUERY);
    return {
      valid: true,
      username: data.viewer.login,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid token',
    };
  }
}

/**
 * List all repositories accessible by the token
 */
export async function listGitHubRepos(token: string, limit: number = 100): Promise<GitHubRepo[]> {
  const allRepos: GitHubRepo[] = [];
  let hasNextPage = true;
  let after: string | undefined;

  while (hasNextPage && allRepos.length < limit) {
    const data = await executeGraphQL<ListReposResponse>(
      token,
      LIST_REPOS_QUERY,
      { first: Math.min(50, limit - allRepos.length), after },
    );

    for (const repo of data.viewer.repositories.nodes) {
      allRepos.push({
        id: repo.id,
        name: repo.name,
        nameWithOwner: repo.nameWithOwner,
        description: repo.description,
        url: repo.url,
        isPrivate: repo.isPrivate,
        isFork: repo.isFork,
        isArchived: repo.isArchived,
        stargazerCount: repo.stargazerCount,
        defaultBranch: repo.defaultBranchRef?.name || 'main',
        pushedAt: repo.pushedAt,
        owner: repo.owner.login,
        hasIssuesEnabled: repo.hasIssuesEnabled,
        hasProjectsEnabled: repo.hasProjectsEnabled,
      });
    }

    hasNextPage = data.viewer.repositories.pageInfo.hasNextPage;
    after = data.viewer.repositories.pageInfo.endCursor;
  }

  return allRepos;
}

/**
 * List all GitHub Projects V2 accessible by the token
 */
export async function listGitHubProjects(token: string): Promise<GitHubProject[]> {
  const data = await executeGraphQL<ListProjectsResponse>(token, LIST_PROJECTS_QUERY, { first: 50 });

  return data.viewer.projectsV2.nodes.map((node) => ({
    id: node.id,
    number: node.number,
    title: node.title,
    shortDescription: node.shortDescription,
    url: node.url,
    public: node.public,
    creator: node.creator,
    items: node.items,
    fields: node.fields,
  }));
}

/**
 * Get preview data for a GitHub Project (items + iterations)
 */
export async function getGitHubProjectPreview(token: string, projectId: string): Promise<GitHubProjectPreview> {
  const allItems: GitHubProjectItem[] = [];
  let hasNextPage = true;
  let after: string | undefined;

  // Paginate through all items
  while (hasNextPage) {
    const data = await executeGraphQL<ProjectItemsResponse>(
      token,
      GET_PROJECT_ITEMS_QUERY,
      { projectId, first: 100, after },
    );

    const project = data.node;

    // Extract field mappings (status, priority options)
    const fieldMappings = extractFieldMappings(project.fields.nodes);

    // Process items
    for (const item of project.items.nodes) {
      const processedItem = processProjectItem(item);
      if (processedItem) {
        allItems.push(processedItem);
      }
    }

    // Extract iterations from the first page
    if (!after) {
      const iterations = extractIterations(project.fields.nodes);

      if (!project.items.pageInfo.hasNextPage) {
        return {
          project: {
            id: project.id,
            title: project.title,
            url: project.url,
          },
          iterations,
          items: allItems,
          fieldMappings,
        };
      }
    }

    hasNextPage = project.items.pageInfo.hasNextPage;
    after = project.items.pageInfo.endCursor;
  }

  // Fetch one more time for field mappings if we paginated
  const data = await executeGraphQL<ProjectFieldsResponse>(
    token,
    GET_PROJECT_ITEMS_QUERY,
    { projectId, first: 1 },
  );

  const fieldMappings = extractFieldMappings(data.node.fields.nodes);
  const iterations = extractIterations(data.node.fields.nodes);

  return {
    project: {
      id: data.node.id,
      title: data.node.title,
      url: data.node.url,
    },
    iterations,
    items: allItems,
    fieldMappings,
  };
}

/**
 * Extract iterations from field nodes
 */
function extractIterations(fieldNodes: GitHubProjectFieldNode[]): GitHubIteration[] {
  const iterations: GitHubIteration[] = [];

  for (const field of fieldNodes) {
    if (field.configuration?.iterations) {
      for (const iteration of field.configuration.iterations) {
        iterations.push({
          id: iteration.id,
          title: iteration.title,
          startDate: iteration.startDate,
          duration: iteration.duration,
        });
      }
    }
  }

  return iterations;
}

/**
 * Extract field mappings from field nodes
 */
function extractFieldMappings(fieldNodes: GitHubProjectFieldNode[]): GitHubProjectPreview['fieldMappings'] {
  const mappings = {
    status: {} as Record<string, string>,
    priority: {} as Record<string, string>,
    type: {} as Record<string, string>,
  };

  // Default profClaw status mappings
  const statusMap: Record<string, string> = {
    'Todo': 'todo',
    'To Do': 'todo',
    'Backlog': 'backlog',
    'In Progress': 'in_progress',
    'In Review': 'in_review',
    'Done': 'done',
    'Closed': 'done',
    'Cancelled': 'cancelled',
    'Canceled': 'cancelled',
  };

  // Default priority mappings
  const priorityMap: Record<string, string> = {
    'Urgent': 'critical',
    'Critical': 'critical',
    'High': 'high',
    'Medium': 'medium',
    'Low': 'low',
    'None': 'none',
  };

  // Default type mappings
  const typeMap: Record<string, string> = {
    'Bug': 'bug',
    'Feature': 'feature',
    'Task': 'task',
    'Epic': 'epic',
    'Story': 'story',
    'Subtask': 'subtask',
  };

  for (const field of fieldNodes) {
    if (field.options) {
      const fieldName = (field.name || '').toLowerCase();

      for (const option of field.options) {
        const optionName = option.name;

        // Map to profClaw values based on field name
        if (fieldName === 'status' || fieldName === 'state') {
          mappings.status[optionName] = statusMap[optionName] || 'backlog';
        } else if (fieldName === 'priority') {
          mappings.priority[optionName] = priorityMap[optionName] || 'medium';
        } else if (fieldName === 'type' || fieldName === 'issue type' || fieldName === 'category') {
          mappings.type[optionName] = typeMap[optionName] || 'task';
        }
      }
    }
  }

  return mappings;
}

/**
 * Process a project item into our standard format
 */
function processProjectItem(item: GitHubProjectItemNode): GitHubProjectItem | null {
  const content = item.content;
  if (!content) return null;

  // Get field values
  let status: string | undefined;
  let priority: string | undefined;
  let type: string | undefined;
  let iteration: string | undefined;

  if (item.fieldValues?.nodes) {
    for (const fv of item.fieldValues.nodes) {
      if (fv.field?.name) {
        const fieldName = fv.field.name.toLowerCase();
        if (fieldName === 'status' || fieldName === 'state') {
          status = fv.name;
        } else if (fieldName === 'priority') {
          priority = fv.name;
        } else if (fieldName === 'type' || fieldName === 'issue type' || fieldName === 'category') {
          type = fv.name;
        }
      }
      if (fv.iterationId) {
        iteration = fv.title;
      }
    }
  }

  return {
    id: item.id,
    title: content.title || 'Untitled',
    body: content.body,
    url: content.url || '',
    status,
    priority,
    type,
    labels: content.labels?.nodes?.map((l) => l.name) || [],
    assignees: content.assignees?.nodes?.map((a) => a.login) || [],
    iteration,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    issueNumber: content.number,
    repoOwner: content.repository?.owner?.login,
    repoName: content.repository?.name,
  };
}
