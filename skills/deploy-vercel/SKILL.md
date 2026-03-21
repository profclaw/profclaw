---
name: deploy-vercel
description: |
  Deploy applications to Vercel. Handles project setup, environment variables,
  and deployment. Returns the live URL after deploy.
user-invocable: true
metadata:
  profclaw:
    emoji: "▲"
    category: deployment
    requires:
      bins: ["vercel"]
---

# Deploy to Vercel

Deploy web applications to Vercel for instant production URLs.

## When to Use
- User asks to "deploy to Vercel" or "put this online"
- User wants a live URL for a web app
- Project is Next.js, React, Vite, or static HTML

## Workflow

### 1. Check Vercel CLI
```bash
exec command:"vercel --version"
```
If not installed: `exec command:"npm install -g vercel"`

### 2. Check Auth
```bash
exec command:"vercel whoami"
```
If not authenticated: tell the user to run `vercel login`

### 3. Deploy
```bash
exec command:"vercel --yes"
```
The `--yes` flag skips prompts and uses defaults.

For production deploy:
```bash
exec command:"vercel --prod --yes"
```

### 4. Extract URL
The deploy output contains the URL. Parse it:
- Preview: `https://project-xxx.vercel.app`
- Production: `https://project.vercel.app`

### 5. Set Environment Variables (if needed)
```bash
exec command:"vercel env add DATABASE_URL production"
```

## Frameworks Auto-Detected
Vercel auto-detects: Next.js, Nuxt, Remix, SvelteKit, Astro, Vite, CRA

## After Deploy
Tell the user:
1. The live URL
2. How to view in dashboard: `vercel inspect <url>`
3. How to redeploy: `vercel --prod`
4. How to set env vars: `vercel env add KEY`
