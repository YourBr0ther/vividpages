# VividPages - Technology Stack Recommendations

**Version:** 1.0
**Date:** October 31, 2025

---

## Stack Decision Framework

### Selection Criteria

1. **Developer Experience** - Easy to learn and maintain
2. **Performance** - Handles large files and concurrent processing
3. **Ecosystem** - Rich library support
4. **Docker Compatibility** - Works well in containers
5. **Long-term Viability** - Active community and updates
6. **Type Safety** - Reduces bugs in complex system

---

## Complete Technology Stack

### Frontend Stack

#### Core Framework: **React 18+**

**Choice:** React with TypeScript
**Alternatives Considered:** Vue 3, Svelte, SolidJS

**Reasoning:**
- Largest ecosystem and community
- Excellent PWA support
- Strong TypeScript integration
- Rich component libraries
- React Query for server state management
- Great developer tools

**Key Libraries:**

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.20.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.4.0",
    "axios": "^1.6.0",
    "socket.io-client": "^4.7.0",
    "epub": "^1.2.0",
    "react-dropzone": "^14.2.0",
    "@headlessui/react": "^1.7.0",
    "react-hot-toast": "^2.4.0",
    "framer-motion": "^10.16.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "vite-plugin-pwa": "^0.17.0"
  }
}
```

**Purpose of Each:**

| Library | Purpose |
|---------|---------|
| `react` + `react-dom` | Core framework |
| `react-router-dom` | Client-side routing |
| `@tanstack/react-query` | Server state management, caching |
| `zustand` | Client state management (user prefs, UI state) |
| `axios` | HTTP client |
| `socket.io-client` | Real-time updates (job progress) |
| `epub` | EPUB preview in browser |
| `react-dropzone` | Drag-and-drop file upload |
| `@headlessui/react` | Accessible UI components |
| `react-hot-toast` | Notifications |
| `framer-motion` | Animations |
| `date-fns` | Date formatting |
| `vite` | Build tool (faster than webpack) |
| `tailwindcss` | Utility-first CSS |
| `vite-plugin-pwa` | PWA generation |

#### UI Component Library: **Tailwind CSS + HeadlessUI**

**Reasoning:**
- Utility-first approach for custom designs
- No heavy component library overhead
- Excellent responsive design utilities
- HeadlessUI for accessible, unstyled components
- Easy theming

#### Build Tool: **Vite**

**Reasoning:**
- Extremely fast HMR (Hot Module Replacement)
- Modern, optimized builds
- Great TypeScript support
- Excellent PWA plugin

#### PWA Configuration

**Key Requirements:**
- Service worker for offline capability
- Web manifest for "Add to Home Screen"
- Caching strategy for static assets
- Background sync for job submissions (future)

---

### Backend API Stack

#### Language & Runtime: **Node.js 20+ with TypeScript**

**Choice:** Node.js + TypeScript + Express
**Alternatives Considered:** Python (FastAPI), Go (Fiber), Rust (Actix)

**Reasoning:**
- Same language as workers (code sharing)
- Excellent async I/O for API workloads
- Massive ecosystem
- TypeScript adds type safety
- Fast development velocity
- Good Docker support

**Key Libraries:**

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "@types/express": "^4.17.0",
    "typescript": "^5.3.0",
    "tsx": "^4.0.0",
    "dotenv": "^16.3.0",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^7.1.0",
    "express-validator": "^7.0.0",
    "jsonwebtoken": "^9.0.0",
    "@types/jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0",
    "@types/bcrypt": "^5.0.0",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0",
    "pg": "^8.11.0",
    "@types/pg": "^8.10.0",
    "drizzle-orm": "^0.29.0",
    "drizzle-kit": "^0.20.0",
    "ioredis": "^5.3.0",
    "bullmq": "^5.0.0",
    "multer": "^1.4.5-lts.1",
    "@types/multer": "^1.4.0",
    "minio": "^7.1.0",
    "winston": "^3.11.0",
    "socket.io": "^4.7.0",
    "zod": "^3.22.0",
    "crypto-js": "^4.2.0"
  }
}
```

**Purpose of Each:**

| Library | Purpose |
|---------|---------|
| `express` | Web framework |
| `typescript` | Type safety |
| `tsx` | TypeScript execution |
| `dotenv` | Environment variables |
| `helmet` | Security headers |
| `cors` | Cross-origin resource sharing |
| `express-rate-limit` | API rate limiting |
| `express-validator` | Input validation |
| `jsonwebtoken` | JWT auth tokens |
| `bcrypt` | Password hashing |
| `passport` | Authentication strategies |
| `passport-google-oauth20` | Google SSO |
| `pg` | PostgreSQL driver |
| `drizzle-orm` | TypeScript ORM (type-safe) |
| `ioredis` | Redis client |
| `bullmq` | Job queue |
| `multer` | File upload handling |
| `minio` | S3-compatible storage client |
| `winston` | Logging |
| `socket.io` | WebSocket for real-time |
| `zod` | Runtime type validation |
| `crypto-js` | Encryption (API keys) |

#### ORM: **Drizzle ORM**

**Choice:** Drizzle ORM
**Alternatives Considered:** Prisma, TypeORM, Kysely

**Reasoning:**
- Lightweight and fast
- Excellent TypeScript support
- SQL-like syntax (easy for developers who know SQL)
- Great PostgreSQL support including pgvector
- No runtime overhead
- Easier for raw SQL when needed

---

### Worker Stack

#### Runtime: **Node.js 20+ with TypeScript**

**Reasoning:**
- Share code with API (types, utilities)
- Excellent async processing
- Good library support for LLMs and image APIs

**Key Libraries:**

```json
{
  "dependencies": {
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0",
    "@anthropic-ai/sdk": "^0.10.0",
    "openai": "^4.20.0",
    "ollama": "^0.4.0",
    "epubjs": "^0.3.0",
    "jsdom": "^23.0.0",
    "cheerio": "^1.0.0-rc.12",
    "sharp": "^0.33.0",
    "axios": "^1.6.0",
    "form-data": "^4.0.0",
    "pg": "^8.11.0",
    "drizzle-orm": "^0.29.0",
    "minio": "^7.1.0",
    "winston": "^3.11.0",
    "dotenv": "^16.3.0",
    "crypto-js": "^4.2.0",
    "@tensorflow/tfjs-node": "^4.15.0",
    "nsfwjs": "^4.1.0"
  }
}
```

**Purpose of Each:**

| Library | Purpose |
|---------|---------|
| `bullmq` | Job queue worker |
| `@anthropic-ai/sdk` | Claude API client |
| `openai` | ChatGPT + DALL-E client |
| `ollama` | Local LLM client |
| `epubjs` | EPUB parsing |
| `jsdom` | HTML parsing from EPUB |
| `cheerio` | HTML manipulation |
| `sharp` | Image optimization, thumbnails |
| `form-data` | Multipart uploads to APIs |
| `@tensorflow/tfjs-node` | ML models (NSFW detection) |
| `nsfwjs` | NSFW image detection |

#### EPUB Processing: **epubjs**

**Reasoning:**
- Popular and well-maintained
- Extracts chapters and text
- Handles various EPUB formats

#### Image Processing: **Sharp**

**Reasoning:**
- Fastest Node.js image library
- Resize, compress, format conversion
- Low memory usage

#### NSFW Detection: **NSFWJS**

**Reasoning:**
- TensorFlow-based
- Runs locally (no external API)
- Good accuracy for content filtering

---

### Database Stack

#### Primary Database: **PostgreSQL 15+**

**Choice:** PostgreSQL with pgvector extension
**Alternatives Considered:** MongoDB, MySQL

**Reasoning:**
- Mature, reliable, ACID compliant
- Excellent JSON support (for flexible schemas)
- pgvector extension for embeddings
- Rich ecosystem
- Great performance
- Strong Docker support

**Extensions:**
- `pgvector` - Vector similarity search
- `uuid-ossp` - UUID generation
- `pg_trgm` - Full-text search

#### Vector Storage: **pgvector**

**Choice:** pgvector (PostgreSQL extension)
**Alternatives Considered:** Qdrant, Weaviate, Pinecone

**Reasoning:**
- Single database reduces infrastructure complexity
- Good enough for thousands of vectors
- No additional service to manage
- Easy backup (same as main DB)
- Can migrate to dedicated vector DB later if needed

**Migration Path:** If vector queries become slow (>10k books), migrate to Qdrant.

---

### Cache & Queue Stack

#### Redis: **Redis 7+**

**Reasoning:**
- Industry standard
- Used for both caching and queue
- Excellent performance
- Great Node.js clients
- Reliable persistence options

**Configuration:**
- RDB + AOF for persistence
- Separate logical databases:
  - DB 0: Queue (BullMQ)
  - DB 1: Cache
  - DB 2: Sessions

---

### Object Storage Stack

#### Storage: **MinIO**

**Choice:** MinIO
**Alternatives Considered:** Local filesystem, S3, Cloudflare R2

**Reasoning:**
- S3-compatible API
- Self-hosted
- Easy migration to cloud S3 later
- Excellent Docker support
- Built-in web UI for debugging
- Versioning support

**Alternative:** If simplicity is preferred, use organized local filesystem with Docker volumes.

---

### Reverse Proxy / Gateway

#### Proxy: **Caddy 2**

**Choice:** Caddy
**Alternatives Considered:** Nginx, Traefik

**Reasoning:**
- Automatic HTTPS with Let's Encrypt
- Simplest configuration
- Modern and actively maintained
- Built-in reverse proxy
- Great for Docker environments

**Caddyfile Example:**
```
vividpages.local {
    reverse_proxy frontend:3000

    route /api/* {
        reverse_proxy api:4000
    }

    route /storage/* {
        reverse_proxy minio:9000
    }
}
```

---

## AI/ML Service Integrations

### LLM Providers

#### 1. Claude (Anthropic)
- **SDK:** `@anthropic-ai/sdk`
- **Models:** claude-3-opus, claude-3-sonnet, claude-3-haiku
- **Use Case:** Superior for character analysis and scene description
- **Pricing:** Pay-per-token via API key

#### 2. ChatGPT (OpenAI)
- **SDK:** `openai`
- **Models:** gpt-4, gpt-4-turbo, gpt-3.5-turbo
- **Use Case:** Fast processing, good all-around
- **Pricing:** Pay-per-token via API key

#### 3. NanoGPT
- **Note:** This is typically self-hosted/trained. May require custom integration.
- **Use Case:** Experimental, low-cost

#### 4. Ollama
- **SDK:** `ollama` npm package
- **Models:** llama2, mistral, etc. (user-installed)
- **Use Case:** Free, local, no API costs, uncensored
- **Setup:** Ollama service in Docker Compose

### Image Generation Providers

#### 1. Stable Diffusion
- **API Options:**
  - Stability AI API
  - Replicate
  - Local (Automatic1111 API)
- **Use Case:** Best for consistency, customizable
- **Pricing:** Varies

#### 2. DALL-E 3 (OpenAI)
- **SDK:** `openai` (same as ChatGPT)
- **Use Case:** High quality, easy integration
- **Pricing:** $0.04-0.08 per image

#### 3. Midjourney
- **Note:** No official API yet (as of Oct 2025)
- **Future:** Add when available

---

## Development Tools

### Code Quality

```json
{
  "devDependencies": {
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.18.0",
    "@typescript-eslint/parser": "^6.18.0",
    "prettier": "^3.1.0",
    "husky": "^8.0.0",
    "lint-staged": "^15.2.0"
  }
}
```

- **ESLint:** Linting for TypeScript
- **Prettier:** Code formatting
- **Husky:** Git hooks
- **lint-staged:** Run linters on staged files

### Testing (Future)

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.1.0",
    "@testing-library/jest-dom": "^6.1.0",
    "supertest": "^6.3.0"
  }
}
```

---

## Docker Stack

### Base Images

- **Frontend:** `node:20-alpine` (build) → `nginx:alpine` (serve)
- **API:** `node:20-alpine`
- **Workers:** `node:20-alpine`
- **PostgreSQL:** `postgres:15-alpine`
- **Redis:** `redis:7-alpine`
- **MinIO:** `minio/minio:latest`
- **Caddy:** `caddy:2-alpine`

### Why Alpine?
- Smallest image size
- Security (minimal attack surface)
- Faster builds and deploys

---

## File Structure

```
vividpages/
├── frontend/                  # React PWA
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── types/
│   │   └── main.tsx
│   ├── public/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
├── backend/                   # API + Workers
│   ├── src/
│   │   ├── api/              # Express API
│   │   │   ├── routes/
│   │   │   ├── controllers/
│   │   │   ├── middleware/
│   │   │   └── server.ts
│   │   ├── workers/          # Background workers
│   │   │   ├── epub-worker.ts
│   │   │   ├── llm-worker.ts
│   │   │   └── image-worker.ts
│   │   ├── db/               # Database
│   │   │   ├── schema.ts
│   │   │   └── migrations/
│   │   ├── lib/              # Shared utilities
│   │   │   ├── auth.ts
│   │   │   ├── encryption.ts
│   │   │   ├── llm-clients/
│   │   │   └── storage.ts
│   │   └── types/
│   ├── package.json
│   └── tsconfig.json
├── docker/                    # Docker configs
│   ├── Dockerfile.frontend
│   ├── Dockerfile.backend
│   └── Dockerfile.worker
├── docs/                      # Documentation
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## Environment Variables

### Required Variables

```bash
# Backend API
NODE_ENV=development
API_PORT=4000
JWT_SECRET=<random-string>
ENCRYPTION_KEY=<random-32-byte-string>

# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=vividpages
POSTGRES_USER=vividpages
POSTGRES_PASSWORD=<strong-password>

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# MinIO / Object Storage
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=<access-key>
MINIO_SECRET_KEY=<secret-key>
MINIO_BUCKET=vividpages

# Google OAuth
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
GOOGLE_CALLBACK_URL=https://yourdomain.com/api/auth/google/callback

# Frontend
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000

# Workers (Optional - for system-level API keys)
# Users provide their own, but system can have defaults
OLLAMA_HOST=http://ollama:11434
```

---

## Recommended VS Code Extensions

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-azuretools.vscode-docker",
    "Orta.vscode-jest",
    "Prisma.prisma",
    "rangav.vscode-thunder-client"
  ]
}
```

---

## Package Manager: **pnpm**

**Choice:** pnpm
**Alternatives:** npm, yarn

**Reasoning:**
- Fastest package manager
- Efficient disk usage (shared dependencies)
- Strict by default (prevents phantom dependencies)
- Drop-in replacement for npm
- Great monorepo support (if we expand later)

**Installation:**
```bash
npm install -g pnpm
```

---

## Summary: Technology Decisions

| Category | Technology | Version |
|----------|-----------|---------|
| **Frontend** | React + TypeScript + Vite | 18+ / 5+ / 5+ |
| **Backend** | Node.js + Express + TypeScript | 20+ / 4+ / 5+ |
| **ORM** | Drizzle ORM | 0.29+ |
| **Database** | PostgreSQL + pgvector | 15+ |
| **Cache/Queue** | Redis | 7+ |
| **Storage** | MinIO | Latest |
| **Reverse Proxy** | Caddy | 2+ |
| **Job Queue** | BullMQ | 5+ |
| **UI Framework** | Tailwind CSS | 3+ |
| **LLM SDKs** | Anthropic, OpenAI, Ollama | Latest |
| **Image Processing** | Sharp | 0.33+ |
| **Package Manager** | pnpm | 8+ |

---

## Next Steps

1. Initialize git repository
2. Set up project structure
3. Install dependencies
4. Configure Docker Compose
5. Begin Phase 1 development

**Status:** ✅ Stack Finalized
**Next Document:** Database Schema Design
