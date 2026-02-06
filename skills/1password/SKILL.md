---
name: 1password
description: Retrieve and manage secrets from 1Password using the op CLI. Supports item lookup, field access, and environment injection.
version: 1.0.0
metadata: {"profclaw": {"emoji": "🔐", "category": "security", "priority": 60, "triggerPatterns": ["1password", "password", "op", "secret", "credential", "retrieve secret", "get password", "1pass"]}}
---

# 1Password

You are a 1Password CLI assistant. When users need to retrieve credentials, inject secrets into commands, or manage items in their 1Password vault, you use the `op` CLI securely.

## What This Skill Does

- Retrieves secrets and credentials from 1Password vaults
- Injects secrets into commands and environment variables
- Lists vaults and items (without revealing values)
- Creates and updates vault items
- Uses Service Account tokens for headless/automated use

## Checking op CLI is Available

```bash
which op && op --version
# Install: brew install 1password-cli (macOS)
# Or: https://developer.1password.com/docs/cli/get-started
```

## Authentication

```bash
# Interactive sign-in (opens browser or prompts)
eval $(op signin)

# Service Account (for automated/headless use)
export OP_SERVICE_ACCOUNT_TOKEN="your-token-here"
op whoami  # verify auth
```

## Reading Secrets

```bash
# Get a specific field from an item
op item get "My Server" --field password

# Get a field by reference (URI format)
op read "op://Personal/My Server/password"

# Get a username
op item get "GitHub" --field username

# Get the full item as JSON
op item get "My Server" --format json
```

## Environment Variable Injection

```bash
# Inject secrets into a command without exposing them in shell history
op run --env-file=.env.op -- node dist/server.js

# Inline injection using op:// references in .env.op:
# DATABASE_URL=op://Work/Production DB/connection_string
# API_KEY=op://Work/OpenAI/credential
```

## Listing Vaults and Items

```bash
# List all vaults
op vault list

# List items in a vault
op item list --vault "Personal"

# Search for an item by name
op item list --categories Login | grep -i github

# List without revealing secrets (safe to share output)
op item get "GitHub" --format json | \
  python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f\"Title: {d['title']}\")
print(f\"Category: {d['category']}\")
fields = [f['label'] for f in d.get('fields', []) if f.get('label')]
print(f\"Fields: {', '.join(fields)}\")
"
```

## Creating Items

```bash
# Create a new Login item
op item create \
  --category Login \
  --title "New Service" \
  --vault "Work" \
  --url "https://service.example.com" \
  username="user@example.com" \
  password="$(op generate password)"

# Generate a strong password
op generate password --length 32 --symbols
```

## Updating Items

```bash
# Update a specific field
op item edit "My Server" password="new-secure-password"

# Add a new field
op item edit "My Server" notes="Updated on $(date)"
```

## Using References in Config Files

Instead of hardcoding secrets, use `op://` references:

```bash
# .env.op file (safe to commit - no actual secrets)
DATABASE_URL=op://Work/Postgres/connection_string
OPENAI_API_KEY=op://Work/OpenAI/credential
REDIS_URL=op://Work/Redis/url

# Run with injected secrets
op run --env-file=.env.op -- pnpm dev
```

## Example Interactions

**User**: Get my GitHub token from 1Password
**You**: *(checks op auth, runs `op item get "GitHub" --field credential`, returns value)*

**User**: List all items in my Work vault
**You**: *(runs `op item list --vault Work`, shows titles and categories without revealing secrets)*

**User**: Inject my production secrets and start the server
**You**: *(runs `op run --env-file=.env.op -- node dist/server.js`)*

## Safety Rules

- **Never** print secret values to logs or visible output unless explicitly requested
- **Never** store secrets in files without encryption (use .env.op with op:// refs)
- **Always** use `op run` for injecting secrets into processes - not shell variables
- **Confirm** before creating or modifying vault items
- **Mask** credentials when showing command examples

## Best Practices

1. Use `op run` with `--env-file` for all secret injection - avoids shell history exposure
2. Use `op://` references in config files instead of actual values
3. Prefer Service Account tokens for automated pipelines
4. Use `op generate password` when creating new credentials
5. Keep separate vaults for Personal, Work, and Shared team credentials
