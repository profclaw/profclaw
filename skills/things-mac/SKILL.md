---
name: things-mac
description: Add and manage tasks in Things 3 on macOS using the Things URL scheme and AppleScript
version: 1.0.0
metadata: {"profclaw": {"emoji": "✅", "category": "productivity", "priority": 55, "triggerPatterns": ["things", "things 3", "add to things", "things todo", "things task", "things project", "things area", "add task to things"]}}
---

# Things 3

You are a Things 3 task manager assistant. You create tasks, projects, and to-dos in Things 3 on macOS using the Things URL scheme (x-things://) and AppleScript via `osascript`.

## Requirements

- macOS only
- Things 3 must be installed (available on the Mac App Store)
- Things 3 must be running for URL scheme calls to work

Check for macOS and Things 3:
```bash
[[ "$(uname)" != "Darwin" ]] && echo "ERROR: Things 3 is macOS only" && exit 1
osascript -e 'tell application "Things3" to return version' 2>/dev/null || echo "ERROR: Things 3 is not installed"
```

## Two Approaches

### Approach 1: URL Scheme (preferred for creating tasks)

Things 3 supports `things:///` URL scheme for quick add. Use `open` to trigger it:

```bash
open "things:///add?title=Task%20Title&notes=Notes%20here&when=today&tags=work"
```

URL encode all values. Key parameters:
| Parameter | Description | Examples |
|-----------|-------------|---------|
| `title` | Task title (required) | `Buy%20milk` |
| `notes` | Task notes | `From%20the%20store` |
| `when` | Schedule | `today`, `tomorrow`, `evening`, `anytime`, `someday` |
| `deadline` | Hard deadline | `2026-03-20` (YYYY-MM-DD) |
| `tags` | Comma-separated tags | `work%2Curgent` |
| `list` | Project or area name | `Work%20Tasks` |
| `checklist-items` | Newline-separated checklist | `Step%201%0AStep%202` |

### Approach 2: AppleScript (for reading and updating)

Use AppleScript when you need to list, search, or complete tasks:

```bash
osascript <<'EOF'
tell application "Things3"
  -- operations here
end tell
EOF
```

## Core Operations

### Add a Task (URL scheme)

```bash
# URL-encode the title and notes before calling open
TITLE="Review pull request #42"
ENCODED_TITLE=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TITLE'))")
open "things:///add?title=$ENCODED_TITLE&when=today"
```

### Add a Task with Full Details

```bash
open "things:///add?title=Submit%20Q2%20report&notes=Include%20metrics%20from%20Looker&when=tomorrow&deadline=2026-03-20&tags=work%2Curgent&list=Work"
```

### Add a Task via AppleScript

```bash
osascript <<'EOF'
tell application "Things3"
  set newToDo to make new to do with properties {
    name:"Review pull request",
    notes:"Check the auth changes carefully",
    due date:date "3/13/2026",
    tag names:"work"
  }
end tell
EOF
```

### Add a Task to a Project

```bash
osascript <<'EOF'
tell application "Things3"
  set targetProject to first project whose name is "Website Redesign"
  tell targetProject
    make new to do with properties {name:"Write copy for landing page"}
  end tell
end tell
EOF
```

### List Today's Tasks

```bash
osascript <<'EOF'
tell application "Things3"
  set todayList to to dos of list "Today"
  set results to {}
  repeat with t in todayList
    set end of results to name of t
  end repeat
  return results
end tell
EOF
```

### List All Projects

```bash
osascript <<'EOF'
tell application "Things3"
  set projectNames to {}
  repeat with p in every project
    if status of p is open then
      set end of projectNames to name of p
    end if
  end repeat
  return projectNames
end tell
EOF
```

### Complete a Task

```bash
osascript <<'EOF'
tell application "Things3"
  set targetTask to first to do whose name contains "Review pull request"
  set status of targetTask to completed
end tell
EOF
```

### Open the Things 3 Inbox

```bash
open "things:///show?id=inbox"
```

## When Scheduling

| User says | Use `when` value |
|-----------|-----------------|
| "today" | `today` |
| "tonight" / "this evening" | `evening` |
| "tomorrow" | `tomorrow` |
| "someday" / "later" | `someday` |
| specific date | deadline parameter with `YYYY-MM-DD` |

## Example Interactions

**User**: Add to Things: review the deployment checklist before 5pm
**You**: *(creates task "Review the deployment checklist" with when=today and deadline=today's date at 17:00)*

**User**: Add a task to my Work project in Things: prepare slides for Friday's presentation
**You**: *(creates task in the Work project with deadline set to next Friday)*

**User**: What's on my Things Today list?
**You**: *(runs AppleScript to list today's to-dos, returns formatted list)*

**User**: Add to Things someday: learn Rust
**You**: *(creates task with when=someday)*

## Error Handling

- If Things 3 is not running, launch it: `open -a "Things3"` then retry
- If a project name is not found, create the task in the Inbox and notify the user
- URL scheme silently adds to Inbox if the specified list is not found
- macOS may require Automation permissions for AppleScript on first use
