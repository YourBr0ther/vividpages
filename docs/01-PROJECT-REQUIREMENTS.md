# VividPages - Project Requirements Document (PRD)

**Version:** 1.0
**Date:** October 31, 2025
**Target Launch:** December 2026

---

## Executive Summary

VividPages is a self-hosted web application (PWA) that transforms EPUB books into immersive visual experiences by generating AI-powered storyboard images for each scene, paragraph, or speaking part. The app makes reading more accessible and engaging for visual learners and those who struggle with long-form text.

---

## Problem Statement

Many readers struggle to:
- Visualize complex scenes and worlds described in books
- Maintain focus during long reading sessions with text-only content
- Imagine what beloved book worlds look like before adaptations exist
- Engage with dense narrative text for extended periods

**Solution:** VividPages generates contextually accurate, visually consistent storyboards that bring book scenes to life while maintaining character and setting continuity throughout the story.

---

## Target Users

**Primary Audience:**
- Visual learners who struggle with text-only content
- Book enthusiasts who want deeper immersion
- Readers with attention challenges
- Fantasy/sci-fi fans who want to see their favorite worlds visualized

**User Profile:**
- Adults (18+) due to potential NSFW content in source material
- Tech-savvy users comfortable with API keys and self-hosting
- Users willing to invest in API costs for premium services (or use free local models)

---

## Core Features

### 1. Authentication & User Management
- **Local authentication** (username/password)
- **SSO integration** with Google
- Secure API key storage per user
- User profile management

### 2. EPUB Processing & Analysis
- Upload and parse EPUB files
- Automatic character identification and tracking
- Scene and setting detection
- Character attribute tracking (appearance, clothing changes, physical transformations)
- Setting/location consistency mapping
- Dialogue attribution

### 3. AI Model Integration

**LLM Options for Text Analysis:**
- Claude (Anthropic)
- ChatGPT (OpenAI)
- NanoGPT
- Ollama (local models)

**Image Generation Options:**
- Stable Diffusion
- DALL-E (ChatGPT)
- Other compatible models

### 4. Storyboard Generation Wizard
User selects:
- EPUB file
- Visual style (sci-fi, fantasy, western, romance, thriller, horror, etc.)
- LLM for text parsing
- Image generation model
- Storyboard density:
  - Per paragraph
  - Per chapter (condensed)
  - Specific number per chapter
- Speaking character visualization (on/off)
- Image resolution (720x720 or 1080x1080)

### 5. Character & Setting Consistency Engine
- Maintain visual consistency across all storyboards
- Track character changes (outfit changes, injuries, aging, etc.)
- Preserve setting/location visual identity
- Generate character reference sheets
- Scene continuity management

### 6. User Bookcase (Library)
- Display all previously generated VividPages
- Thumbnail previews
- Metadata (book title, author, generation date, settings used)
- Search and filter capabilities
- Quick access to reading view

### 7. Storyboard Viewing & Reading Experience
- Synchronized text and storyboards
- Navigate by chapter/scene
- Zoom on storyboard images
- Toggle storyboards on/off for pure reading

### 8. Storyboard Editing & Regeneration
- Select individual storyboard
- Add correction prompts ("Make the character's hair longer", "Add more snow")
- Regenerate with original prompt + modifications
- Keep history of regenerations
- Accept/reject new versions

### 9. Async Processing
- Submit book for processing
- Background job processing
- Notification system when complete
- Progress tracking
- Ability to queue multiple books

### 10. Content Management
- NSFW content detection
- Warning system for adult content
- API compatibility checks (some APIs block NSFW)
- Fallback suggestions (Ollama for unrestricted content)
- Legal disclaimer for copyright/personal use

---

## Non-Functional Requirements

### Performance
- Support books up to 500,000 words
- Handle 200+ storyboard generations per book
- Responsive UI (< 2s page load)
- Efficient image storage and retrieval

### Security
- Encrypted API key storage
- Secure authentication
- HTTPS only
- Environment variable management for secrets
- API key never exposed to client

### Scalability
- Docker-based deployment
- Modular service architecture
- Database optimization for large datasets
- Efficient vector storage for embeddings

### Reliability
- Error handling for API failures
- Retry logic for failed generations
- Progress persistence (resume interrupted jobs)
- Backup and restore capabilities

### Usability
- Intuitive wizard interface
- Mobile-responsive design (PWA)
- Clear progress indicators
- Helpful error messages

---

## User Flows

### Primary Flow: Generate VividPage

1. User logs in (local or Google SSO)
2. Arrives at bookcase (library view)
3. Clicks "Generate New VividPage"
4. Wizard Step 1: Upload EPUB
5. Wizard Step 2: Select visual style
6. Wizard Step 3: Choose LLM for parsing
7. Wizard Step 4: Choose image generation model
8. Wizard Step 5: Configure storyboard density
9. Wizard Step 6: Enable/disable speaking character visualizations
10. Wizard Step 7: Select image resolution
11. Review and confirm settings
12. Submit for processing
13. Receives confirmation and expected completion time
14. Gets notification when complete
15. Opens VividPage to read

### Secondary Flow: Edit Storyboard

1. User opens existing VividPage
2. Navigates to specific scene
3. Clicks on storyboard image
4. Selects "Regenerate"
5. Adds modification prompt
6. Submits regeneration request
7. Receives notification when complete
8. Reviews options side-by-side
9. Accepts new version or keeps original

---

## Success Metrics

- User successfully generates first VividPage within 30 minutes
- 80% of storyboards require no regeneration
- Average processing time < 2 hours for 300-page book
- Zero API key leaks or security incidents
- 90% user satisfaction with character consistency

---

## Out of Scope (V1)

- Public sharing of VividPages
- Social features (comments, likes, follows)
- Collaborative editing
- Mobile native apps (iOS/Android)
- Book recommendations
- Integration with ebook stores
- Multi-language support (English only for V1)
- Audio narration
- Animation between storyboards
- Cloud storage integration (Dropbox, Google Drive)

---

## Future Considerations (V2+)

- Public gallery and sharing
- Monetization (premium models, hosting service)
- Character voice generation (TTS)
- Animated transitions between scenes
- Export to video/slideshow
- Multi-user hosting (SaaS model)
- Mobile native apps
- Community style templates
- Integration with Calibre or other ebook managers

---

## Technical Constraints

- Self-hosted deployment (Docker Compose)
- User-provided API keys (no centralized billing)
- Local processing where possible
- Git version control required
- Must work on web and mobile browsers (PWA)

---

## Legal & Compliance

- Copyright disclaimer: "For personal use only"
- Age restriction: 18+ due to potential adult content
- Terms of Service required
- Privacy policy (especially for API key storage)
- GDPR considerations if EU users
- API terms compliance (OpenAI, Anthropic, etc.)

---

## Dependencies & Risks

### Dependencies
- Third-party API availability (OpenAI, Anthropic)
- EPUB parsing libraries
- Image generation API rate limits
- Docker infrastructure

### Risks
- API cost unpredictability for users
- API rate limiting affecting generation
- Character consistency challenges with image models
- Large storage requirements
- Processing time expectations vs reality
- NSFW content handling complexity

### Mitigation Strategies
- Clear cost estimates before generation
- Retry logic and rate limit handling
- Advanced prompting techniques for consistency
- Storage optimization and compression
- Progress indicators and realistic time estimates
- Robust content filtering system

---

## Assumptions

- Users have technical capability to self-host Docker applications
- Users are willing to obtain and manage their own API keys
- Users have sufficient storage for image-heavy content
- Internet connection available for API calls
- Modern browser support (Chrome, Firefox, Safari, Edge)

---

## Open Questions

✅ All questions answered in planning session

---

## Approval & Sign-off

**Project Owner:** Chris
**Status:** Approved for Development Planning
**Next Phase:** Technical Architecture & Stack Selection
