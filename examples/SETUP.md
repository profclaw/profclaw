# GLINR Task Manager - Claude Code Integration Setup

This guide explains how to integrate GLINR Task Manager with Claude Code for zero-cost activity tracking.

## Integration Methods

GLINR supports two integration methods that work together:

### 1. Hooks (Zero Token Cost)

Hooks are shell commands that run automatically when Claude Code performs actions. They report activity to GLINR without using any tokens.

### 2. MCP Server (~50 tokens/call)

The MCP server provides tools that Claude Code can call explicitly when it wants to log tasks or get context. This uses a small amount of tokens but provides structured reporting.

## Quick Setup

### Prerequisites

1. GLINR Task Manager running on `http://localhost:3000`
2. Claude Code installed and configured

### Step 1: Configure Hooks

Add the following to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": {
      "command": "curl -s -X POST http://localhost:3000/api/hook/tool-use -H 'Content-Type: application/json' -d \"$CLAUDE_HOOK_PAYLOAD\""
    },
    "Stop": {
      "command": "curl -s -X POST http://localhost:3000/api/hook/session-end -H 'Content-Type: application/json' -d \"$CLAUDE_HOOK_PAYLOAD\""
    },
    "UserPromptSubmit": {
      "command": "curl -s -X POST http://localhost:3000/api/hook/prompt-submit -H 'Content-Type: application/json' -d \"$CLAUDE_HOOK_PAYLOAD\""
    }
  }
}
```

### Step 2: Configure MCP Server (Optional)

Add the MCP server to your Claude Code settings:

```json
{
  "mcpServers": {
    "glinr": {
      "command": "node",
      "args": ["/path/to/glinr-task-manager/dist/mcp/server.js"],
      "env": {
        "GLINR_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

Or if installed via npm:

```json
{
  "mcpServers": {
    "glinr": {
      "command": "npx",
      "args": ["@glincker/task-manager", "mcp"],
      "env": {
        "GLINR_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Hook Events

### PostToolUse

Triggered after every tool use (Edit, Write, Bash, etc.). GLINR uses this to:
- Track which files are being modified
- Infer task type from file paths
- Extract issue/PR links from content
- Detect git commits and branches

### Stop (Session End)

Triggered when a Claude Code session ends. GLINR uses this to:
- Aggregate all activity from the session
- Generate session summary
- Store final session data

### UserPromptSubmit

Triggered when the user submits a prompt. GLINR uses this to:
- Capture the initial task description
- Track conversation context
- Link prompts to sessions

## MCP Tools

When using the MCP server, Claude Code can call these tools:

### `glinr__log_task`

Log current work progress. Call this when starting or making progress on a task.

```
Arguments:
- title: Short title for the task
- summary: Brief description of work done
- filesChanged: Array of modified files
- taskId: Optional task ID for updates
```

### `glinr__complete_task`

Mark a task as complete with final summary.

```
Arguments:
- summary: Final summary of work done
- prUrl: Optional PR URL if created
- filesChanged: Final list of files
- taskId: Optional task ID
```

### `glinr__report_usage`

Report token usage for cost tracking.

```
Arguments:
- inputTokens: Number of input tokens
- outputTokens: Number of output tokens
- model: Model name (e.g., "claude-opus-4-5-20251101")
```

### `glinr__get_context`

Get context from past related tasks.

```
Arguments:
- query: Search query
- limit: Max results (default: 5)
```

## API Endpoints

### Hook Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hook/tool-use` | POST | Receive PostToolUse events |
| `/api/hook/session-end` | POST | Receive session end events |
| `/api/hook/prompt-submit` | POST | Receive prompt events |
| `/api/hook/sessions` | GET | List recent sessions |
| `/api/hook/sessions/:id/events` | GET | Get session events |
| `/api/hook/sessions/:id/summary` | GET | Get session summary |

## Troubleshooting

### Hooks not working

1. Check that GLINR is running: `curl http://localhost:3000/health`
2. Test hook manually:
   ```bash
   curl -X POST http://localhost:3000/api/hook/tool-use \
     -H 'Content-Type: application/json' \
     -d '{"event":"PostToolUse","tool":"Test","input":{}}'
   ```

### MCP server not connecting

1. Check server logs for errors
2. Verify the path to `server.js` is correct
3. Ensure GLINR_API_URL is set correctly

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GLINR_API_URL` | `http://localhost:3000` | GLINR server URL |

### GLINR Server Endpoints

The MCP server communicates with these GLINR endpoints:
- `POST /api/hook/tool-use` - Log tool usage
- `POST /api/hook/session-end` - Log session completion
- `GET /api/tasks` - Fetch past tasks for context

## Security Considerations

- Hooks run as shell commands with user privileges
- MCP server connects to GLINR via HTTP
- No authentication is required by default
- Consider network security for production use
