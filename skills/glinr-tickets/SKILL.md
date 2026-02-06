---
name: glinr-tickets
description: Create, update, and manage tickets in GLINR task manager
version: 1.0.0
metadata: {"glinr": {"emoji": "🎫", "category": "project-management", "priority": 100, "tools": ["create_ticket", "update_ticket", "list_tickets", "get_ticket", "add_comment", "move_ticket", "assign_ticket"]}}
---

# GLINR Ticket Management

You can create, update, and manage tickets in GLINR. Tickets are like issues/tasks organized into projects.

## Workflow for Creating Tickets

**Always follow this workflow:**

1. First call `list_projects` to get available project keys
2. Then call `create_ticket` with a valid projectKey

```
User: "create a bug ticket for the login issue"

You:
  1. list_projects → returns [{key: "GLINR", ...}]
  2. create_ticket(projectKey="GLINR", title="Login issue", type="bug")
  3. Return: "Created [GLINR-42](/tickets/abc123)"
```

## Available Operations

| Operation | Tool | Required | Optional |
|-----------|------|----------|----------|
| Create ticket | `create_ticket` | projectKey, title | description, type, priority, labels |
| Update ticket | `update_ticket` | ticketKey | title, description, status, priority, type, labels |
| List tickets | `list_tickets` | - | projectKey, status, type, priority, search, limit |
| Get ticket | `get_ticket` | ticketKey | - |
| Add comment | `add_comment` | ticketKey, content | - |
| Move ticket | `move_ticket` | ticketKey, targetProjectKey | - |
| Assign ticket | `assign_ticket` | ticketKey | assignee, assigneeAgent, unassign |

## Ticket Types

- `task` - General work item (default)
- `bug` - Something broken
- `feature` - New functionality
- `story` - User story
- `epic` - Large feature container
- `subtask` - Child of another ticket
- `improvement` - Enhancement to existing feature

## Ticket Statuses

- `backlog` - Not yet planned
- `todo` - Planned for work
- `in_progress` - Being worked on
- `in_review` - Ready for review
- `done` - Completed
- `cancelled` - Won't do

## Priority Levels

- `critical` - Urgent, drop everything
- `high` - Important, do soon
- `medium` - Normal priority (default)
- `low` - Do when time permits
- `none` - No priority set

## Best Practices

1. **Always show clickable links** after creating/updating tickets:
   ```
   "Created ticket [GLINR-42](/tickets/abc123)"
   ```

2. **Use appropriate types** - bugs vs features vs tasks

3. **Set priority** based on user urgency words:
   - "urgent", "asap", "critical" → `critical`
   - "important", "soon" → `high`
   - Normal requests → `medium`

4. **Add descriptions** when the user provides context

5. **Use labels** for categorization (e.g., "frontend", "api", "docs")

## AI-Created Tickets

When you create tickets via chat, they are automatically flagged as:
- `createdBy: 'ai'`
- `aiAgent: 'glinr-chat'`

This helps track which tickets were AI-generated vs human-created.
