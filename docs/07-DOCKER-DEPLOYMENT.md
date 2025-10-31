# VividPages - Docker Deployment Configuration Guide

**Version:** 1.0
**Date:** October 31, 2025

---

## Overview

VividPages is deployed using Docker Compose for easy setup and consistent environments across development and production.

**Services:**
- Frontend (React PWA)
- Backend API (Node.js + Express)
- Workers (EPUB, LLM, Image processing)
- PostgreSQL (Database + pgvector)
- Redis (Cache + Queue)
- MinIO (Object storage)
- Caddy (Reverse proxy + HTTPS)
- Ollama (Optional: Local LLM)

---

## Directory Structure

```
vividpages/
├── frontend/
│   ├── src/
│   ├── public/
│   ├── Dockerfile
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── src/
│   │   ├── api/
│   │   ├── workers/
│   │   ├── db/
│   │   └── lib/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── docker/
│   ├── postgres/
│   │   └── init.sql
│   ├── caddy/
│   │   └── Caddyfile
│   └── nginx/
│       └── nginx.conf
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## Docker Compose Configuration

### Main Configuration: `docker-compose.yml`

```yaml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: vividpages-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-vividpages}
      POSTGRES_USER: ${POSTGRES_USER:-vividpages}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    networks:
      - backend-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vividpages"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Cache & Queue
  redis:
    image: redis:7-alpine
    container_name: vividpages-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "${REDIS_PORT:-6379}:6379"
    networks:
      - backend-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  # MinIO Object Storage
  minio:
    image: minio/minio:latest
    container_name: vividpages-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio-data:/data
    ports:
      - "${MINIO_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    networks:
      - backend-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

  # Backend API
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    container_name: vividpages-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      NODE_ENV: ${NODE_ENV:-development}
      DATABASE_URL: postgresql://${POSTGRES_USER:-vividpages}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-vividpages}
      REDIS_URL: redis://redis:6379
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_CALLBACK_URL: ${GOOGLE_CALLBACK_URL}
      OLLAMA_HOST: ${OLLAMA_HOST:-http://ollama:11434}
    volumes:
      - ./backend/src:/app/src # Hot reload in dev
    ports:
      - "${API_PORT:-4000}:4000"
    networks:
      - frontend-network
      - backend-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # EPUB Processing Worker
  worker-epub:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    container_name: vividpages-worker-epub
    restart: unless-stopped
    depends_on:
      - api
    command: node dist/workers/epub-worker.js
    environment:
      NODE_ENV: ${NODE_ENV:-development}
      DATABASE_URL: postgresql://${POSTGRES_USER:-vividpages}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-vividpages}
      REDIS_URL: redis://redis:6379
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
    volumes:
      - ./backend/src:/app/src
    networks:
      - backend-network

  # LLM Analysis Worker
  worker-llm:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    container_name: vividpages-worker-llm
    restart: unless-stopped
    depends_on:
      - api
    command: node dist/workers/llm-worker.js
    environment:
      NODE_ENV: ${NODE_ENV:-development}
      DATABASE_URL: postgresql://${POSTGRES_USER:-vividpages}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-vividpages}
      REDIS_URL: redis://redis:6379
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      OLLAMA_HOST: ${OLLAMA_HOST:-http://ollama:11434}
    volumes:
      - ./backend/src:/app/src
    networks:
      - backend-network
    deploy:
      replicas: ${LLM_WORKERS:-2} # Scale based on load

  # Image Generation Worker
  worker-image:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    container_name: vividpages-worker-image
    restart: unless-stopped
    depends_on:
      - api
    command: node dist/workers/image-worker.js
    environment:
      NODE_ENV: ${NODE_ENV:-development}
      DATABASE_URL: postgresql://${POSTGRES_USER:-vividpages}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-vividpages}
      REDIS_URL: redis://redis:6379
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    volumes:
      - ./backend/src:/app/src
    networks:
      - backend-network
    deploy:
      replicas: ${IMAGE_WORKERS:-3} # Parallel image generation

  # Frontend
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      target: ${BUILD_TARGET:-development}
    container_name: vividpages-frontend
    restart: unless-stopped
    depends_on:
      - api
    environment:
      VITE_API_URL: ${VITE_API_URL:-http://localhost:4000}
      VITE_WS_URL: ${VITE_WS_URL:-ws://localhost:4000}
    volumes:
      - ./frontend/src:/app/src # Hot reload in dev
    ports:
      - "${FRONTEND_PORT:-3000}:3000"
    networks:
      - frontend-network

  # Caddy Reverse Proxy
  caddy:
    image: caddy:2-alpine
    container_name: vividpages-caddy
    restart: unless-stopped
    depends_on:
      - frontend
      - api
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - frontend-network
    environment:
      DOMAIN: ${DOMAIN:-localhost}

  # Ollama (Optional - Local LLM)
  ollama:
    image: ollama/ollama:latest
    container_name: vividpages-ollama
    restart: unless-stopped
    volumes:
      - ollama-data:/root/.ollama
    ports:
      - "11434:11434"
    networks:
      - backend-network
    # Optional: GPU support
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]

volumes:
  postgres-data:
  redis-data:
  minio-data:
  caddy-data:
  caddy-config:
  ollama-data:

networks:
  frontend-network:
    driver: bridge
  backend-network:
    driver: bridge
```

---

## Dockerfiles

### Backend Dockerfile

```dockerfile
# backend/Dockerfile

# Multi-stage build for optimized production images

# Stage 1: Base
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Stage 2: Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Stage 3: Development
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
CMD ["pnpm", "dev"]

# Stage 4: Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable pnpm && pnpm build

# Stage 5: Production
FROM base AS production
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 4000
CMD ["node", "dist/api/server.js"]
```

### Frontend Dockerfile

```dockerfile
# frontend/Dockerfile

# Stage 1: Base
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Stage 2: Dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Stage 3: Development
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

# Stage 4: Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable pnpm && pnpm build

# Stage 5: Production (Nginx)
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

---

## Caddyfile Configuration

```
# docker/caddy/Caddyfile

{
    # Global options
    admin off
    auto_https off # Disable for localhost, enable for production
}

# Development (localhost)
:80 {
    # Frontend
    handle /* {
        reverse_proxy frontend:3000
    }

    # API
    handle /api/* {
        reverse_proxy api:4000
    }

    # WebSocket
    handle /socket.io/* {
        reverse_proxy api:4000
    }

    # MinIO (optional: expose for debugging)
    handle /storage/* {
        reverse_proxy minio:9000
    }
}

# Production (uncomment and configure)
# {$DOMAIN} {
#     # Automatic HTTPS via Let's Encrypt
#     reverse_proxy /* frontend:80
#     reverse_proxy /api/* api:4000
#     reverse_proxy /socket.io/* api:4000
# }
```

---

## PostgreSQL Initialization

```sql
-- docker/postgres/init.sql

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create database (if not exists)
-- Database is already created via POSTGRES_DB env var

-- Set up permissions
GRANT ALL PRIVILEGES ON DATABASE vividpages TO vividpages;
```

---

## Environment Variables

### `.env.example`

```bash
# Application
NODE_ENV=development
DOMAIN=localhost

# Ports
API_PORT=4000
FRONTEND_PORT=3000
POSTGRES_PORT=5432
REDIS_PORT=6379
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001

# PostgreSQL
POSTGRES_DB=vividpages
POSTGRES_USER=vividpages
POSTGRES_PASSWORD=your_strong_password_here

# Redis
# No password for development, set for production

# MinIO
MINIO_ACCESS_KEY=vividpages_access
MINIO_SECRET_KEY=your_minio_secret_key_here
MINIO_BUCKET=vividpages

# JWT Authentication
JWT_SECRET=your_jwt_secret_key_here_32_chars_minimum

# Encryption (32 bytes = 64 hex chars)
ENCRYPTION_KEY=your_encryption_key_here_64_hex_characters

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

# Ollama
OLLAMA_HOST=http://ollama:11434

# Frontend
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000

# Worker Scaling
LLM_WORKERS=2
IMAGE_WORKERS=3

# Build Target
BUILD_TARGET=development  # or 'production'
```

### Generate Secrets

```bash
# JWT Secret (32+ characters)
openssl rand -base64 32

# Encryption Key (32 bytes = 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# MinIO Keys
openssl rand -base64 16
```

---

## Development Workflow

### Initial Setup

```bash
# 1. Clone repository
git clone https://github.com/yourusername/vividpages.git
cd vividpages

# 2. Copy environment file
cp .env.example .env

# 3. Edit .env with your values
nano .env

# 4. Start services
docker-compose up -d

# 5. Check logs
docker-compose logs -f

# 6. Run database migrations
docker-compose exec api pnpm db:migrate

# 7. Create first user (optional)
docker-compose exec api pnpm db:seed
```

### Daily Development

```bash
# Start services
docker-compose up -d

# Watch logs
docker-compose logs -f api frontend

# Stop services
docker-compose down

# Restart specific service
docker-compose restart api

# Rebuild after dependency changes
docker-compose up -d --build
```

### Database Operations

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U vividpages -d vividpages

# Run migrations
docker-compose exec api pnpm db:migrate

# Rollback migration
docker-compose exec api pnpm db:rollback

# Backup database
docker-compose exec postgres pg_dump -U vividpages vividpages > backup.sql

# Restore database
cat backup.sql | docker-compose exec -T postgres psql -U vividpages vividpages
```

---

## Production Deployment

### Production docker-compose.prod.yml

```yaml
version: '3.8'

services:
  postgres:
    restart: always
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    # Remove port exposure (internal only)
    ports: []

  redis:
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    # Remove port exposure
    ports: []

  minio:
    restart: always
    # Remove console port exposure
    ports:
      - "9000:9000"

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: production
    restart: always
    environment:
      NODE_ENV: production
    # Remove volume mounts (no hot reload)
    volumes: []

  worker-llm:
    deploy:
      replicas: 4  # More workers for production

  worker-image:
    deploy:
      replicas: 6

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      target: production
    restart: always
    volumes: []

  caddy:
    restart: always
    environment:
      DOMAIN: ${DOMAIN}
    # Caddyfile should enable auto_https for production

# Add monitoring (optional)
  prometheus:
    image: prom/prometheus
    # ... configuration

  grafana:
    image: grafana/grafana
    # ... configuration
```

### Deploy to Production

```bash
# 1. SSH to server
ssh user@your-server.com

# 2. Clone repository
git clone https://github.com/yourusername/vividpages.git
cd vividpages

# 3. Set up environment
cp .env.example .env
nano .env  # Configure production values

# 4. Deploy
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 5. Run migrations
docker-compose exec api pnpm db:migrate

# 6. Check status
docker-compose ps
docker-compose logs -f
```

---

## Scaling Workers

### Scale Up

```bash
# Scale LLM workers to 5 instances
docker-compose up -d --scale worker-llm=5

# Scale image workers to 10 instances
docker-compose up -d --scale worker-image=10
```

### Auto-scaling (Future)

For Kubernetes or Docker Swarm:
```yaml
deploy:
  replicas: 3
  update_config:
    parallelism: 1
    delay: 10s
  restart_policy:
    condition: on-failure
```

---

## Monitoring & Logging

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api

# Last 100 lines
docker-compose logs --tail=100 api

# Save logs to file
docker-compose logs api > api.log
```

### Health Checks

```bash
# Check all service health
docker-compose ps

# API health endpoint
curl http://localhost:4000/api/health

# Database connection
docker-compose exec postgres pg_isready -U vividpages

# Redis connection
docker-compose exec redis redis-cli ping
```

### Resource Monitoring

```bash
# Container resource usage
docker stats

# Disk usage
docker system df

# Clean up unused resources
docker system prune -a
```

---

## Backup & Restore

### Automated Backup Script

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"

# Database backup
docker-compose exec -T postgres pg_dump -U vividpages vividpages | \
  gzip > $BACKUP_DIR/db_backup_$DATE.sql.gz

# MinIO data backup (optional)
docker-compose exec -T minio mc mirror /data $BACKUP_DIR/minio_$DATE

# Keep only last 7 days
find $BACKUP_DIR -name "db_backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
```

### Cron Job

```bash
# Run daily at 2 AM
crontab -e

# Add line:
0 2 * * * /path/to/backup.sh >> /var/log/vividpages_backup.log 2>&1
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs service-name

# Check if port is already in use
netstat -tuln | grep PORT_NUMBER

# Rebuild without cache
docker-compose build --no-cache service-name
docker-compose up -d
```

### Database Connection Issues

```bash
# Check postgres is running
docker-compose ps postgres

# Check connection string
docker-compose exec api env | grep DATABASE_URL

# Connect manually
docker-compose exec postgres psql -U vividpages -d vividpages
```

### Worker Not Processing Jobs

```bash
# Check worker logs
docker-compose logs worker-llm

# Check Redis queue
docker-compose exec redis redis-cli
> KEYS *
> LLEN bull:epub-processing:waiting

# Restart workers
docker-compose restart worker-llm worker-image worker-epub
```

### Out of Disk Space

```bash
# Check disk usage
df -h

# Check Docker disk usage
docker system df

# Clean up
docker system prune -a --volumes

# Remove old images
docker image prune -a

# Check large files in MinIO
docker-compose exec minio du -sh /data
```

---

## Security Hardening (Production)

### 1. Use Docker Secrets

```yaml
secrets:
  db_password:
    external: true
  jwt_secret:
    external: true

services:
  api:
    secrets:
      - db_password
      - jwt_secret
```

### 2. Non-root User

Update Dockerfiles:
```dockerfile
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs
```

### 3. Limit Container Resources

```yaml
services:
  worker-image:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### 4. Network Isolation

```yaml
services:
  postgres:
    networks:
      - backend-network  # Only backend can access
```

### 5. Read-only Filesystem

```yaml
services:
  api:
    read_only: true
    tmpfs:
      - /tmp
      - /app/tmp
```

---

## Update Strategy

### Rolling Updates

```bash
# 1. Pull latest changes
git pull

# 2. Rebuild and restart one service at a time
docker-compose up -d --no-deps --build api

# 3. Check health
curl http://localhost:4000/api/health

# 4. Continue with other services
docker-compose up -d --no-deps --build frontend
```

### Zero-Downtime Deployment (Future)

Use load balancer with multiple API instances:
```yaml
services:
  api:
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
```

---

## Performance Tuning

### PostgreSQL

```sql
-- docker/postgres/postgresql.conf

# Increase shared memory
shared_buffers = 256MB
effective_cache_size = 1GB

# Connection pooling
max_connections = 100

# Query optimization
random_page_cost = 1.1  # For SSD
```

### Redis

```bash
# docker-compose.yml
command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
```

### Worker Concurrency

```typescript
// workers/config.ts
export const workerConfig = {
  concurrency: process.env.NODE_ENV === 'production' ? 5 : 2,
  limiter: {
    max: 10,
    duration: 1000
  }
};
```

---

## Checklist: Ready for Production

- [ ] All secrets generated and secured
- [ ] `.env` configured for production
- [ ] HTTPS enabled (Caddy with domain)
- [ ] Database backups automated
- [ ] Health checks working
- [ ] Logs configured and monitored
- [ ] Resource limits set
- [ ] Security hardening applied
- [ ] Firewall configured
- [ ] Domain and DNS configured
- [ ] SSL certificate obtained
- [ ] Monitoring set up (optional)
- [ ] Alert system configured (optional)
- [ ] Documentation complete

---

## Summary

VividPages uses Docker Compose for:
- **Easy setup:** One command to start all services
- **Consistency:** Same environment dev to prod
- **Scalability:** Easy to scale workers
- **Isolation:** Services in separate containers
- **Portability:** Deploy anywhere Docker runs

**Next Steps:**
1. Set up development environment
2. Test with sample EPUB
3. Optimize and tune
4. Deploy to production
5. Monitor and iterate

---

**Status:** ✅ Docker Configuration Complete
**Project Planning:** ✅ ALL DOCUMENTS COMPLETE
