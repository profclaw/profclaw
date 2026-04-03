---
name: full-stack-builder
description: |
  Build complete applications from a description. Creates project structure,
  writes code, installs dependencies, runs tests, and optionally deploys.
  The end-to-end "build me an app" skill.
user-invocable: true
metadata:
  profclaw:
    emoji: "🏗️"
    category: coding
---

# Full Stack Builder

Build complete applications from natural language descriptions.

## When to Use
- "Build me a..." / "Create an app that..." / "Make a website for..."
- User describes functionality and wants a working app
- Starting from scratch or adding major features

## Workflow

### Phase 1: Plan
1. Understand the requirements (ask clarifying questions if vague)
2. Choose the stack:
   - **Static site**: HTML + CSS + JS (or Astro/Vite)
   - **React app**: Vite + React + TypeScript
   - **Full-stack**: Next.js or Hono backend + React frontend
   - **API only**: Hono or Express + TypeScript
   - **Python**: FastAPI or Flask
3. Plan the file structure

### Phase 2: Scaffold
1. Create project directory
2. Initialize package.json / pyproject.toml
3. Create configuration files (tsconfig, vite.config, etc.)
4. Install dependencies

```bash
exec command:"mkdir -p {{project_name}}"
exec command:"cd {{project_name}} && pnpm init"
exec command:"cd {{project_name}} && pnpm add {{deps}}"
```

### Phase 3: Build
1. Write source files (components, routes, styles)
2. Write tests
3. Create README.md

Use `write_file` for new files, `edit_file` for modifications.

### Phase 4: Verify
```bash
typecheck         # Check types
lint              # Check code quality
test_run          # Run tests
build             # Build for production
```

Fix any issues found, then re-verify.

### Phase 5: Deploy (if requested)
Based on project type:
- **Static**: Docker (nginx) or Vercel/Cloudflare Pages
- **Node.js**: Docker or Vercel/Fly.io
- **API**: Docker or Cloudflare Workers

After deploy, return the live URL.

### Phase 6: Git (if requested)
```bash
exec command:"cd {{project}} && git init && git add -A && git commit -m 'feat: initial setup'"
create_pr title:"Initial app setup" body:"Created {{project}} with {{stack}}"
```

## Output
Always provide:
1. Summary of what was built
2. File structure overview
3. How to run locally: `pnpm dev` or `docker compose up`
4. How to deploy (if not already deployed)
5. Live URL (if deployed)

## Best Practices
- Always use TypeScript for JS projects
- Include a .gitignore
- Add basic error handling
- Include at least one test
- Add a README with setup instructions
- Use environment variables for secrets (never hardcode)
