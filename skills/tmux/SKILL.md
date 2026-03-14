---
name: tmux
description: Create, manage, and interact with tmux sessions, windows, and panes. Useful for persistent terminals and running multiple processes.
version: 1.0.0
metadata: {"profclaw": {"emoji": "🖥️", "category": "system", "priority": 55, "triggerPatterns": ["tmux", "terminal session", "tmux session", "split terminal", "new pane", "attach session", "detach"]}}
---

# tmux

You are a tmux session management assistant. When users need persistent terminal sessions, split panes, or want to run long processes that survive disconnection, you create and manage tmux sessions with the right commands.

## What This Skill Does

- Creates and attaches to named tmux sessions
- Manages windows and split panes within sessions
- Runs commands inside specific panes/windows
- Lists and kills sessions
- Captures pane output for inspection

## Checking tmux is Available

```bash
which tmux && tmux -V
# Install: brew install tmux (macOS) or apt install tmux (Linux)
```

## Sessions

```bash
# List all sessions
tmux ls

# Create a new named session
tmux new-session -d -s profclaw

# Create session and run a command in it
tmux new-session -d -s dev -x 220 -y 50

# Attach to an existing session
tmux attach-session -t profclaw

# Detach from current session (inside tmux)
# Press: Ctrl+b then d

# Kill a session
tmux kill-session -t profclaw

# Kill all sessions
tmux kill-server
```

## Running Commands in Sessions

```bash
# Send a command to a session (non-interactive)
tmux send-keys -t profclaw "pnpm dev" Enter

# Send to a specific window (window 0)
tmux send-keys -t profclaw:0 "pnpm dev" Enter

# Send to a specific pane (window 0, pane 1)
tmux send-keys -t profclaw:0.1 "redis-cli monitor" Enter
```

## Windows

```bash
# Create a new window in a session
tmux new-window -t profclaw -n "logs"

# List windows
tmux list-windows -t profclaw

# Select/switch to window by name
tmux select-window -t profclaw:logs

# Rename the current window
tmux rename-window -t profclaw:0 "server"

# Kill a window
tmux kill-window -t profclaw:logs
```

## Panes (Split Views)

```bash
# Split horizontally (new pane below)
tmux split-window -v -t profclaw

# Split vertically (new pane to the right)
tmux split-window -h -t profclaw

# Split and run a command immediately
tmux split-window -v -t profclaw "tail -f /var/log/app.log"

# Select a specific pane
tmux select-pane -t profclaw:0.0  # top/left pane
tmux select-pane -t profclaw:0.1  # bottom/right pane
```

## Capturing Pane Output

```bash
# Capture current visible content of a pane
tmux capture-pane -t profclaw:0.0 -p

# Capture scrollback buffer (last 1000 lines)
tmux capture-pane -t profclaw:0.0 -p -S -1000

# Save pane output to file
tmux capture-pane -t profclaw:0.0 -p > /tmp/pane_output.txt
```

## Common Workflow - Dev Setup

```bash
# Create a development session with 3 panes
tmux new-session -d -s dev -x 220 -y 50

# Window 0: server
tmux send-keys -t dev:0 "pnpm dev" Enter
tmux rename-window -t dev:0 "server"

# Window 1: logs
tmux new-window -t dev -n "logs"
tmux send-keys -t dev:logs "tail -f /tmp/profclaw.log" Enter

# Window 2: shell (free for commands)
tmux new-window -t dev -n "shell"

echo "Session 'dev' ready. Attach with: tmux attach -t dev"
```

## Check Session Exists Before Creating

```bash
if tmux has-session -t profclaw 2>/dev/null; then
  echo "Session 'profclaw' already exists"
  tmux attach-session -t profclaw
else
  tmux new-session -d -s profclaw
  echo "Created new session 'profclaw'"
fi
```

## Example Interactions

**User**: Start a tmux session for this project
**You**: *(checks if session exists, creates named session, runs dev command, reports attach command)*

**User**: What's running in my tmux sessions?
**You**: *(runs `tmux ls` and `tmux capture-pane` per session, summarizes active processes)*

**User**: Open a split pane for watching logs
**You**: *(splits the current window vertically, starts tail in the new pane)*

## Safety Rules

- **Check** if a session already exists before creating (`tmux has-session`)
- **Confirm** before `tmux kill-server` - it kills all sessions
- **Never** `kill-session` without confirming which session to target
- **Warn** when sending commands to non-interactive sessions (no confirmation prompt)

## Best Practices

1. Use descriptive session names (project name, not "session1")
2. Always create sessions detached (`-d`) so they run in background
3. Use `has-session` guard to prevent duplicate sessions
4. Size sessions explicitly (`-x 220 -y 50`) for consistent layouts
5. Capture pane output before killing sessions if output matters
