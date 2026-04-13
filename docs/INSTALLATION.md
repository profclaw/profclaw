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
- [FAQ](#faq)

---

## npm Install (Recommended)

Requires Node 22+.

1. Install the package globally:

```bash
npm install -g profclaw@latest
# or: pnpm add -g profclaw@latest
```

2. Run the setup wizard (configures AI provider, admin account, and registration mode):

```bash
profclaw setup
```

3. Start the server:

```bash
profclaw serve
```

The server starts at `http://localhost:3000`.

**Verify it works:**

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

---

## One-Line Install

Auto-detects npm/pnpm or Docker and installs accordingly:

1. Run the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/profclaw/profclaw/main/install.sh | bash
```

2. Follow the prompts, then start the server as directed by the script output.

3. Verify the server is up:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

---

## From Source (Development)

### Prerequisites

- Node.js 22+ — [Download](https://nodejs.org/)
- pnpm — installed via corepack
- Redis — for the job queue (optional in development)

### Steps

1. Clone and install dependencies:

```bash
git clone https://github.com/profclaw/profclaw.git
cd profclaw

corepack enable
pnpm install
```

2. Configure your environment:

```bash
cp .env.example .env
# Edit .env — add at least one AI provider key
```

3. Start the dev server:

```bash
pnpm dev
```

The server starts at `http://localhost:3000` with hot reload enabled.

**Verify it works:**

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

---

## Docker Installation

### Using Docker Compose (Recommended)

1. Clone the repository:

```bash
git clone https://github.com/profclaw/profclaw.git
cd profclaw
```

2. Create and configure your environment file:

```bash
cp .env.example .env
# Edit .env with your API keys
```

3. Start all services:

```bash
docker compose up -d
```

4. Verify the server is up:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

Other useful commands:

```bash
# View logs
docker compose logs -f profclaw

# Stop services
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

1. Pull the image:

```bash
docker pull ghcr.io/profclaw/profclaw:latest
```

2. Run the container (requires Redis):

```bash
docker run -d \
  --name profclaw \
  -p 3000:3000 \
  -e REDIS_URL=redis://your-redis-host:6379 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  --env-file .env \
  ghcr.io/profclaw/profclaw:latest
```

3. Verify it works:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

---

## Production Deployment

### Requirements

- Redis — required for the job queue
- Persistent storage — for the SQLite database
- Reverse proxy — Nginx or Cloudflare for HTTPS

### Docker Compose Production

1. Set environment variables in `.env`:

```bash
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

2. Deploy:

```bash
docker compose -f docker-compose.yml up -d
```

3. Verify the deployment:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

Docker Compose includes automatic health checks with restart on failure.

### Cloudflare Tunnel

For secure exposure without port forwarding:

1. Install cloudflared:

```bash
brew install cloudflare/cloudflare/cloudflared  # macOS
# or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation
```

2. Authenticate and create a tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create profclaw
```

3. Create a config file (`~/.cloudflared/config.yml`):

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: profclaw.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

4. Start the tunnel:

```bash
cloudflared tunnel run profclaw
```

5. In the Cloudflare dashboard, create a DNS CNAME record pointing `profclaw.yourdomain.com` to `<TUNNEL_ID>.cfargotunnel.com`.

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
# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-xxx

# OpenAI
OPENAI_API_KEY=sk-xxx

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=xxx

# Groq (fast inference)
GROQ_API_KEY=gsk_xxx

# Ollama (local models, no API key needed)
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

After starting the server, create your admin account using the setup wizard.

### Option 1: Docker CLI (Recommended)

```bash
# Interactive setup wizard
docker exec -it profclaw profclaw setup

# Or non-interactive (CI/automation)
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

## Low-Memory Devices (Raspberry Pi Zero, 512MB VPS)

On devices with 512MB RAM or less, `npm install -g profclaw` will get killed by the OOM killer before it finishes. Three options:

### Option 1: Docker pico image (recommended)

The pico image is pre-built and skips npm install entirely. It runs the agent engine, tools, and one chat channel in roughly 140MB RAM with no UI and no Redis.

1. Pull and run the pico image:

```bash
docker run -d \
  --name profclaw \
  -p 3000:3000 \
  -e PROFCLAW_MODE=pico \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -v profclaw-data:/app/data \
  ghcr.io/profclaw/profclaw:pico
```

2. Or build locally from `Dockerfile.pico`:

```bash
docker build -f Dockerfile.pico -t profclaw:pico .
docker run -d --name profclaw -p 3000:3000 -e PROFCLAW_MODE=pico profclaw:pico
```

3. Verify it works:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

### Option 2: Add swap before npm install

1. Extend swap to 1GB so npm has enough memory:

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

2. Install and start in pico mode:

```bash
npm install -g profclaw@latest

# Start in pico mode
PROFCLAW_MODE=pico profclaw serve
```

3. Verify it works:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

### Option 3: Cross-install from another machine

1. Install on a machine with more RAM:

```bash
npm install -g profclaw@latest
INSTALL_PATH=$(npm root -g)/profclaw
```

2. Copy to the target device and run:

```bash
scp -r $INSTALL_PATH pi@raspberry.local:~/profclaw
ssh pi@raspberry.local "cd ~/profclaw && PROFCLAW_MODE=pico node dist/server.js"
```

### Hardware requirements by mode

| Mode | Min RAM | Swap needed? | What you get |
|------|---------|-------------|-------------|
| pico | 256MB | Yes (512MB+) | Agent + tools + 1 channel, no UI |
| mini | 512MB | Recommended | Dashboard, integrations, 3 channels |
| pro | 1GB+ | No | Everything including Redis, browser tools |

---

## Troubleshooting

### Redis Connection Issues

```bash
# Check Redis is running
redis-cli ping

# In Docker, check network connectivity
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
# Find which process is using port 3000
lsof -i :3000 | grep LISTEN

# Kill it by PID
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

## FAQ

**npm install gets killed on low-memory devices**

The OOM killer terminates `npm install` when RAM runs out. Two fixes: add 1GB of swap before installing (see [Option 2 in the low-memory guide](#option-2-add-swap-before-npm-install)), or skip npm install entirely by using the Docker pico image (see [Option 1](#option-1-docker-pico-image-recommended)).

**Port 3000 is already in use**

Find what is listening on it:

```bash
lsof -i :3000 | grep LISTEN
```

Then kill that process by PID, or start profClaw on a different port by setting `PORT=3001` in your `.env`.

**No AI provider configured**

Set at least one of these environment variables before starting the server:

```bash
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_GENERATIVE_AI_API_KEY=xxx
OLLAMA_BASE_URL=http://localhost:11434
```

See [Environment Configuration](#environment-configuration) for the full list.

**How do I use a local AI model?**

1. Install [Ollama](https://ollama.com) on your machine.
2. Pull a model:

```bash
ollama pull llama3.2
```

3. Set `OLLAMA_BASE_URL` in your `.env`:

```bash
OLLAMA_BASE_URL=http://localhost:11434
```

4. Restart profClaw. The Ollama provider shows up automatically in the model list.

If you are running profClaw inside Docker, use `http://host.docker.internal:11434` instead of `localhost`.

---

## Getting Help

- [GitHub Issues](https://github.com/profclaw/profclaw/issues)
- [API Documentation](http://localhost:3000/api/docs) (Swagger UI)
- [Discord Community](#) (coming soon)
