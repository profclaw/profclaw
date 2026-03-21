---
name: docker-deploy
description: |
  Build, deploy, and manage applications with Docker. Handles Dockerfile generation,
  image building, container management, and docker-compose workflows. Use when the user
  wants to deploy, containerize, or run services locally.
user-invocable: true
metadata:
  profclaw:
    emoji: "🐳"
    category: deployment
    requires:
      bins: ["docker"]
---

# Docker Deploy

You help users build, deploy, and manage applications using Docker.

## When to Use
- User asks to "deploy", "run", "containerize", or "dockerize" an app
- User wants to start a service locally
- User mentions Docker, containers, or docker-compose

## Workflow

### 1. Analyze the Project
First, understand what we're deploying:
```
project_info       # Detect language, framework, scripts
read_file package.json   # Or requirements.txt, go.mod, Cargo.toml
search_files "Dockerfile"  # Check if Dockerfile exists
search_files "docker-compose"  # Check for compose file
```

### 2. Generate Dockerfile (if missing)
Based on project type, generate an appropriate Dockerfile:

**Node.js/TypeScript:**
```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

**Python:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0"]
```

**Static site:**
```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
```

### 3. Build the Image
```bash
exec command:"docker build -t {{app_name}} ."
```

### 4. Run the Container
```bash
exec command:"docker run -d --name {{app_name}} -p {{host_port}}:{{container_port}} {{app_name}}"
```

### 5. Verify and Return URL
```bash
exec command:"docker ps --filter name={{app_name}} --format '{{.Status}} {{.Ports}}'"
```

The URL will be: `http://localhost:{{host_port}}`

For verification:
```bash
exec command:"curl -s -o /dev/null -w '%{http_code}' http://localhost:{{host_port}}"
```

## Docker Compose

For multi-service apps:

### Generate docker-compose.yml
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://postgres:postgres@db:5432/app
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Run with Compose
```bash
exec command:"docker compose up -d --build"
exec command:"docker compose ps"
exec command:"docker compose logs --tail 20"
```

## Management Commands

| Action | Command |
|--------|---------|
| List containers | `docker ps -a` |
| View logs | `docker logs {{name}} --tail 50` |
| Stop | `docker stop {{name}}` |
| Remove | `docker rm -f {{name}}` |
| Restart | `docker restart {{name}}` |
| Shell into | `docker exec -it {{name}} sh` |
| Rebuild | `docker compose up -d --build` |

## Port Selection
- Avoid common ports: 3000 (profClaw), 5432 (postgres), 6379 (redis)
- Use 8080, 8081, 8082 for web apps
- Check availability: `exec command:"lsof -i :8080 || echo 'port free'"`

## Troubleshooting
- Build fails? Check: `docker build --no-cache -t {{name}} .`
- Container exits? Check: `docker logs {{name}}`
- Port in use? Try: `docker run -p 0:{{port}} {{name}}` (random host port)
- Out of space? Run: `docker system prune -f`

## After Deploy
Always tell the user:
1. The container name
2. The URL (http://localhost:PORT)
3. How to view logs: `docker logs {{name}}`
4. How to stop: `docker stop {{name}}`
