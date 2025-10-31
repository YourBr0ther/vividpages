# VividPages

**Transform your favorite books into immersive visual experiences with AI-generated storyboards.**

VividPages is a self-hosted web application (PWA) that converts EPUB books into visual narratives by generating contextually accurate, character-consistent storyboards for every scene. Built for visual learners, book enthusiasts, and anyone who wants to see their favorite literary worlds come alive.

---

## 🎯 What is VividPages?

VividPages analyzes EPUB books using AI (Claude, ChatGPT, or local models via Ollama) to:
- Identify and track characters throughout the story
- Detect scene changes and settings
- Generate detailed image prompts maintaining visual consistency
- Create storyboard illustrations for each paragraph, chapter, or speaking part

The result: A visually enriched reading experience that makes books more accessible and immersive.

---

## ✨ Key Features

### 📚 EPUB Processing
- Upload and parse any EPUB book
- Automatic chapter and scene detection
- Character and dialogue extraction
- Metadata extraction (title, author, cover)

### 🤖 AI-Powered Analysis
- **Multiple LLM Options:**
  - Claude (Anthropic)
  - ChatGPT (OpenAI)
  - NanoGPT
  - Ollama (free local models)
- Character identification and tracking
- Scene description generation
- Visual consistency management

### 🎨 Image Generation
- **Multiple Image Models:**
  - Stable Diffusion
  - DALL-E 3
  - Extensible for other models
- Style presets: Fantasy, Sci-Fi, Western, Thriller, Horror, Romance, etc.
- Configurable storyboard density (per paragraph, per chapter, etc.)
- Character consistency across all images
- Setting/location visual continuity

### 🖼️ Reading Experience
- Beautiful bookcase library view
- Synchronized text and storyboards
- Image zoom and lightbox
- Chapter/scene navigation
- Toggle storyboards on/off

### ✏️ Customization
- Regenerate individual storyboards
- Provide feedback for improvements
- Version history for each storyboard
- Custom style instructions
- Resolution options (720x720, 1080x1080)

### 🔐 Privacy & Security
- Self-hosted (your data stays with you)
- User-provided API keys (control your costs)
- Encrypted API key storage
- Local authentication + Google SSO
- NSFW content detection

---

## 🏗️ Architecture

VividPages uses a modern microservices architecture:

```
Frontend (React PWA) → API (Node.js/Express) → Workers (Background Processing)
                            ↓
        PostgreSQL + pgvector, Redis, MinIO (Object Storage)
                            ↓
        External APIs: Claude, ChatGPT, DALL-E, Stable Diffusion, Ollama
```

**Tech Stack:**
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, PWA
- **Backend:** Node.js 20, Express, TypeScript
- **Database:** PostgreSQL 15 + pgvector
- **Queue:** BullMQ + Redis
- **Storage:** MinIO (S3-compatible)
- **Proxy:** Caddy 2 (automatic HTTPS)
- **Deployment:** Docker Compose

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- 8GB RAM minimum (16GB recommended)
- 50GB+ disk space
- API keys (optional: can use free Ollama)

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/vividpages.git
cd vividpages

# Copy and configure environment
cp .env.example .env
nano .env  # Add your configuration

# Start services
docker-compose up -d

# Run database migrations
docker-compose exec api pnpm db:migrate

# Access the app
# Frontend: http://localhost:3000
# API: http://localhost:4000
```

### First Time Setup

1. Create an account (local or Google SSO)
2. Add your API keys (Settings → API Keys)
3. Upload an EPUB book
4. Configure generation settings (LLM, image model, style, density)
5. Submit and wait for processing
6. Enjoy your VividPage!

---

## 📖 Documentation

Comprehensive documentation is available in the `/docs` folder:

1. [Project Requirements](./docs/01-PROJECT-REQUIREMENTS.md) - Features, use cases, scope
2. [Technical Architecture](./docs/02-TECHNICAL-ARCHITECTURE.md) - System design and components
3. [Technology Stack](./docs/03-TECHNOLOGY-STACK.md) - Libraries and tools
4. [Database Schema](./docs/04-DATABASE-SCHEMA.md) - Data models and relationships
5. [Development Phases](./docs/05-DEVELOPMENT-PHASES.md) - Implementation roadmap
6. [Security & API Keys](./docs/06-SECURITY-API-KEYS.md) - Security best practices
7. [Docker Deployment](./docs/07-DOCKER-DEPLOYMENT.md) - Setup and operations

---

## 🎯 Roadmap

### Phase 0: Foundation (Weeks 1-2) ✅
- Project setup and Docker environment

### Phase 1: Authentication (Weeks 3-6) 🔄
- User registration and login
- Google SSO integration
- API key management

### Phase 2: EPUB Processing (Weeks 7-10) 📅
- File upload and parsing
- Scene detection
- Job queue system

### Phase 3: LLM Integration (Weeks 11-16) 📅
- Character identification
- Scene analysis
- Consistency tracking

### Phase 4: Image Generation (Weeks 17-24) 📅
- Storyboard creation
- Character consistency
- Style presets

### Phase 5: Refinement (Weeks 25-28) 📅
- Storyboard regeneration
- Version history
- UI polish

### Phase 6: Production (Weeks 29-31) 📅
- Testing and optimization
- Documentation
- Deployment

**Target Launch:** December 2026

---

## 🛠️ Development

### Setup Development Environment

```bash
# Install dependencies
cd frontend && pnpm install
cd ../backend && pnpm install

# Start services in development mode
docker-compose up -d

# Watch logs
docker-compose logs -f
```

### Running Tests

```bash
# Backend tests
cd backend && pnpm test

# Frontend tests
cd frontend && pnpm test
```

### Database Operations

```bash
# Create migration
docker-compose exec api pnpm db:generate

# Run migrations
docker-compose exec api pnpm db:migrate

# Open database shell
docker-compose exec postgres psql -U vividpages vividpages
```

---

## 🔒 Security

VividPages takes security seriously:

- **API Keys:** Encrypted at rest using AES-256-GCM
- **Passwords:** Hashed with bcrypt (cost factor 10)
- **Authentication:** JWT tokens with secure headers
- **HTTPS:** Enforced via Caddy with Let's Encrypt
- **Input Validation:** All user inputs sanitized
- **Rate Limiting:** Protection against abuse
- **Updates:** Regular dependency security audits

See [Security Documentation](./docs/06-SECURITY-API-KEYS.md) for details.

---

## 💰 Cost Considerations

VividPages is **free and open source**, but generating storyboards requires API calls:

### Estimated Costs (300-page novel, 200 storyboards)
- **LLM Analysis:**
  - Claude Opus: ~$5-10
  - ChatGPT-4: ~$3-7
  - Ollama (local): Free!

- **Image Generation:**
  - DALL-E 3: $8-16
  - Stable Diffusion API: $2-5
  - Local Stable Diffusion: Free (requires GPU)

**Recommendation:** Start with Ollama + local Stable Diffusion for free processing, upgrade to premium APIs for better quality.

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) first.

### Areas We Need Help
- Testing with various EPUB formats
- Prompt engineering for better consistency
- UI/UX improvements
- Documentation
- New LLM/image model integrations
- Performance optimization

---

## 📜 License

VividPages is released under the [MIT License](./LICENSE).

---

## ⚖️ Legal

- **Copyright:** EPUBs must be legally obtained. VividPages is for personal use only.
- **Age Restriction:** 18+ due to potential adult content in books
- **NSFW:** Content detection and filtering available
- **API Terms:** Users must comply with third-party API terms of service

---

## 🙏 Acknowledgments

Built with:
- [React](https://react.dev/) - UI framework
- [Node.js](https://nodejs.org/) - Backend runtime
- [PostgreSQL](https://www.postgresql.org/) - Database
- [Drizzle ORM](https://orm.drizzle.team/) - Type-safe ORM
- [BullMQ](https://bullmq.io/) - Job queue
- [Caddy](https://caddyserver.com/) - Reverse proxy
- [Anthropic Claude](https://www.anthropic.com/) - LLM
- [OpenAI](https://openai.com/) - LLM & Image generation
- [Ollama](https://ollama.ai/) - Local LLM
- And many more amazing open source projects

---

## 📧 Contact

- **Issues:** [GitHub Issues](https://github.com/yourusername/vividpages/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/vividpages/discussions)

---

## ⭐ Star History

If you find VividPages useful, please star the repository!

---

**Status:** 📝 Planning Complete | 🔨 Development Starting Soon
**Version:** 1.0-alpha
**Last Updated:** October 31, 2025

---

*Made with ❤️ for book lovers who want to see their stories come alive.*
