# Installation Guide

This guide covers multiple ways to install and run profClaw.

## Table of Contents

- [npm Install (Recommended)](#npm-install-recommended)
- [Docker Installation](#docker-installation)
- [One-Line Install](#one-line-install)
- [From Source (Development)](#from-source-development)
- [Production Deployment](#production-deployment)
- [Environment Configuration](#environment-configuration)
- [First-Time Setup](#first-time-setup)
- [Troubleshooting](#troubleshooting)

---

## npm Install (Recommended)

Runtime: **Node 22+**.

```bash
npm install -g profclaw@latest
# or: pnpm add -g profclaw@latest

profclaw setup
profclaw serve
```

The setup wizard walks you through AI provider configuration, admin account creation, and registration mode. Then `profclaw serve` starts the server at `http://localhost:3000`.

---

## One-Line Install

Auto-detects npm/pnpm or Docker and installs accordingly:

```bash
curl -fsSL https://raw.githubusercontent.com/profclaw/profclaw/main/install.sh | bash
```

---

## From Source (Development)

### Prerequisites

- **Node.js 22+** - [Download](https://nodejs.org/)
- **pnpm** - Package manager (auto-installed via corepack)
- **Redis** - For job queue (optional in development)

### Steps

```bash
git clone https://github.com/profclaw/profclaw.git
cd profclaw

corepack enable
pnpm install

cp .env.example .env
# Edit .env — add at least one AI provider key

pnpm dev
```

The server starts at `http://localhost:3000` with hot reload enabled.

---

## Docker Installation

### Using Docker Compose (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/profclaw/profclaw.git
cd profclaw

# 2. Create environment file
cp .env.example .env
# Edit .env with your API keys

# 3. Start all services
docker compose up -d

# 4. View logs
docker compose logs -f profclaw

# 5. Stop services
docker compose down
```

### Available Profiles

```bash
# Default: profClaw + Redis
docker compose up -d

# With local AI (Ollama)
docker compose --profile ai up -d

# With monitoring (Prometheus + Grafana)
docker compose --profile monitoring up -d

# With development tools (Redis Commander)
docker compose --profile tools up -d

# All profiles
docker compose --profile ai --profile monitoring --profile tools up -d
```

### Using Pre-built Image

```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/glincker/profclaw:latest

# Run (requires Redis)
docker run -d \
  --name profclaw \
  -p 3000:3000 \
  -e REDIS_URL=redis://your-redis-host:6379 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  --env-file .env \
  ghcr.io/glincker/profclaw:latest
```

---

## Production Deployment

### Requirements

- **Redis** - Required for job queue
- **Persistent storage** - For SQLite database
- **Reverse proxy** - Nginx or Cloudflare for HTTPS

### Docker Compose Production

1. **Update environment variables:**

```bash
# .env for production
NODE_ENV=production
PORT=3000
REDIS_URL=redis://redis:6379
CORS_ORIGIN=https://your-domain.com

# AI Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-xxx

# Storage
STORAGE_TIER=libsql
LIBSQL_URL=libsql://your-db.turso.io
LIBSQL_AUTH_TOKEN=xxx
```

2. **Deploy:**

```bash
docker compose -f docker-compose.yml up -d
```

### Health Checks

The application exposes a health endpoint:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

Docker Compose includes automatic health checks with restart on failure.

### Cloudflare Tunnel (Recommended)

For secure exposure without port forwarding:

```bash
# 1. Install cloudflared
brew install cloudflare/cloudflare/cloudflared  # macOS
# or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation

# 2. Authenticate
cloudflared tunnel login

# 3. Create a tunnel
cloudflared tunnel create profclaw

# 4. Configure tunnel (config.yml)
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: profclaw.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404

# 5. Run tunnel
cloudflared tunnel run profclaw

# 6. Create DNS record in Cloudflare dashboard
# Point profclaw.yourdomain.com to <TUNNEL_ID>.cfargotunnel.com
```

---

## Environment Configuration

### Required Variables

| Variable | Description |
|----------|-------------|
| At least one AI provider key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `GROQ_API_KEY` |

### Recommended Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `REDIS_URL` | — | Redis URL for job queue |
| `STORAGE_TIER` | `file` | Storage backend: `memory`, `file`, `libsql` |

### AI Providers

Configure at least one:

```bash
# Anthropic Claude (recommended for agentic tasks)
ANTHROPIC_API_KEY=sk-ant-xxx

# OpenAI (GPT-4o, o1, etc.)
OPENAI_API_KEY=sk-xxx

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=xxx

# Groq (fast inference)
GROQ_API_KEY=gsk_xxx

# Ollama (free local models)
OLLAMA_BASE_URL=http://localhost:11434
```

### Integrations

```bash
# GitHub
GITHUB_TOKEN=ghp_xxx
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_WEBHOOK_SECRET=xxx

# Jira
JIRA_CLIENT_ID=xxx
JIRA_CLIENT_SECRET=xxx

# Linear
LINEAR_API_KEY=lin_api_xxx

# Slack
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_SIGNING_SECRET=xxx

# Discord
DISCORD_BOT_TOKEN=xxx
DISCORD_APPLICATION_ID=xxx
DISCORD_PUBLIC_KEY=xxx

# Telegram
TELEGRAM_BOT_TOKEN=xxx

# WhatsApp
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
```

See [`.env.example`](../.env.example) for the complete list.

---

## First-Time Setup

After starting the server, create your admin account using the setup wizard:

### Option 1: Docker CLI (Recommended)

```bash
# Interactive setup wizard
docker exec -it profclaw profclaw setup

# Or non-interactive (CI/Docker automation)
docker exec profclaw profclaw setup \
  --non-interactive \
  --admin-email admin@profclaw.dev \
  --admin-password YourSecurePass123 \
  --admin-name "Admin" \
  --ai-provider skip \
  --registration-mode invite
```

The wizard configures:
- AI provider (Anthropic, OpenAI, Ollama, or skip)
- Admin account with recovery codes
- Registration mode (invite-only or open)
- GitHub OAuth (optional)

### Option 2: Local CLI

```bash
# If running via Node.js
pnpm profclaw setup

# Or individual commands:
pnpm profclaw auth create-admin --email admin@example.com --name "Admin"
pnpm profclaw auth set-mode invite
```

### Option 3: Web UI

Visit `http://localhost:3000/setup` and follow the on-screen wizard.

---

## Troubleshooting

### Redis Connection Issues

```bash
# Check Redis is running
redis-cli ping

# In Docker, ensure network connectivity
docker network inspect profclaw-network
```

### Database Errors

```bash
# File-based storage (development)
ls -la data/

# Reset database
rm -rf data/*.db
pnpm dev
```

### AI Provider Errors

Check that your API keys are valid:

```bash
# Test Anthropic
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-haiku-20240307","max_tokens":1,"messages":[{"role":"user","content":"Hi"}]}'
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Docker Build Issues

```bash
# Clean build
docker compose build --no-cache

# Check logs
docker compose logs profclaw
```

---

## Upgrading

### Docker

```bash
# Pull latest image
docker compose pull

# Restart with new image
docker compose up -d
```

### Manual Installation

```bash
git pull
pnpm install
pnpm build
pnpm start
```

---

## Getting Help

- [GitHub Issues](https://github.com/profclaw/profclaw/issues)
- [API Documentation](http://localhost:3000/api/docs) (Swagger UI)
- [Discord Community](#) (coming soon)
