# Screenshots Needed

This directory contains images used in the docs site. The following screenshots are still needed.

---

## og-cover.png

**Used for**: OpenGraph and Twitter card previews when the docs URL is shared.

**Dimensions**: 1200x630px

**Description**: Dark background (`#050810`). profClaw logo and wordmark centered top-left. Large headline text: "AI Agent Engine for Developers". Subtext: "35 providers · 72 tools · 22 channels · self-hosted". Three small feature badges bottom-right. Brand accent color `#f43f5e`.

---

## tui-dashboard.png

**Used for**: README, landing page, TUI feature section.

**Dimensions**: 1280x720px (terminal screenshot)

**Description**: Full profClaw TUI session. Split-pane layout: left pane shows a conversation with streaming markdown response (code block syntax-highlighted in a language like TypeScript). Right pane shows the tool execution panel with two or three tool calls listed (`read_file`, `analyze_code`). Bottom bar shows `[claude-sonnet-4-6]` and `[pro mode]`. Terminal theme: dark (Dracula or similar).

---

## tui-chat-streaming.png

**Used for**: First Run docs, feature highlights.

**Dimensions**: 1280x720px (terminal screenshot)

**Description**: Close-up of the chat pane mid-stream. The agent is responding with a security analysis — markdown heading, bullet points, and an inline code snippet being rendered in real time. The cursor/caret is visible at the end of the last streamed line, indicating live output.

---

## tui-slash-picker.png

**Used for**: Skills docs, TUI feature section.

**Dimensions**: 1280x500px (terminal screenshot)

**Description**: The slash command picker overlay triggered by typing `/` in the TUI input. A fuzzy-searchable list of skill names and one-line descriptions is shown: `/commit`, `/review-pr`, `/deploy`, `/summarize`, `/web-research`, `/analyze-code`. The current filter query is visible in the input. Selection highlight on `/commit`.

---

## tui-model-selector.png

**Used for**: AI Providers docs, TUI feature section.

**Dimensions**: 1280x500px (terminal screenshot)

**Description**: The model selector overlay triggered by `Ctrl+M`. A list of configured providers and model names: `anthropic / claude-sonnet-4-6`, `anthropic / claude-haiku-4-5`, `openai / gpt-4o`, `ollama / llama3.2`, `groq / llama-3.1-70b`. The current active model is highlighted. Bottom hint text: "Press Enter to switch, Esc to cancel".

---

## doctor-output.png

**Used for**: First Run docs, Installation docs.

**Dimensions**: 900x400px (terminal screenshot)

**Description**: Output of `profclaw doctor`. Shows a checklist of health items: Node.js version (pass), API key present (pass), API reachable with latency (pass), Redis (warning: not set with remediation hint), port available (pass), config file path (pass). Summary line: "1 warning, 0 errors". Clean terminal, light or dark theme acceptable.

---

## hero-dark.png / hero-light.png

These files exist and are used as hero images in the docs. Update them when the product has a stable v2 visual identity.

**Current files**: `hero-dark.png`, `hero-light.png`

---

## checks-passed.png

Existing file. Used in security or CI docs. Keep as-is.
