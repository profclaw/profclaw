---
name: deploy-cloudflare
description: |
  Deploy applications to Cloudflare Workers/Pages. Handles wrangler setup,
  configuration, and deployment. Returns the live URL.
user-invocable: true
metadata:
  profclaw:
    emoji: "☁️"
    category: deployment
    requires:
      bins: ["wrangler"]
---

# Deploy to Cloudflare

Deploy to Cloudflare Workers (APIs/functions) or Pages (static/SSR sites).

## When to Use
- User asks to deploy to Cloudflare
- User wants edge/serverless deployment
- Project is a Hono/Express API, static site, or Next.js/Remix/Astro

## Workers (API/Backend)

### 1. Generate wrangler.toml
```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
```

### 2. Deploy
```bash
exec command:"wrangler deploy"
```

URL: `https://my-app.<account>.workers.dev`

## Pages (Frontend/SSR)

### 1. Build the project
```bash
exec command:"pnpm build"
```

### 2. Deploy
```bash
exec command:"wrangler pages deploy dist"
```

URL: `https://my-app.pages.dev`

## After Deploy
Tell the user:
1. The live URL (*.workers.dev or *.pages.dev)
2. Custom domain: `wrangler pages domains add my-app example.com`
3. Logs: `wrangler tail` (real-time)
4. Env vars: `wrangler secret put API_KEY`
