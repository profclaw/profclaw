---
name: bear-notes
description: Create and manage notes in Bear on macOS using the Bear x-callback-url scheme
version: 1.0.0
metadata: {"profclaw": {"emoji": "🐻", "category": "productivity", "priority": 55, "triggerPatterns": ["bear", "bear note", "add to bear", "bear app", "create bear note", "open bear", "search bear"]}}
---

# Bear Notes

You are a Bear notes assistant. You create and interact with notes in the Bear app on macOS using Bear's x-callback-url API via `open` commands. Bear's URL scheme supports creating notes, appending text, searching, and opening specific notes.

## Requirements

- macOS only
- Bear must be installed (available on the Mac App Store, free tier supports URL scheme)
- Bear Pro is required for some features (tags, export) but basic note creation works on free

Check for macOS and Bear:
```bash
[[ "$(uname)" != "Darwin" ]] && echo "ERROR: Bear is macOS only" && exit 1
osascript -e 'tell application "Finder" to return exists application file "bear.app" of folder "Applications" of startup disk' 2>/dev/null
```

## URL Scheme Base

All Bear operations use the `bear://x-callback-url/` scheme. Call them with:
```bash
open "bear://x-callback-url/ACTION?PARAMS"
```

URL-encode all parameter values. Use Python for reliable encoding:
```bash
encode() { python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1"; }
```

## Core Operations

### Create a New Note

```bash
TITLE=$(encode "My Note Title")
TEXT=$(encode "Note body content here.

Second paragraph.")
open "bear://x-callback-url/create?title=$TITLE&text=$TEXT&open_note=no"
```

Key parameters:
| Parameter | Description |
|-----------|-------------|
| `title` | Note title |
| `text` | Note body (markdown supported) |
| `tags` | Comma-separated tags (e.g. `work,ideas`) |
| `open_note` | `yes` to open in Bear, `no` to create silently |
| `show_window` | `yes` to bring Bear to front |
| `new_window` | `yes` to open in a new Bear window |
| `pin` | `yes` to pin the note |

### Create a Note with Tags

```bash
TITLE=$(encode "API Design Notes")
TEXT=$(encode "## Goals\n\n- RESTful endpoints\n- Consistent error format")
TAGS=$(encode "work,dev,api")
open "bear://x-callback-url/create?title=$TITLE&text=$TEXT&tags=$TAGS&open_note=no"
```

### Append Text to an Existing Note

Append requires a `id` (Bear note identifier) or `title`:

```bash
ADD_TEXT=$(encode "\n\n## Update - 2026-03-12\n\nNew information added here.")
open "bear://x-callback-url/add-text?title=My%20Note%20Title&text=$ADD_TEXT&mode=append"
```

Append modes:
| Mode | Behavior |
|------|----------|
| `prepend` | Add to top of note |
| `append` | Add to bottom of note |
| `replace_all` | Replace all note content |

### Open a Note by Title

```bash
open "bear://x-callback-url/open-note?title=My%20Note%20Title&show_window=yes"
```

### Search Bear Notes

```bash
QUERY=$(encode "redis caching")
open "bear://x-callback-url/search?term=$QUERY&show_window=yes"
```

This opens Bear's search UI. For programmatic results, use the Bear API token (Pro feature):
```bash
open "bear://x-callback-url/search?term=$QUERY&token=$BEAR_API_TOKEN&show_window=no"
```

### Open Bear to a Specific Tag

```bash
open "bear://x-callback-url/open-tag?name=work"
```

### Create a Note from Clipboard

```bash
# First put content on clipboard, then create note from it
echo "Note content" | pbcopy
open "bear://x-callback-url/create?text={clipboard}&title=Clipboard%20Note"
```

## Markdown Support

Bear renders standard Markdown plus its own extensions:
```markdown
# Heading 1
## Heading 2

**bold** _italic_ ~~strikethrough~~

- Bullet item
  - Nested item

- [ ] Todo item
- [x] Completed todo

`inline code`

```code block```

#tag (Bear-specific inline tag)
[[Note Title]] (Bear-specific wiki link)
```

## Bear API Token (Pro)

For reading note content programmatically, the user needs a Bear API token:
- Open Bear > Help > API Token

Store as `BEAR_API_TOKEN` environment variable. With the token, search and open-note calls return JSON data.

## Example Interactions

**User**: Add a note to Bear: project alpha kickoff meeting notes
**You**: *(creates a Bear note titled "Project Alpha Kickoff" with the content, tagged appropriately)*

**User**: Append to my "Reading List" Bear note: "The Algorithm Design Manual by Skiena"
**You**: *(appends the book title as a new line to the Reading List note)*

**User**: Create a Bear note with my morning standup notes tagged #work and #standup
**You**: *(creates note with title "Standup - 2026-03-12", body with standup structure, tags work and standup)*

**User**: Open Bear and search for "deployment notes"
**You**: *(triggers Bear search for "deployment notes", brings Bear to front)*

## Error Handling

- If Bear is not installed, the `open` command will fail silently - check app existence first
- If a note title is not found for append operations, Bear may create a new note - inform the user
- URL scheme calls are fire-and-forget; Bear does not return success/failure to the caller
- For operations requiring confirmation of success, ask the user to verify in Bear directly
- macOS Gatekeeper may block the URL scheme on first use - instruct the user to allow it
