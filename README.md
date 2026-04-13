<p align="center">
  <img src="ui/public/brand/profclaw-appicon.svg" alt="profClaw" width="120" height="120">
</p>

<h1 align="center">profClaw</h1>

<p align="center">
  <b>Self-hosted AI agent engine for developers.</b><br>
  35 providers · 72 tools · 22 channels · runs on anything.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/profclaw"><img src="https://img.shields.io/npm/v/profclaw?style=for-the-badge&logo=npm&logoColor=white" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="https://github.com/profclaw/profclaw/pkgs/container/profclaw"><img src="https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"></a>
  <img src="https://img.shields.io/badge/providers-35-f43f5e?style=for-the-badge" alt="35 providers">
  <img src="https://img.shields.io/badge/tools-72-fb7185?style=for-the-badge" alt="72 tools">
  <img src="https://img.shields.io/badge/channels-22-e11d48?style=for-the-badge" alt="22 channels">
</p>

<p align="center">
  <a href="https://profclaw.ai/docs"><b>Docs</b></a> &middot;
  <a href="https://github.com/profclaw/profclaw/issues"><b>Report Bug</b></a> &middot;
  <a href="https://discord.gg/profclaw"><b>Discord</b></a>
</p>

---

<p align="center">
  <img src="docs-local/demos/hero-chat.gif" alt="profClaw chat with Gemma 4, local and free" width="700">
</p>

<p align="center"><i>Chat with Gemma 4 locally. Zero cost. Runs on your Mac.</i></p>

---

## Table of Contents

- [Why profClaw](#why-profclaw)
- [Features](#features)
- [Quick Start](#quick-start)
- [Interactive TUI](#interactive-tui)
- [Slash Commands](#slash-commands)
- [Headless Mode](#headless-mode)
- [Deployment Modes](#deployment-modes)
- [Where It Runs](#where-it-runs)
- [Configuration](#configuration)
- [AI Providers](#ai-providers)
- [Chat Channels](#chat-channels)
- [Integrations](#integrations)
- [Architecture](#architecture)
- [Development](#development)
- [License](#license)

---

## Why profClaw

Most AI coding tools are cloud-only (Cursor, Devin) or single-purpose CLIs (Aider, SWE-Agent). profClaw runs on your machine, talks to 35 providers (or none, Ollama works offline), and does more than chat.

- Local-first. Your data stays on your hardware.
- 35 AI providers, including Ollama for fully offline usage.
- Interactive TUI with streaming markdown, syntax highlighting, and a model switcher.
- Routes tasks to the right agent based on capability scoring.
- Real task queue with retry, backoff, and dead letter handling (BullMQ + Redis).
- 22 chat channels: Slack, Discord, Telegram, WhatsApp, Teams, and more.
- Per-token cost tracking with budget alerts.
- 72 built-in tools: file ops, git, browser automation, cron, web search, voice.
- Pico mode runs on a Raspberry Pi Zero 2W in ~140MB RAM.

## Features

| | |
|---|---|
| 35 AI providers | Anthropic, OpenAI, Google, Groq, Ollama, DeepSeek, Bedrock, and 28 more |
| 22 chat channels | Slack, Discord, Telegram, WhatsApp, iMessage, Matrix, Teams, and 15 more |
| 72 built-in tools | File ops, git, browser automation, cron, web search, canvas, voice |
| 50 skills | Coding agent, GitHub issues, Notion, Obsidian, image gen, and more |
| Interactive TUI | Streaming markdown, syntax highlighting, slash picker, model selector |
| MCP server | Model Context Protocol. Works with Claude Desktop, Cursor, any MCP client |
| Voice I/O | Whisper STT + TTS (ElevenLabs/OpenAI/system) + talk mode |
| Plugin SDK | Build and share plugins via npm or ClawHub |
| 3 deployment modes | Pico (~140MB), Mini (~145MB), Pro (full features) |

## Quick Start

```bash
npm install -g profclaw
profclaw init
profclaw chat --tui
```

```bash
# Verify
curl http://localhost:3000/health
```

`profclaw init` scans your project, detects your stack, and writes a `PROFCLAW.md` context file. It picks up any AI provider keys already in your environment.

`profclaw chat --tui` opens the terminal UI with streaming responses, code highlighting, slash commands, and a model selector.

### Full setup wizard

```bash
npx profclaw onboard
```

Walks you through provider setup, config, and server start. Takes about 5 minutes.

### Docker

```bash
docker run -d \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e PROFCLAW_MODE=mini \
  ghcr.io/profclaw/profclaw:latest
```

### Docker Compose

```bash
git clone https://github.com/profclaw/profclaw.git
cd profclaw
cp .env.example .env
docker compose up -d
```

Want free local AI? Add Ollama:

```bash
docker compose --profile ai up -d
```

### One-liner (macOS/Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/profclaw/profclaw/main/install.sh | bash
```

## Interactive TUI

<p align="center">
  <img src="docs-local/demos/tasks-demo.gif" alt="profClaw task management" width="700">
</p>

profClaw has a full terminal UI. No browser needed.

```bash
profclaw chat --tui
# or
profclaw tui
```

What you get:

- Streaming markdown rendered as the model responds
- Syntax-highlighted code blocks (100+ languages)
- Slash command picker: type `/` to browse skills
- Model selector: switch providers mid-conversation with `Ctrl+M`
- Tool execution panel showing every call, argument, and result
- Session history and full keyboard navigation

```
┌─ profClaw v2.x.x ─────────────────────────────────────────────┐
│  [Chat]                               [Tools]                  │
│                                                                 │
│  You: Review src/auth.ts for security issues                    │
│                                                                 │
│  Agent: I'll analyze auth.ts for security issues.     read_file │
│                                                       ───────── │
│  ## Security Analysis                                 auth.ts   │
│                                                                 │
│  **Critical**: JWT secret read from env without      analyze   │
│  fallback guard on line 42. If `JWT_SECRET` is       ──────── │
│  undefined the app will sign tokens with `undefined`. auth.ts  │
│  ...                                                            │
└─────────────────────────────── [claude-sonnet-4-6] [pro] ──────┘
```

## Slash Commands

Type `/` in any chat to run a skill. Skills are plain Markdown files, easy to create your own.

| Command | What it does |
|---|---|
| `/commit` | Write a conventional commit message for staged changes |
| `/review-pr 42` | Full code review of a pull request |
| `/deploy` | Run your deploy script with rollback awareness |
| `/summarize src/` | Summarize all files in a directory |
| `/web-research "topic"` | Research a topic across the web |
| `/analyze-code file.ts` | Security, performance, and style analysis |
| `/ticket PROJ-123` | Pull ticket context into the conversation |
| `/image "prompt"` | Generate an image via configured image provider |
| `/help` | List all available slash commands |
| `/exit` | Exit the current session |

See [Skills docs](https://profclaw.ai/docs/skills/overview) for all 50 built-in skills and how to create your own with a plain Markdown file.

## Headless Mode

<p align="center">
  <img src="docs-local/demos/tools-demo.gif" alt="profClaw agentic tool calling" width="700">
</p>

Run agents from scripts, CI pipelines, or other services:

```bash
# One-shot message
profclaw chat "Summarize the last 10 git commits"

# JSON output for scripting
profclaw chat "List open TODOs in src/" --output json

# Run a skill headlessly
profclaw skill run commit --message "feat: add auth"

# Agent task with file context
profclaw agent run "Review src/ for security issues" --files src/

# Verify your setup
profclaw doctor
```

REST API:

```bash
curl -X POST http://localhost:3000/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"message": "List open GitHub issues", "provider": "anthropic"}'
```

## Deployment Modes

Same binary, different scale. Set `PROFCLAW_MODE` and go:

| Mode | What you get | RAM | Best for |
|------|-------------|-----|----------|
| **pico** | Agent + tools + 1 chat channel + cron. No UI. | ~140MB | Raspberry Pi, $5 VPS, home server |
| **mini** | + Dashboard, integrations, 3 channels | ~145MB | Personal dev server, small VPS |
| **pro** | + All channels, Redis queues, plugins, browser tools | ~200MB | Teams, production |

Set via `PROFCLAW_MODE=pico|mini|pro` environment variable.

## Where It Runs

| Hardware | RAM | Recommended mode |
|----------|-----|-----------------|
| Raspberry Pi Zero 2W | 512MB | pico |
| Raspberry Pi 3/4/5 | 1-8GB | mini or pro |
| Orange Pi / Rock Pi | 1-4GB | mini or pro |
| $5/mo VPS (Hetzner, OVH) | 512MB-1GB | pico or mini |
| Old laptop / home PC | 4-16GB | pro |
| Docker (alongside other services) | 512MB+ | any mode |
| Old Android phone (Termux) | 1-2GB | pico |

profClaw requires Node.js 22+. For bare-metal embedded devices (ESP32, Arduino), see [MimiClaw](https://github.com/mimiclaw) (C) or [PicoClaw](https://github.com/picoclaw) (Go).

## Configuration

The setup wizard (`profclaw onboard`) handles everything interactively. Or set environment variables:

```bash
# AI Provider (pick one)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
OLLAMA_BASE_URL=http://localhost:11434

# Deployment
PROFCLAW_MODE=mini
PORT=3000

# Optional
REDIS_URL=redis://localhost:6379   # Required for pro mode
```

Run `profclaw doctor` to verify your configuration at any time.

See [`.env.example`](.env.example) for all 130+ options.

## AI Providers

35 providers with 90+ model aliases:

| Provider | Models | Local? |
|----------|--------|--------|
| Anthropic | Claude 4.x, 3.5 | No |
| OpenAI | GPT-4o, o1, o3 | No |
| Google | Gemini 2.x | No |
| Ollama | Llama, Mistral, Qwen, ... | Yes |
| AWS Bedrock | Claude, Titan, Llama | No |
| Groq | Fast inference | No |
| DeepSeek | V3, R1 | No |
| Azure OpenAI | GPT-4o | No |
| xAI | Grok | No |
| OpenRouter | Any model | No |
| Together | Open models | No |
| Fireworks | Open models | No |
| Mistral | Mistral Large, Codestral | No |
| LM Studio | Local models | Yes |
| ... and 21 more | HuggingFace, NVIDIA NIM, Cerebras, Replicate, Zhipu, Moonshot, Qwen, etc. | |

## Chat Channels

| Channel | Protocol |
|---------|----------|
| Slack | Bolt SDK |
| Discord | HTTP Interactions |
| Telegram | Bot API |
| WhatsApp | Cloud API |
| WebChat | SSE (browser-based) |
| Matrix | Client-Server API |
| Google Chat | Webhook + API |
| Microsoft Teams | Bot Framework |
| iMessage | BlueBubbles |
| Signal | signald bridge |
| IRC | TLS, RFC 1459 |
| LINE | Messaging API |
| Mattermost | REST API v4 |
| DingTalk | OpenAPI + webhook |
| WeCom | WeChat Work API |
| Feishu/Lark | Open Platform |
| QQ | Bot API |
| Nostr | Relay protocol |
| Twitch | Helix API + IRC |
| Zalo | OA API v3 |
| Nextcloud Talk | OCS API |
| Synology Chat | Webhook |

## Integrations

| Platform | Features |
|----------|----------|
| GitHub | Webhooks, OAuth, issue sync, PR automation |
| Jira | Webhooks, OAuth, issue sync, transitions |
| Linear | Webhooks, OAuth, issue sync |
| Cloudflare | Workers deployment, KV, D1 |
| Tailscale | Private network access |

## Architecture

```
src/
  adapters/       AI agent adapters (tool calling, streaming)
  chat/           Chat engine + execution pipeline
    providers/    Slack, Discord, Telegram, WhatsApp, WebChat, ...
    execution/    Tool executor, sandbox, agentic loop
  core/           Deployment modes, feature flags
  integrations/   GitHub, Jira, Linear webhooks
  queue/          BullMQ (pro) + in-memory (pico/mini) task queue
  providers/      35 AI SDK providers
  skills/         Skill loader and registry
  mcp/            MCP server (stdio + SSE)
  tui/            Interactive terminal UI (ink + blessed)
  types/          Shared TypeScript types

ui/src/           React 19 + Vite dashboard (mini/pro only)
skills/           Built-in skill definitions (Markdown)
```

Design decisions:
- Same binary scales from pico to pro. Features are gated at runtime.
- Adding an AI provider is one file implementing `ModelAdapter`.
- Skills are plain `.md` files. No code needed.
- BullMQ for production queues, in-memory fallback for pico/mini.

See [Architecture docs](https://profclaw.ai/docs/architecture/overview) for a deep dive.

## Development

```bash
git clone https://github.com/profclaw/profclaw.git
cd profclaw
pnpm install
cp .env.example .env
pnpm dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## Need help?

- [Quickstart guide](https://docs.profclaw.ai/guides/quickstart)
- [Full docs](https://docs.profclaw.ai)
- [Report a bug](https://github.com/profclaw/profclaw/issues/new?template=bug_report.md)
- [Discord](https://discord.gg/profclaw)

## License

[AGPL-3.0](LICENSE)
