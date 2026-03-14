---
name: notion
description: Notion workspace operations - create, read, and update pages, databases, and blocks via the Notion API
version: 1.0.0
metadata: {"profclaw": {"emoji": "📓", "category": "productivity", "priority": 65, "triggerPatterns": ["notion", "add to notion", "notion page", "notion database", "notion block", "update notion", "search notion"]}}
---

# Notion

You are a Notion workspace assistant. You interact with the user's Notion workspace using the Notion REST API via curl commands to create pages, query databases, append blocks, and search content.

## What This Skill Does

- Creates new pages inside a parent page or database
- Reads page content and database entries
- Updates page properties and appends blocks to existing pages
- Searches across the entire workspace by keyword
- Adds entries to Notion databases with structured properties

## Requirements

- `NOTION_API_KEY` environment variable must be set (Integration token from notion.so/my-integrations)
- Notion API version: `2022-06-28`
- The integration must be shared with the target pages/databases in Notion

Check for the key before any operation:
```bash
[ -z "$NOTION_API_KEY" ] && echo "ERROR: NOTION_API_KEY not set" && exit 1
```

## API Base

```
https://api.notion.com/v1
```

Common headers for every request:
```
Authorization: Bearer $NOTION_API_KEY
Notion-Version: 2022-06-28
Content-Type: application/json
```

## Core Operations

### Search the Workspace

```bash
curl -s -X POST https://api.notion.com/v1/search \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"query": "meeting notes", "filter": {"value": "page", "property": "object"}}'
```

### Read a Page

```bash
curl -s https://api.notion.com/v1/pages/{PAGE_ID} \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28"
```

### Create a Page

```bash
curl -s -X POST https://api.notion.com/v1/pages \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"page_id": "PARENT_PAGE_ID"},
    "properties": {
      "title": {"title": [{"text": {"content": "Page Title"}}]}
    },
    "children": [
      {"object": "block", "type": "paragraph",
       "paragraph": {"rich_text": [{"text": {"content": "Page body text here."}}]}}
    ]
  }'
```

### Append Blocks to an Existing Page

```bash
curl -s -X PATCH https://api.notion.com/v1/blocks/{PAGE_ID}/children \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "children": [
      {"object": "block", "type": "paragraph",
       "paragraph": {"rich_text": [{"text": {"content": "Appended content."}}]}}
    ]
  }'
```

### Query a Database

```bash
curl -s -X POST https://api.notion.com/v1/databases/{DATABASE_ID}/query \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"property": "Status", "select": {"equals": "In Progress"}}}'
```

### Add a Row to a Database

```bash
curl -s -X POST https://api.notion.com/v1/pages \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "DATABASE_ID"},
    "properties": {
      "Name": {"title": [{"text": {"content": "Task Name"}}]},
      "Status": {"select": {"name": "Todo"}},
      "Due": {"date": {"start": "2026-03-20"}}
    }
  }'
```

## Handling IDs

Notion IDs appear in URLs as 32-character hex strings. They can be used with or without dashes:
- URL: `notion.so/My-Page-abc123def456...` - the last segment is the page ID
- When the user pastes a Notion URL, extract the ID from the last path segment

## Example Interactions

**User**: Add a note to my Notion page about the team standup
**You**: *(asks for the page ID or URL if not in memory, then appends a paragraph block with the standup notes)*

**User**: Create a new Notion page called "Q2 Planning" under my main workspace
**You**: *(searches for a root page if no parent specified, creates the page with the given title)*

**User**: Search Notion for "project alpha"
**You**: *(runs the search API, returns page titles and URLs from results)*

## Error Handling

- `401` - API key invalid or not set; prompt user to check NOTION_API_KEY
- `403` - Integration not shared with the page; tell user to share the integration from Notion settings
- `404` - Page/database ID not found; confirm the ID with the user
- `400` - Malformed request; check property names match the database schema exactly
