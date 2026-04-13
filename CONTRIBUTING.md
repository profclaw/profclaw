# Contributing to profClaw

Thanks for your interest in contributing to profClaw! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 9+
- Redis (optional, only needed for pro mode)

### Setup

```bash
git clone https://github.com/profclaw/profclaw.git
cd profclaw
pnpm install
cp .env.example .env
# Add your AI provider API key to .env
pnpm dev
```

### Development Commands

```bash
pnpm dev          # Start dev server (API + UI)
pnpm build        # Compile TypeScript + Vite
pnpm test         # Run tests
pnpm lint         # Lint check
```

## How to Contribute

### Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node version, deployment mode)

### Suggesting Features

Open a discussion or issue describing:
- The problem you're solving
- Your proposed solution
- Alternatives you considered

### Submitting Code

1. Fork the repo and create a branch from `main`
2. Follow the naming convention: `feat/description`, `fix/description`, `refactor/description`
3. Write code following existing patterns (see `AGENTS.md` for conventions)
4. Add tests for new features
5. Ensure `pnpm build && pnpm test && pnpm lint` pass
6. Submit a pull request

### Commit Messages

We use conventional commits:

```
<type>: <description>
```

Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`

### Code Style

- TypeScript strict mode, no `any` types
- `import type` for type-only imports
- `.js` extension on all relative imports
- Tailwind v4 for UI styling (no inline styles)
- Lucide icons only
- Zod validation at system boundaries
- See `AGENTS.md` for full conventions

## Architecture

```
src/
  adapters/      - AI agent adapters
  chat/          - Chat engine + providers (Slack, Discord, Telegram, WhatsApp)
  core/          - Deployment modes, feature flags
  integrations/  - GitHub, Jira, Linear webhooks
  queue/         - BullMQ + in-memory task queue
  providers/     - AI SDK providers (35+)
  skills/        - Skill loader and registry
  types/         - Shared TypeScript types

ui/src/          - React 19 + Vite frontend
skills/          - Built-in skill definitions
```

## Adding a Chat Channel

1. Create `src/chat/providers/<name>/index.ts`
2. Implement the `ChatProvider` interface from `src/chat/providers/types.ts`
3. Add the provider ID to `ChatProviderId` type
4. Register in the provider registry
5. Add tests

## Adding a Skill

1. Create `skills/<name>/SKILL.md` following existing skill format
2. The skill loader auto-discovers skills from this directory
3. Test via the chat interface

## Adding a Tool

1. Add tool definition in `src/chat/execution/tools/`
2. Register in `src/chat/execution/tools/index.ts`
3. Add tests

## Release checklist

For maintainers publishing a new version:

1. Merge PRs to `main`
2. Release-please auto-creates a release PR (bumps version, updates CHANGELOG)
3. Merge the release PR. This creates a git tag and triggers npm publish via CI.
4. Build and push Docker images locally:
   ```bash
   ./scripts/release-docker.sh
   ```
   The script builds both main and pico images, shows sizes, and asks before pushing to ghcr.io.
5. Verify the release:
   ```bash
   npm info profclaw version        # npm
   docker pull ghcr.io/profclaw/profclaw:latest  # Docker
   ```

Docker images are built locally (not in CI) to save GitHub Actions minutes. The script handles ghcr.io login via `gh auth`.

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license.
