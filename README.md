<p align="center">
  <h1 align="center">profClaw</h1>
  <p align="center">Smart, lightweight AI agent engine. Run locally on anything from a $10 board to a VPS.</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/profclaw"><img src="https://img.shields.io/npm/v/profclaw?style=for-the-badge&logo=npm&logoColor=white" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="https://github.com/profclaw/profclaw/pkgs/container/profclaw"><img src="https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"></a>
</p>

<p align="center">
  <a href="https://profclaw.dev/docs"><b>Docs</b></a> &middot;
  <a href="https://github.com/profclaw/profclaw/issues"><b>Report Bug</b></a> &middot;
  <a href="https://discord.gg/profclaw"><b>Discord</b></a>
</p>

---

profClaw is a local-first AI agent that talks to your tools. Connect it to Slack, Discord, Telegram, or any of 22 supported chat channels. Point it at your GitHub, Jira, or Linear. Give it an AI provider (Anthropic, OpenAI, Ollama, or 30+ others). It handles the rest - executing tasks, managing workflows, and automating your dev life through natural language.

Runs on your machine. Your data stays local. No cloud required.

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
| **3 deployment modes** | Pico (~140MB), Mini (~180MB), Pro (full features) |

## Deployment Modes

profClaw scales from a Raspberry Pi to a full production server:

| Mode | What you get | RAM | Best for |
|------|-------------|-----|----------|
| **pico** | Agent + tools + chat. No UI. | ~140MB | IoT, home automation, $10 boards |
| **mini** | + Dashboard, basic cron, 1-2 channels | ~180MB | Personal dev server, VPS |
| **pro** | + All channels, Redis queues, plugins, sandbox | ~200MB | Teams, production |

Set via `PROFCLAW_MODE=pico|mini|pro` environment variable.

## Quick Start

### npm

```bash
npx profclaw onboard  # Zero-to-running wizard
# or
npm install -g profclaw@latest
profclaw setup        # Interactive config
profclaw serve        # Start the agent
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
cp .env.example .env    # Add your API key
docker compose up -d
```

**Free local AI?** Add Ollama:

```bash
docker compose --profile ai up -d
```

### One-liner (macOS/Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/profclaw/profclaw/main/install.sh | bash
```

## Configuration

The setup wizard (`profclaw setup`) handles everything interactively. Or set environment variables:

```bash
# AI Provider (pick one)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
OLLAMA_BASE_URL=http://localhost:11434

# Deployment
PROFCLAW_MODE=mini          # pico | mini | pro
PORT=3000                   # HTTP server port

# Optional
REDIS_URL=redis://localhost:6379   # Required for pro mode
```

See [`.env.example`](.env.example) for all options.

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
| Zhipu AI | GLM-4, GLM-5 | No |
| Moonshot | Kimi | No |
| Qwen API | Qwen 2.5 | No |
| Together | Open models | No |
| Fireworks | Open models | No |
| Mistral | Mistral Large, Codestral | No |
| OpenRouter | Any model | No |
| Replicate | Open models | No |
| ... and 18 more | HuggingFace, NVIDIA NIM, Watsonx, Volcengine, etc. | |

## Integrations

| Platform | Features |
|----------|----------|
| **GitHub** | Webhooks, OAuth, issue sync, PR automation |
| **Jira** | Webhooks, OAuth, issue sync, transitions |
| **Linear** | Webhooks, OAuth, issue sync |
| **Slack** | Slash commands, DM pairing, thread replies |
| **Discord** | Bot commands, channel routing |
| **Telegram** | Bot API, inline commands |
| **WhatsApp** | Cloud API or Baileys |
| **WebChat** | Browser-based SSE chat, embeddable widget |
| **Matrix** | Room-based, Client-Server API |
| **Google Chat** | Webhook + service account, Cards v2 |
| **MS Teams** | Bot Framework, Adaptive Cards |

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

## Docs & Website

Documentation and marketing site live in a separate repo: [`profclaw-site`](https://github.com/profclaw/profclaw-site)

## License

[AGPL-3.0](LICENSE) -- profclaw contributors, 2024-2026
