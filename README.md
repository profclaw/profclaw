<p align="center">
  <h1 align="center">GLINR Task Manager</h1>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/glinr-task-manager"><img src="https://img.shields.io/npm/v/glinr-task-manager?style=for-the-badge&logo=npm&logoColor=white" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 22+">
  <a href="https://github.com/GLINCKER/glinr-task-manager/pkgs/container/glinr-task-manager"><img src="https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"></a>
</p>

GLINR is an AI-native task orchestration platform. Manage projects, tickets, and workflows through natural language conversations. It connects with your existing tools — GitHub, Jira, Linear, Slack, Discord, and more — while AI handles the execution.

**[📖 Documentation](https://glinr.dev/docs)** · **[🐛 Report Bug](https://github.com/GLINCKER/glinr-task-manager/issues)** · **[💬 Discord](https://discord.gg/glinr)**

---

## Install

Runtime: **Node 22+**.

```bash
npm install -g glinr-task-manager@latest
# or: pnpm add -g glinr-task-manager@latest

glinr setup
```

The setup wizard configures your AI provider, creates an admin account, and starts you off.

## Quick Start

```bash
# Start the server
glinr serve

# Open the dashboard
open http://localhost:3000
```

### Docker (alternative)

```bash
# 1. Start everything (app + Redis)
docker compose up -d

# 2. Run the setup wizard
docker exec -it glinr-task-manager glinr setup
```

**Want free local AI?** Add `--profile ai` to include Ollama:

```bash
docker compose --profile ai up -d
```

### One-line install (macOS/Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/GLINCKER/glinr-task-manager/main/install.sh | bash
```

For manual installation, see [Installation Guide](docs/INSTALLATION.md).

## Configuration

The setup wizard (`glinr setup`) configures everything interactively. You can also set environment variables in `.env`:

```bash
# Claude (recommended)
ANTHROPIC_API_KEY=sk-ant-xxx

# Or OpenAI
OPENAI_API_KEY=sk-xxx

# Or use free local models via Ollama (included with --profile ai)
OLLAMA_BASE_URL=http://localhost:11434
```

See [`.env.example`](.env.example) for all available options.

## Integrations

GLINR connects with popular tools out of the box:

- **Issue Tracking**: GitHub, Jira, Linear
- **Messaging**: Slack, Discord, Telegram, WhatsApp
- **AI Providers**: Anthropic, OpenAI, Google, Groq, Ollama

Configuration guides: [Messaging Channels](docs/MESSAGING_CHANNELS.md)

## Reporting Bugs

Use GitHub Issues to report problems: [Open an Issue](https://github.com/GLINCKER/glinr-task-manager/issues)

## Contributing

Contributions welcome! Please ensure `pnpm build && pnpm test` passes before submitting PRs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[AGPL-3.0](LICENSE) — © 2024-2026 GLINCKER
