---
name: profclaw-projects
description: Create and manage projects in profClaw for organizing tickets
version: 1.0.0
metadata: {"profclaw": {"emoji": "📁", "category": "project-management", "priority": 90, "tools": ["create_project", "list_projects"]}}
---

# profClaw Project Management

Projects are containers for organizing tickets. Each project has a unique key prefix (e.g., "PROFCLAW", "MOBILE") used in ticket IDs like PROFCLAW-123.

## Available Operations

| Operation | Tool | Required | Optional |
|-----------|------|----------|----------|
| List projects | `list_projects` | - | status (active/archived/all) |
| Create project | `create_project` | name, key | description, icon, color |

## Creating Projects

When creating a new project:

```
create_project(
  name: "Mobile App",
  key: "MOBILE",      // 2-10 chars, becomes ticket prefix
  description: "React Native mobile application",
  icon: "📱",         // Optional emoji
  color: "#6366f1"    // Optional hex color
)
```

The `key` becomes the ticket prefix: MOBILE-1, MOBILE-2, etc.

## Project Keys

- Must be 2-10 characters
- Automatically uppercased
- Must be unique across workspace
- Used as prefix for all tickets in that project

## Project Status

- `active` - Normal, visible project (default)
- `archived` - Hidden from default views

## Workflow

**Before creating tickets**, always:
1. Call `list_projects` to see existing projects
2. Use an existing project if appropriate
3. Only create a new project if needed

```
User: "I want to track mobile app tasks"

You:
  1. list_projects → check if mobile project exists
  2. If not: create_project(name="Mobile App", key="MOBILE", icon="📱")
  3. Return: "Created project Mobile App (MOBILE)"
```

## Best Practices

1. **Use descriptive keys** - MOBILE, API, DOCS, FRONTEND
2. **Set icons** for visual distinction
3. **Add descriptions** to explain project scope
4. **Don't create duplicates** - check existing projects first
