# VividPages - Phased Development & Deployment Guide

**Version:** 1.0
**Date:** October 31, 2025
**Target Completion:** December 2026

---

## Development Philosophy

This guide breaks the project into **6 major phases**, each with clear deliverables and testing criteria. Each phase builds upon the previous one, allowing for incremental development and testing.

**Key Principles:**
- ✅ Each phase must be fully functional before moving to the next
- ✅ Commit to git after completing each sub-task
- ✅ Test thoroughly at phase boundaries
- ✅ Docker-first development from day one
- ✅ No "big bang" integration - continuous integration

---

## Timeline Overview

```
Phase 0: Foundation (Weeks 1-2)     ████░░░░░░░░░░░░░░░░
Phase 1: Auth & Core (Weeks 3-6)   ░░░░████████░░░░░░░░░░
Phase 2: EPUB Processing (Weeks 7-10) ░░░░░░░░████████░░░░
Phase 3: LLM Integration (Weeks 11-16) ░░░░░░░░░░░████████
Phase 4: Image Gen (Weeks 17-24)   ░░░░░░░░░░░░░░░████████
Phase 5: Polish & Deploy (Weeks 25-28) ░░░░░░░░░░░░░░░░░░████

Total: ~28 weeks (7 months)
Buffer: 5 months for testing, refinement, real-world use
```

---

## Phase 0: Foundation & Setup

**Duration:** 2 weeks
**Goal:** Set up the development environment, git repository, Docker, and basic project structure.

### Tasks

#### 0.1: Repository Initialization
- [ ] Initialize git repository
- [ ] Create `.gitignore` for Node.js, Docker, env files
- [ ] Set up branch strategy (main, develop)
- [ ] Create initial README.md
- [ ] Add LICENSE file

```bash
git init
git add .
git commit -m "Initial commit: Project structure"
```

#### 0.2: Project Structure
- [ ] Create folder structure:
  ```
  vividpages/
  ├── frontend/
  ├── backend/
  ├── docker/
  ├── docs/
  └── docker-compose.yml
  ```
- [ ] Initialize package.json for frontend and backend
- [ ] Set up TypeScript configs
- [ ] Configure ESLint and Prettier

#### 0.3: Docker Environment
- [ ] Create docker-compose.yml
- [ ] Set up PostgreSQL service
- [ ] Set up Redis service
- [ ] Set up MinIO service
- [ ] Create Dockerfiles for frontend and backend
- [ ] Test docker-compose up

#### 0.4: Database Setup
- [ ] Install pgvector extension in PostgreSQL
- [ ] Set up Drizzle ORM
- [ ] Create initial schema files
- [ ] Run first migration
- [ ] Verify database connectivity

#### 0.5: Basic API Scaffold
- [ ] Set up Express server
- [ ] Add basic middleware (helmet, cors)
- [ ] Create health check endpoint
- [ ] Test API responds

#### 0.6: Basic Frontend Scaffold
- [ ] Set up Vite + React + TypeScript
- [ ] Configure Tailwind CSS
- [ ] Create basic routing
- [ ] Add PWA configuration
- [ ] Test frontend loads

**Deliverable:** Running Docker environment with database, basic API, and frontend.

**Testing:**
```bash
# All services start successfully
docker-compose up

# API health check responds
curl http://localhost:4000/api/health

# Frontend loads
curl http://localhost:3000
```

**Git Commit:** "Phase 0 complete: Foundation and setup"

---

## Phase 1: Authentication & User Management

**Duration:** 4 weeks
**Goal:** Implement complete user authentication system with local login and Google SSO.

### Tasks

#### 1.1: User Registration & Login (Local)
- [ ] Create users table migration
- [ ] Implement registration endpoint
  - Email validation
  - Password hashing (bcrypt)
  - User creation
- [ ] Implement login endpoint
  - Credential validation
  - JWT token generation
- [ ] Create auth middleware
- [ ] Test registration and login flow

#### 1.2: JWT Authentication
- [ ] JWT token signing and verification
- [ ] Refresh token strategy (optional)
- [ ] Protected route middleware
- [ ] Token expiration handling

#### 1.3: Google SSO Integration
- [ ] Set up Google OAuth credentials
- [ ] Implement OAuth flow
- [ ] Link Google accounts to users
- [ ] Handle new user creation from SSO

#### 1.4: Frontend Authentication UI
- [ ] Login page
- [ ] Registration page
- [ ] Google SSO button
- [ ] Auth state management (Zustand)
- [ ] Protected routes
- [ ] Logout functionality

#### 1.5: User Profile
- [ ] Get user profile endpoint
- [ ] Update profile endpoint
- [ ] Frontend profile page
- [ ] Avatar upload (optional)

#### 1.6: Sessions & Security
- [ ] Rate limiting on auth endpoints
- [ ] CSRF protection
- [ ] Secure cookie configuration
- [ ] Password reset flow (optional for V1)

**Deliverable:** Full authentication system with local and Google login.

**Testing:**
- [ ] Register new user successfully
- [ ] Login with email/password
- [ ] Login with Google
- [ ] Access protected endpoints with token
- [ ] Rejected without token
- [ ] Logout clears session

**Git Commit:** "Phase 1 complete: Authentication system"

---

## Phase 2: EPUB Processing

**Duration:** 4 weeks
**Goal:** Parse EPUB files and extract structured content.

### Tasks

#### 2.1: File Upload System
- [ ] EPUB upload endpoint (multipart/form-data)
- [ ] File validation (max size, .epub extension)
- [ ] Store EPUB in MinIO
- [ ] Frontend upload component with drag-and-drop

#### 2.2: EPUB Parser Worker
- [ ] Create job queue system (BullMQ)
- [ ] Implement EPUB processing worker
  - Parse EPUB structure
  - Extract metadata (title, author)
  - Extract cover image
  - Parse chapters and text content
- [ ] Store parsed data in database

#### 2.3: Scene Detection
- [ ] Implement scene break detection
  - Chapter boundaries
  - Paragraph breaks
  - Dialogue grouping
- [ ] Create scenes table
- [ ] Store scenes with metadata

#### 2.4: Job Status Tracking
- [ ] Job creation endpoint
- [ ] Job status endpoint
- [ ] Progress updates from worker
- [ ] Frontend job progress UI
- [ ] WebSocket for real-time updates

#### 2.5: VividPage Creation
- [ ] Create VividPage record on upload
- [ ] Link to user
- [ ] Store generation settings
- [ ] Display in user's bookcase

#### 2.6: Bookcase UI
- [ ] Display user's VividPages
- [ ] Show processing status
- [ ] Thumbnail grid view
- [ ] Click to view details

**Deliverable:** Users can upload EPUBs and see parsed content.

**Testing:**
- [ ] Upload small EPUB (10-20 pages)
- [ ] Worker processes successfully
- [ ] Chapters and scenes extracted
- [ ] VividPage appears in bookcase
- [ ] Status updates in real-time

**Git Commit:** "Phase 2 complete: EPUB processing"

---

## Phase 3: LLM Integration & Analysis

**Duration:** 6 weeks
**Goal:** Integrate LLMs to analyze book content and extract character/scene data.
**Status:** 🟡 IN PROGRESS (1/10 tasks complete)

### Tasks

#### 3.1: API Key Management ✅ COMPLETE
- [x] Create API keys table
- [x] Encryption/decryption utilities (AES-256-GCM)
- [x] Add API key endpoints (CRUD)
- [x] Frontend API key management UI
- [x] Secure storage in database
- [x] Provider-specific validation (Claude, ChatGPT, Ollama, DALL-E, Stable Diffusion)
- [x] Test API key functionality

#### 3.2: LLM Client Abstraction
- [ ] Create LLM service interface
- [ ] Implement Claude client
- [ ] Implement ChatGPT client
- [ ] Implement Ollama client
- [ ] Unified API for all clients

#### 3.3: Character Discovery
- [ ] Prompt engineering for character extraction
- [ ] Full book analysis pass
- [ ] Extract character names and descriptions
- [ ] Create character records
- [ ] Store in characters table

#### 3.4: Character Embedding Generation
- [ ] Generate embeddings for character descriptions
- [ ] Store in character_embeddings table (pgvector)
- [ ] Test similarity search

#### 3.5: Scene-by-Scene Analysis
- [ ] For each scene:
  - Identify present characters
  - Detect setting/location
  - Generate scene description
  - Note visual elements
- [ ] Store analysis in scenes.llm_analysis

#### 3.6: Setting/Location Detection
- [ ] Extract locations from scenes
- [ ] Create settings table records
- [ ] Generate setting embeddings
- [ ] Link scenes to settings

#### 3.7: Character Change Tracking
- [ ] Detect character changes (outfit, injury, etc.)
- [ ] Create character_changes records
- [ ] Link to scenes
- [ ] Generate prompt modifiers

#### 3.8: Image Prompt Generation
- [ ] Assemble detailed image prompts
- [ ] Include character descriptions
- [ ] Include setting details
- [ ] Apply consistency keywords
- [ ] Store prompts in scene data

#### 3.9: LLM Worker Implementation
- [ ] Create LLM analysis worker
- [ ] Queue jobs after EPUB processing
- [ ] Progress tracking
- [ ] Error handling and retries
- [ ] Completion notification

#### 3.10: Frontend Model Selection
- [ ] Wizard step: Select LLM
- [ ] Display available models
- [ ] Check user has required API key
- [ ] Pass to backend

**Deliverable:** Books analyzed with characters and scenes identified.

**Testing:**
- [ ] Upload EPUB with clear characters
- [ ] LLM identifies main characters
- [ ] Character descriptions accurate
- [ ] Scenes linked to characters
- [ ] Settings identified
- [ ] Image prompts generated

**Git Commit:** "Phase 3 complete: LLM analysis"

---

## Phase 4: Image Generation & Storyboards

**Duration:** 8 weeks (most complex phase)
**Goal:** Generate storyboard images with consistency.

### Tasks

#### 4.1: Image Generation Client Abstraction
- [ ] Create image service interface
- [ ] Implement Stable Diffusion client
- [ ] Implement DALL-E client
- [ ] Test API connections

#### 4.2: Style Presets
- [ ] Define style templates (fantasy, scifi, western, etc.)
- [ ] Prompt modifiers for each style
- [ ] Frontend style selection UI
- [ ] Store in VividPage settings

#### 4.3: Character Consistency System
- [ ] Load character reference data
- [ ] Include character tags in prompts
- [ ] Use embeddings for similarity (if supported by API)
- [ ] Test consistency across multiple images

#### 4.4: Setting Consistency
- [ ] Load setting data for scene
- [ ] Include setting keywords in prompts
- [ ] Test location consistency

#### 4.5: Prompt Assembly & Engineering
- [ ] Build final prompts from:
  - Scene description
  - Character data
  - Setting data
  - Style preset
  - Consistency keywords
- [ ] Test prompt quality

#### 4.6: Image Generation Worker
- [ ] Create image generation worker
- [ ] Fetch user's image API key
- [ ] Call image generation API
- [ ] Download generated image
- [ ] Save to MinIO

#### 4.7: Image Optimization
- [ ] Compress images (Sharp)
- [ ] Generate thumbnails
- [ ] Store multiple resolutions
- [ ] Optimize file sizes

#### 4.8: NSFW Detection (Optional)
- [ ] Implement NSFW.js
- [ ] Check generated images
- [ ] Flag NSFW content
- [ ] Notify user if API doesn't support

#### 4.9: Storyboard Storage
- [ ] Create storyboards table records
- [ ] Store image paths
- [ ] Store prompts used
- [ ] Link to scenes

#### 4.10: Batch Processing
- [ ] Process multiple images in parallel
- [ ] Queue management
- [ ] Progress tracking per image
- [ ] Handle rate limits

#### 4.11: Generation Configuration UI
- [ ] Wizard: Image model selection
- [ ] Wizard: Storyboard density
- [ ] Wizard: Speaking character toggle
- [ ] Wizard: Image resolution
- [ ] Review and submit

#### 4.12: Storyboard Viewing UI
- [ ] Display storyboards alongside text
- [ ] Chapter navigation
- [ ] Scene navigation
- [ ] Image lightbox/zoom
- [ ] Toggle storyboards on/off

**Deliverable:** Complete VividPage with generated storyboards.

**Testing:**
- [ ] Generate VividPage for short book
- [ ] All storyboards generated successfully
- [ ] Characters look consistent
- [ ] Settings look consistent
- [ ] Style applied correctly
- [ ] Can view in reading UI

**Git Commit:** "Phase 4 complete: Image generation"

---

## Phase 5: Storyboard Regeneration & Editing

**Duration:** 3 weeks
**Goal:** Allow users to regenerate and improve storyboards.

### Tasks

#### 5.1: Regeneration Backend
- [ ] Regenerate storyboard endpoint
- [ ] Accept original prompt + user feedback
- [ ] Create regeneration job
- [ ] Image generation with modified prompt
- [ ] Save to storyboard_history
- [ ] Update storyboard with new version

#### 5.2: Regeneration UI
- [ ] "Regenerate" button on storyboards
- [ ] Feedback input modal
- [ ] Show regeneration progress
- [ ] Display old vs new versions
- [ ] Accept/reject new version

#### 5.3: Version History
- [ ] Display previous versions
- [ ] Restore previous version
- [ ] Delete versions

#### 5.4: Bulk Regeneration (Optional)
- [ ] Regenerate multiple storyboards
- [ ] Batch jobs

**Deliverable:** Users can refine storyboards.

**Testing:**
- [ ] Regenerate single storyboard
- [ ] Feedback applied correctly
- [ ] New version saved
- [ ] Can switch between versions

**Git Commit:** "Phase 5 complete: Storyboard regeneration"

---

## Phase 6: Polish, Testing & Deployment

**Duration:** 4 weeks
**Goal:** Production-ready application.

### Tasks

#### 6.1: Error Handling
- [ ] Comprehensive error handling in all workers
- [ ] User-friendly error messages
- [ ] Retry logic for API failures
- [ ] Dead letter queue for failed jobs

#### 6.2: Logging & Monitoring
- [ ] Winston structured logging
- [ ] Log levels (debug, info, warn, error)
- [ ] Log aggregation (optional)
- [ ] Health check improvements

#### 6.3: Performance Optimization
- [ ] Database query optimization
- [ ] Add missing indexes
- [ ] Frontend code splitting
- [ ] Image lazy loading
- [ ] Caching strategy

#### 6.4: Security Hardening
- [ ] Security headers (Helmet)
- [ ] Rate limiting on all endpoints
- [ ] Input validation everywhere
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] CSRF protection

#### 6.5: PWA Enhancements
- [ ] Service worker caching
- [ ] Offline support
- [ ] Add to home screen prompt
- [ ] App icons and splash screens

#### 6.6: Documentation
- [ ] API documentation
- [ ] User guide
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] Update README

#### 6.7: Testing
- [ ] End-to-end testing with real EPUBs
- [ ] Test all LLM providers
- [ ] Test all image providers
- [ ] Mobile testing
- [ ] Browser compatibility
- [ ] Load testing (optional)

#### 6.8: Deployment Preparation
- [ ] Production docker-compose.yml
- [ ] Environment variable documentation
- [ ] Backup scripts
- [ ] Update scripts
- [ ] SSL/HTTPS setup guide

#### 6.9: Legal & Compliance
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Copyright disclaimer
- [ ] Age verification (18+)
- [ ] NSFW warning system

#### 6.10: Final Polish
- [ ] UI/UX refinements
- [ ] Loading states
- [ ] Empty states
- [ ] Error states
- [ ] Animations and transitions
- [ ] Responsive design fixes

**Deliverable:** Production-ready VividPages application.

**Testing:**
- [ ] Complete generation workflow end-to-end
- [ ] All features working
- [ ] No critical bugs
- [ ] Performance acceptable
- [ ] Security scan passed

**Git Commit:** "Phase 6 complete: Production ready"

---

## Ollama Integration (Runs Parallel to Phase 3-4)

Since Ollama is self-hosted, it requires additional setup.

### Tasks
- [ ] Add Ollama service to docker-compose
- [ ] Configure with default models
- [ ] Test LLM calls to Ollama
- [ ] Test local image generation (if using Stable Diffusion locally)
- [ ] Document model installation for users

**Ollama Docker Service:**
```yaml
ollama:
  image: ollama/ollama:latest
  container_name: vividpages-ollama
  volumes:
    - ollama-data:/root/.ollama
  ports:
    - "11434:11434"
```

---

## Git Workflow

### Branching Strategy
- `main` - Production-ready code
- `develop` - Integration branch
- `feature/phase-X` - Phase-specific branches

### Commit Guidelines
- Commit at end of each sub-task
- Descriptive commit messages
- Reference phase in commit: "Phase 2.3: Scene detection"

### Example Flow
```bash
git checkout -b feature/phase-1
# ... work on Phase 1 ...
git add .
git commit -m "Phase 1.1: User registration and login"
# ... continue ...
git commit -m "Phase 1 complete: Authentication system"
git checkout develop
git merge feature/phase-1
git push origin develop
```

---

## Testing Strategy

### Per Phase Testing
After each phase:
1. Run manual tests
2. Verify all features work
3. Check for regressions
4. Update documentation

### End-to-End Testing
Before final deployment:
1. Fresh database
2. Create user
3. Upload real EPUB
4. Generate complete VividPage
5. Regenerate storyboards
6. Verify all features

### Test EPUBs
Use variety of books:
- Short story (10-20 pages)
- Novella (100 pages)
- Full novel (300+ pages)
- Different genres (fantasy, scifi, thriller)

---

## Deployment Checklist

### Pre-Deployment
- [ ] All phases complete
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Environment variables documented
- [ ] Backup strategy in place

### Deployment Steps
1. Clone repository to server
2. Copy `.env.example` to `.env`
3. Configure environment variables
4. Run `docker-compose up -d`
5. Run database migrations
6. Verify all services running
7. Test health checks
8. Create first user
9. Test complete workflow

### Post-Deployment
- [ ] Monitor logs
- [ ] Check disk usage
- [ ] Set up automated backups
- [ ] Document any issues
- [ ] Plan for updates

---

## Risk Mitigation

### Common Issues & Solutions

**Issue:** API rate limits hit during generation
**Solution:** Implement exponential backoff, queue throttling

**Issue:** Large EPUBs cause memory issues
**Solution:** Stream processing, chunking

**Issue:** Image generation too slow
**Solution:** Parallel workers, queue optimization

**Issue:** Storage fills up quickly
**Solution:** Image compression, cleanup old files

**Issue:** Character consistency poor
**Solution:** Refine prompts, use reference images, better embeddings

---

## Success Criteria

**Phase 0:** Docker environment runs
**Phase 1:** Can register, login, logout
**Phase 2:** Can upload EPUB and see chapters
**Phase 3:** Characters and scenes identified by LLM
**Phase 4:** Complete VividPage with storyboards generated
**Phase 5:** Can regenerate storyboards
**Phase 6:** Production-ready, deployed, tested

**Final Goal:** User can go from EPUB upload to reading with storyboards in under 2 hours (for average novel).

---

## Timeline Flexibility

**If ahead of schedule:**
- Add nice-to-have features
- Extra polish and testing
- Performance optimization
- Additional LLM/image model support

**If behind schedule:**
- Focus on core workflow
- Defer nice-to-have features to V2
- Simplify UI (function over form)
- Reduce supported models (focus on Claude + DALL-E)

---

## Phase Summary

| Phase | Duration | Key Deliverable |
|-------|----------|----------------|
| 0 | 2 weeks | Development environment |
| 1 | 4 weeks | Authentication system |
| 2 | 4 weeks | EPUB processing |
| 3 | 6 weeks | LLM analysis |
| 4 | 8 weeks | Image generation |
| 5 | 3 weeks | Regeneration |
| 6 | 4 weeks | Production ready |
| **Total** | **31 weeks** | **Deployed VividPages** |

**Buffer:** 21 weeks until December 2026 for testing, refinement, and real-world usage.

---

## Next Steps

1. Begin Phase 0: Foundation & Setup
2. Initialize git repository
3. Set up Docker environment
4. Create project structure

**Status:** ✅ Development Plan Complete
**Next Document:** Security & API Key Management
