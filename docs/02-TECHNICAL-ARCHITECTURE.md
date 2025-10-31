# VividPages - Technical Architecture Document

**Version:** 1.0
**Date:** October 31, 2025

---

## Architecture Overview

VividPages follows a **microservices-oriented architecture** deployed via Docker Compose, with clear separation between frontend, backend API, background job processing, and data storage layers.

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │          Progressive Web App (PWA Frontend)            │ │
│  │     React/Vue/Svelte + TailwindCSS + PWA Config       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▼ HTTPS
┌─────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  API Gateway / Router                │   │
│  │               (Nginx / Traefik / Caddy)              │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Backend API Service                     │   │
│  │        (Node.js/Python FastAPI/Go Fiber)             │   │
│  │  • Authentication & Authorization                    │   │
│  │  • User Management                                   │   │
│  │  • EPUB Upload & Validation                          │   │
│  │  • Job Submission & Status                           │   │
│  │  • VividPage Retrieval                               │   │
│  │  • Storyboard Management                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     PROCESSING LAYER                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Job Queue & Worker System               │   │
│  │            (BullMQ/Celery + Redis)                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              EPUB Processing Worker                  │   │
│  │  • Parse EPUB structure                              │   │
│  │  • Extract text and chapters                         │   │
│  │  • Scene detection and segmentation                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          LLM Analysis Worker (Orchestrator)          │   │
│  │  • Character identification & tracking               │   │
│  │  • Setting/location detection                        │   │
│  │  • Scene description generation                      │   │
│  │  • Dialogue attribution                              │   │
│  │  • Character reference creation                      │   │
│  │  • Continuity management                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        Image Generation Worker (Orchestrator)        │   │
│  │  • Prompt engineering & assembly                     │   │
│  │  • Character consistency enforcement                 │   │
│  │  • Style application                                 │   │
│  │  • Image generation via API                          │   │
│  │  • NSFW content detection                            │   │
│  │  • Image storage and optimization                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Claude     │  │   ChatGPT    │  │   Ollama     │      │
│  │ (Anthropic)  │  │   (OpenAI)   │  │  (Local LLM) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Stable Diffusion│ │   DALL-E     │  │  Other Models │     │
│  │     API      │  │   (OpenAI)   │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       DATA LAYER                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Primary Database                        │   │
│  │         (PostgreSQL with pgvector)                   │   │
│  │  • User accounts & auth                              │   │
│  │  • Encrypted API keys                                │   │
│  │  • VividPage metadata                                │   │
│  │  • Job status & history                              │   │
│  │  • Storyboard metadata                               │   │
│  │  • Character reference data                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Vector Database                         │   │
│  │         (Qdrant / Weaviate / pgvector)               │   │
│  │  • Character embeddings                              │   │
│  │  • Scene embeddings                                  │   │
│  │  • Setting embeddings                                │   │
│  │  • Semantic search                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Object Storage / File System            │   │
│  │         (MinIO / Local Storage Volume)               │   │
│  │  • EPUB files                                        │   │
│  │  • Generated storyboard images                       │   │
│  │  • Character reference images                        │   │
│  │  • Thumbnails                                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Cache Layer                             │   │
│  │                 (Redis)                              │   │
│  │  • Session management                                │   │
│  │  • Job queue                                         │   │
│  │  • Frequently accessed metadata                      │   │
│  │  • Rate limiting                                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Frontend (PWA)

**Responsibilities:**
- User interface and interaction
- Authentication flow
- EPUB upload
- VividPage wizard
- Bookcase/library display
- Storyboard viewing and editing
- Real-time job progress updates

**Key Technologies:**
- Modern JavaScript framework (React/Vue/Svelte)
- Progressive Web App capabilities
- Responsive design (mobile + desktop)
- WebSocket for real-time updates
- Local storage for offline capabilities

**Communication:**
- REST API to backend
- WebSocket for notifications
- OAuth2 for SSO

---

### 2. API Gateway / Reverse Proxy

**Responsibilities:**
- Route requests to backend services
- SSL/TLS termination
- Rate limiting
- Load balancing (future)
- Static file serving

**Key Technologies:**
- Nginx, Traefik, or Caddy
- Automatic HTTPS (Let's Encrypt)

---

### 3. Backend API Service

**Responsibilities:**
- User authentication and authorization
- API key encryption and storage
- EPUB upload handling
- Job creation and status tracking
- VividPage CRUD operations
- Storyboard metadata management
- User profile management

**Key Technologies:**
- RESTful API design
- JWT for authentication
- Encryption for sensitive data
- ORM for database access
- Input validation and sanitization

**API Endpoints (Examples):**
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/google
GET    /api/auth/me
POST   /api/auth/logout

POST   /api/users/api-keys
GET    /api/users/api-keys
DELETE /api/users/api-keys/:id

GET    /api/vividpages
POST   /api/vividpages
GET    /api/vividpages/:id
DELETE /api/vividpages/:id

POST   /api/jobs
GET    /api/jobs/:id
GET    /api/jobs/:id/status
DELETE /api/jobs/:id

GET    /api/storyboards/:vividPageId
GET    /api/storyboards/:id
POST   /api/storyboards/:id/regenerate

GET    /api/styles
GET    /api/models
```

---

### 4. Job Queue System

**Responsibilities:**
- Queue management for async jobs
- Job prioritization
- Retry logic
- Job persistence
- Worker coordination

**Key Technologies:**
- Redis as message broker
- BullMQ (Node.js) or Celery (Python)
- Job status tracking
- Dead letter queue for failures

**Job Types:**
- EPUB Processing Job
- LLM Analysis Job
- Image Generation Job
- Storyboard Regeneration Job

---

### 5. EPUB Processing Worker

**Responsibilities:**
- Parse EPUB file structure
- Extract chapters and text
- Identify chapter boundaries
- Clean and normalize text
- Detect scene breaks
- Extract metadata (title, author, etc.)

**Key Technologies:**
- EPUB parsing library (epub.js, epubjs, python-epub)
- Text processing utilities
- HTML parsing (for EPUB content)

**Output:**
- Structured book data
- Chapter segmentation
- Scene boundaries
- Raw text for LLM processing

---

### 6. LLM Analysis Worker

**Responsibilities:**
- Character identification and tracking
- Character attribute extraction (appearance, personality)
- Setting/location detection
- Scene description generation
- Dialogue attribution
- Continuity tracking (outfit changes, injuries, etc.)
- Generate detailed prompts for image generation

**Process Flow:**
1. **Initial Pass - Character Discovery**
   - Analyze entire book
   - Identify main characters
   - Extract physical descriptions
   - Create character profiles

2. **Scene Analysis Pass**
   - For each scene/paragraph:
     - Identify present characters
     - Detect setting/location
     - Extract key visual elements
     - Note any character changes
     - Generate image prompt

3. **Consistency Check**
   - Ensure character descriptions align
   - Verify setting continuity
   - Create reference embeddings

**Key Technologies:**
- LLM API clients (OpenAI, Anthropic, Ollama)
- Prompt engineering templates
- Context management (handling large books)
- Structured output parsing (JSON mode)

**LLM Output Format (Example):**
```json
{
  "scene_id": "ch1_scene3",
  "characters": [
    {
      "name": "Elara",
      "appearance": "tall elven woman, long silver hair, green eyes, wearing leather armor",
      "changes": []
    }
  ],
  "setting": {
    "location": "Dark forest clearing",
    "time": "night",
    "weather": "misty",
    "description": "Ancient trees surround a moonlit clearing, mist rolling across the ground"
  },
  "scene_description": "Elara stands in the center of the clearing, bow drawn",
  "image_prompt": "A tall elven woman with long silver hair and green eyes, wearing leather armor, stands in a dark forest clearing at night. She holds a bow drawn. Ancient trees surround her, moonlight filters through mist rolling across the ground. Fantasy art style, detailed, atmospheric."
}
```

---

### 7. Image Generation Worker

**Responsibilities:**
- Assemble final image prompts
- Apply style presets
- Enforce character consistency
- Make API calls to image generation services
- Handle retries and errors
- NSFW content detection
- Image optimization and storage
- Generate thumbnails

**Process Flow:**
1. Receive scene data from LLM worker
2. Load character reference data
3. Apply style template
4. Construct detailed prompt with consistency keywords
5. Call image generation API
6. Validate generated image
7. Check for NSFW (if needed)
8. Optimize and store image
9. Generate thumbnail
10. Update database

**Prompt Engineering Strategy:**
```
[Base Scene Description] +
[Character Consistency Tags] +
[Setting Details] +
[Style Preset] +
[Technical Parameters] +
[Consistency Enforcement]

Example:
"A tall elven woman (ref: character_elara_v1) with long silver hair and
green eyes, wearing leather armor, stands in a dark forest clearing at
night. [CONSISTENT CHARACTER]. Ancient trees, moonlight, mist.
High fantasy art style, detailed, atmospheric lighting, 4K quality,
trending on artstation."
```

**Character Consistency Techniques:**
- Use embeddings/reference images if API supports
- Include character tags in every prompt
- Use ControlNet or IP-Adapter for advanced models
- Store and reuse seeds where possible

**Key Technologies:**
- Image generation API clients
- Image processing libraries (PIL, Sharp)
- NSFW detection models (optional)
- Image compression

---

### 8. Primary Database (PostgreSQL + pgvector)

**Schema Overview:**

**Users Table:**
- user_id (PK)
- email
- password_hash
- google_id (for SSO)
- created_at
- updated_at

**API Keys Table:**
- api_key_id (PK)
- user_id (FK)
- provider (claude, chatgpt, stable_diffusion, etc.)
- encrypted_key
- nickname
- created_at

**VividPages Table:**
- vividpage_id (PK)
- user_id (FK)
- title
- author
- epub_filename
- epub_path
- cover_image
- style_preset
- llm_model
- image_model
- settings (JSON: density, speaker viz, etc.)
- status (processing, completed, failed)
- created_at
- completed_at

**Jobs Table:**
- job_id (PK)
- vividpage_id (FK)
- job_type (epub_parse, llm_analysis, image_gen)
- status (queued, processing, completed, failed)
- progress_percent
- error_message
- created_at
- started_at
- completed_at

**Characters Table:**
- character_id (PK)
- vividpage_id (FK)
- name
- description
- initial_appearance (JSON)
- reference_image_path
- embedding (vector for pgvector)

**Character Changes Table:**
- change_id (PK)
- character_id (FK)
- scene_id (FK)
- change_type (outfit, injury, aging, etc.)
- description

**Scenes Table:**
- scene_id (PK)
- vividpage_id (FK)
- chapter_number
- scene_number
- text_content
- character_ids (array)
- setting_id (FK)
- llm_analysis (JSON)

**Settings Table:**
- setting_id (PK)
- vividpage_id (FK)
- name (e.g., "Dark Forest")
- description
- embedding (vector)

**Storyboards Table:**
- storyboard_id (PK)
- vividpage_id (FK)
- scene_id (FK)
- image_path
- thumbnail_path
- prompt_used
- generation_params (JSON)
- version_number
- created_at

**Storyboard History Table:**
- history_id (PK)
- storyboard_id (FK)
- image_path
- prompt_used
- user_feedback
- created_at

---

### 9. Vector Database

**Purpose:**
- Store embeddings for semantic similarity
- Character consistency matching
- Setting/location matching
- Fast nearest-neighbor search

**Collections:**
- **character_embeddings:** For matching character descriptions
- **scene_embeddings:** For finding similar scenes
- **setting_embeddings:** For location consistency

**Technology Options:**
- **pgvector** (PostgreSQL extension) - Simplest, single DB
- **Qdrant** - Purpose-built vector DB, excellent performance
- **Weaviate** - Feature-rich, good for complex queries

**Recommendation:** Start with **pgvector** to minimize infrastructure. Migrate to Qdrant if needed for scale.

---

### 10. Object Storage

**Purpose:**
- Store large binary files (EPUBs, images)
- Scalable and efficient
- Direct file serving

**Stored Files:**
- EPUB files
- Storyboard images (720x720, 1080x1080)
- Thumbnails
- Character reference images

**Technology Options:**
- **MinIO** - S3-compatible, self-hosted, Docker-friendly
- **Local filesystem** with organized structure
- **S3/R2** - If cloud migration planned

**Recommendation:** **MinIO** for S3 compatibility and future cloud migration path.

**Directory Structure (if using filesystem):**
```
/storage
  /epubs
    /{user_id}
      /{vividpage_id}
        /original.epub
  /storyboards
    /{vividpage_id}
      /720
        /scene_{scene_id}_v{version}.png
      /1080
        /scene_{scene_id}_v{version}.png
      /thumbnails
        /scene_{scene_id}_thumb.jpg
  /characters
    /{vividpage_id}
      /char_{character_id}_ref.png
```

---

### 11. Cache Layer (Redis)

**Responsibilities:**
- Session storage
- Job queue backend
- Rate limiting
- Frequently accessed data caching
- WebSocket pub/sub

**Cached Data:**
- User sessions
- API rate limits
- VividPage metadata (hot data)
- Job status

---

## Data Flow: Complete VividPage Generation

### Step-by-Step Process

**1. User Initiates Generation**
```
User → Frontend → API → Create VividPage record (status: processing)
                  ↓
            Create EPUB Processing Job
                  ↓
            Return job_id to user
```

**2. EPUB Processing**
```
Job Queue → EPUB Processing Worker
              ↓
          Parse EPUB
              ↓
          Extract chapters & text
              ↓
          Detect scenes
              ↓
          Save to Database (Scenes table)
              ↓
          Update VividPage status
              ↓
          Create LLM Analysis Job
```

**3. LLM Analysis**
```
Job Queue → LLM Analysis Worker
              ↓
          Fetch user's API key (encrypted)
              ↓
          Decrypt API key
              ↓
          PASS 1: Character Discovery
              ↓
          Call LLM with entire book context
              ↓
          Extract characters and descriptions
              ↓
          Generate character embeddings
              ↓
          Save to Characters table & Vector DB
              ↓
          PASS 2: Scene Analysis
              ↓
          For each scene:
            - Call LLM with scene + character refs
            - Extract scene details
            - Generate image prompt
            - Save to Scenes table
              ↓
          Update VividPage status
              ↓
          Create Image Generation Jobs (batched)
```

**4. Image Generation**
```
Job Queue → Image Generation Worker (parallel instances)
              ↓
          For each scene:
              ↓
          Fetch scene data & character refs
              ↓
          Assemble final prompt with consistency
              ↓
          Fetch user's image API key
              ↓
          Call image generation API
              ↓
          Receive generated image
              ↓
          Run NSFW check (if configured)
              ↓
          Optimize image (compression)
              ↓
          Generate thumbnail
              ↓
          Save to Object Storage
              ↓
          Update Storyboards table
              ↓
          Update job progress
              ↓
          Send WebSocket notification to user
              ↓
          When all complete:
            - Update VividPage status: completed
            - Send final notification
```

**5. User Views VividPage**
```
User → Frontend → API → Fetch VividPage metadata
                            ↓
                    Fetch Storyboards list
                            ↓
                    Return signed URLs for images
                            ↓
            Frontend displays bookcase/reading view
```

**6. User Regenerates Storyboard**
```
User → Frontend → API → Create Regeneration Job
                            ↓
                    Pass original prompt + user feedback
                            ↓
            Job Queue → Image Generation Worker
                            ↓
                    Generate new version
                            ↓
                    Save to Storyboard History
                            ↓
                    Update Storyboards table (new version)
                            ↓
                    Notify user
```

---

## Security Architecture

### Authentication Flow

**Local Login:**
```
User → Frontend → POST /api/auth/login (email, password)
                       ↓
                  Backend validates credentials
                       ↓
                  Generate JWT token
                       ↓
                  Return token to frontend
                       ↓
            Frontend stores in httpOnly cookie or localStorage
```

**Google SSO:**
```
User → Frontend → Click "Login with Google"
                       ↓
                  Redirect to Google OAuth
                       ↓
                  User authorizes
                       ↓
                  Google redirects back with code
                       ↓
                  Frontend → POST /api/auth/google (code)
                       ↓
                  Backend exchanges code for Google token
                       ↓
                  Fetch user info from Google
                       ↓
                  Create/find user in DB
                       ↓
                  Generate JWT token
                       ↓
                  Return token to frontend
```

### API Key Encryption

**Storage:**
- API keys encrypted at rest using AES-256
- Encryption key stored as environment variable
- Never exposed to frontend
- Decrypted only in worker context

**Process:**
```
User → Frontend → POST /api/users/api-keys (provider, key)
                       ↓
                  Backend encrypts key
                       ↓
                  Store in API Keys table
                       ↓
                  Return success (no key returned)

Worker needs key:
    Fetch encrypted_key from DB
         ↓
    Decrypt using master key
         ↓
    Use for API call
         ↓
    Discard from memory
```

### Rate Limiting

- Per-user rate limits on API endpoints
- Redis-backed rate limiting
- Prevents abuse and DOS

---

## Scalability Considerations

### Horizontal Scaling

**Workers:**
- Multiple worker instances for parallel processing
- Queue distributes jobs automatically
- Easy to add more workers as load increases

**API Service:**
- Stateless design allows multiple instances
- Load balancer distributes requests

### Database Optimization

- Indexes on frequently queried columns
- Partitioning for large tables (storyboards)
- Read replicas for heavy read loads (future)

### Caching Strategy

- Cache expensive queries
- CDN for static images (future)
- Browser caching for storyboards

---

## Monitoring & Observability

**Key Metrics:**
- Job queue length and processing time
- API response times
- Error rates
- Storage usage
- API key usage and costs
- Worker health and utilization

**Logging:**
- Structured logging (JSON)
- Log aggregation (if multi-container)
- Error tracking (Sentry or similar)

**Health Checks:**
- Endpoint: GET /api/health
- Database connectivity
- Redis connectivity
- Worker status

---

## Deployment Architecture (Docker Compose)

**Services:**
1. `frontend` - PWA application
2. `api` - Backend API service
3. `worker-epub` - EPUB processing worker
4. `worker-llm` - LLM analysis worker
5. `worker-image` - Image generation worker
6. `postgres` - PostgreSQL with pgvector
7. `redis` - Cache and queue
8. `minio` - Object storage
9. `nginx` - Reverse proxy

**Volumes:**
- `postgres-data` - Database persistence
- `redis-data` - Cache persistence
- `minio-data` - Object storage persistence

**Networks:**
- `frontend-network` - Frontend ↔ API
- `backend-network` - API ↔ Workers ↔ Databases

---

## Technology Stack Summary

**Recommended Stack:**

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Frontend | React + Vite + TailwindCSS | Fast, modern, excellent PWA support |
| API | Node.js + Express + TypeScript | JavaScript ecosystem, fast, easy workers |
| Workers | Node.js + BullMQ | Same language as API, mature queue library |
| Database | PostgreSQL 15+ with pgvector | Robust, vector support, JSON support |
| Cache/Queue | Redis | Industry standard, reliable |
| Object Storage | MinIO | S3-compatible, self-hosted |
| Reverse Proxy | Caddy | Automatic HTTPS, simple config |
| EPUB Parsing | epubjs / epub.js | Mature, well-documented |
| LLM Clients | Official SDKs | Anthropic SDK, OpenAI SDK, Ollama client |

---

## Next Steps

1. Review and approve architecture
2. Set up development environment
3. Initialize git repository
4. Create Docker Compose configuration
5. Begin Phase 1 implementation (see Development Guide)

---

**Architecture Status:** ✅ Ready for Implementation
**Next Document:** Technology Stack Detailed Specifications
