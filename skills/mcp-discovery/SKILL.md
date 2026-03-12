---
name: mcp-discovery
description: Discover and use MCP servers for external platform integration (GitHub, Jira, Linear, etc.)
version: 1.0.0
metadata: {"profclaw": {"emoji": "🔌", "category": "integration", "priority": 80, "always": true}}
---

# MCP Server Discovery & Integration

profClaw can connect to MCP (Model Context Protocol) servers that provide access to external platforms like GitHub, Jira, Linear, and more. This skill teaches you how to discover and use these capabilities.

## What is MCP?

MCP (Model Context Protocol) is a standard for connecting AI assistants to external tools and data sources. When an MCP server is connected, its tools become available to you automatically.

## Discovering Available MCP Servers

Connected MCP servers appear in your available tools. Each MCP server provides:
- **Tools** - Actions you can perform (e.g., `github_create_issue`)
- **Resources** - Data you can read (e.g., repository files)

## Common MCP Servers

### GitHub MCP
When connected, provides tools like:
- `github_create_issue` - Create issues
- `github_list_issues` - List/search issues
- `github_create_pr` - Create pull requests
- `github_get_file` - Read repository files
- `github_search_code` - Search code

### Jira MCP
When connected, provides tools like:
- `jira_create_issue` - Create Jira issues
- `jira_search_issues` - Search with JQL
- `jira_update_issue` - Update issue fields
- `jira_transition_issue` - Change status

### Linear MCP
When connected, provides tools like:
- `linear_create_issue` - Create Linear issues
- `linear_list_issues` - List team issues
- `linear_update_issue` - Update issues

## Using MCP Tools

When you see MCP tools available:

1. **Check the tool description** to understand what it does
2. **Look at the parameters** to know what's required
3. **Call the tool** like any other tool

Example:
```
User: "Create a GitHub issue for the bug"

You: (seeing github_create_issue is available)
  1. github_create_issue(
       repo: "user/repo",
       title: "Bug: Login not working",
       body: "Description of the bug..."
     )
  2. Return: "Created GitHub issue #123"
```

## Syncing Between Platforms

You can orchestrate between profClaw and external platforms:

```
User: "Sync this profClaw ticket to GitHub"

You:
  1. get_ticket(ticketKey="PROFCLAW-42") → get ticket details
  2. github_create_issue(
       repo: "user/repo",
       title: ticket.title,
       body: ticket.description,
       labels: ticket.labels
     )
  3. update_ticket(ticketKey="PROFCLAW-42", linkedPRs: ["#123"])
  4. Return: "Created GitHub issue #123 and linked to PROFCLAW-42"
```

## Dynamic Learning

If you need to interact with a platform that's not currently connected:

1. **Ask the user** if they want to add the integration
2. **Guide them** to configure the MCP server in settings
3. **Once connected**, the tools will become available

Example:
```
User: "Create a Linear issue"

You: (Linear MCP not connected)
  "I don't have access to Linear yet. Would you like to:
   1. Configure the Linear MCP server in Settings > Integrations
   2. Create a profClaw ticket instead that can be synced later"
```

## Best Practices

1. **Check what's available** - Don't assume tools exist
2. **Use native profClaw first** for internal tracking
3. **Sync to external** platforms when the user wants visibility there
4. **Keep links updated** - Store external IDs in profClaw tickets
5. **Report what you did** - Always tell the user what was created where
