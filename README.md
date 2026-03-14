<p align="center">
  <img src="ui/public/brand/profclaw-appicon.svg" alt="profClaw" width="120" height="120">
</p>

<h1 align="center">profClaw</h1>

<p align="center">
  <b>Smart, lightweight AI agent engine.</b><br>
  Run locally on anything from a Raspberry Pi to a production VPS.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/profclaw"><img src="https://img.shields.io/npm/v/profclaw?style=for-the-badge&logo=npm&logoColor=white" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="https://github.com/profclaw/profclaw/pkgs/container/profclaw"><img src="https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"></a>
</p>

<p align="center">
  <a href="https://profclaw.ai/docs"><b>Docs</b></a> &middot;
  <a href="https://github.com/profclaw/profclaw/issues"><b>Report Bug</b></a> &middot;
  <a href="https://discord.gg/profclaw"><b>Discord</b></a>
</p>

---

## Table of Contents

- [Why profClaw](#why-profclaw)
- [Features](#features)
- [Installation](#installation)
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

Most AI coding tools are either cloud-only (Cursor, Devin) or single-purpose CLIs (Aider, SWE-Agent). profClaw is different:

- **Local-first** - runs on your machine, your data stays local
- **Multi-agent orchestration** - routes tasks to the right agent (Claude, GPT, Ollama) based on capability scoring, not just round-robin
- **Real task queue** - BullMQ with dead letter queue, retry with backoff, priority scheduling
- **Built-in project management** - tickets, Kanban, sprints, burndown charts, bi-directional sync with GitHub/Jira/Linear
- **22 chat channels** - talk to your AI through Slack, Discord, Telegram, WhatsApp, Teams, or 17 others
- **Cost tracking** - per-token budget management with alerts at 50/80/100%
- **72 built-in tools** - file ops, git, browser automation, cron, web search, canvas, voice
- **Mode-aware** - scales from a Raspberry Pi (pico) to a full team server (pro)

No other open-source tool combines task orchestration, project management, and cost tracking in one self-hosted package.

## Features

| | |
|---|---|
| **35 AI providers** | Anthropic, OpenAI, Google, Groq, Ollama, DeepSeek, Bedrock, and more |
| **22 chat channels** | Slack, Discord, Telegram, WhatsApp, iMessage, Matrix, Teams, and 15 more |
| **72 built-in tools** | File ops, git, browser automation, cron, web search, canvas, voice |
| **50 skills** | Coding agent, GitHub issues, Notion, Obsidian, image gen, and more |
| **MCP server** | Native Model Context Protocol - connect to any MCP-compatible client |
| **Voice I/O** | STT (Whisper) + TTS (ElevenLabs/OpenAI/system) + Talk Mode |
| **Plugin SDK** | Build and share third-party plugins via npm or ClawHub |
| **3 deployment modes** | Pico (~140MB), Mini (~145MB), Pro (full features) |

## Installation

### npm (recommended)

```bash
npx profclaw onboard
```

This runs the zero-to-running wizard: picks your AI provider, sets up config, and starts the server.

Or install globally:

```bash
npm install -g profclaw@latest
profclaw setup
profclaw serve
```

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

## Deployment Modes

profClaw scales from a Raspberry Pi to a full production server:

| Mode | What you get | RAM | Best for |
|------|-------------|-----|----------|
| **pico** | Agent + tools + 1 chat channel + cron. No UI. | ~140MB | Raspberry Pi, $5 VPS, home server |
| **mini** | + Dashboard, integrations, 3 channels | ~145MB | Personal dev server, small VPS |
| **pro** | + All channels, Redis queues, plugins, browser tools | ~120-200MB | Teams, production |

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

The setup wizard (`profclaw setup`) handles everything interactively. Or set environment variables:

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

See [`.env.example`](.env.example) for all options.

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
| ... and 22 more | HuggingFace, NVIDIA NIM, Cerebras, Replicate, Zhipu, Moonshot, Qwen, etc. | |

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
| **GitHub** | Webhooks, OAuth, issue sync, PR automation |
| **Jira** | Webhooks, OAuth, issue sync, transitions |
| **Linear** | Webhooks, OAuth, issue sync |

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
  types/          Shared TypeScript types

ui/src/           React 19 + Vite dashboard (mini/pro only)
skills/           Built-in skill definitions
```

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

## License

[AGPL-3.0](LICENSE)
