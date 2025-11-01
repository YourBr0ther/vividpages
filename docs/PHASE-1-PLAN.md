# Phase 1: Authentication & User Management - Implementation Plan

**Duration:** 4 weeks
**Status:** Ready to begin
**All decisions made:** ✅

---

## Decisions Summary

Based on your requirements, here's what we're implementing:

### ✅ Authentication Strategy

1. **Email Verification:** NO
   - Users can login immediately after registration
   - Simpler, faster onboarding
   - Can add email verification in Phase 6 if needed

2. **Password Reset:** DEFERRED
   - Will implement in Phase 6 (Polish)
   - For now, users can create new account if needed

3. **Google OAuth:** YES
   - Client ID: Configured in `.env`
   - Client Secret: Configured in `.env`
   - Callback URL: `http://localhost:4000/api/auth/google/callback`

4. **JWT Token Strategy:** Simple
   - Single JWT access token
   - 7-day expiration
   - Stored in httpOnly cookie or localStorage
   - No refresh tokens (can add in Phase 6 if needed)

5. **Account Linking:** Auto-link
   - If Google email matches existing local account → merge automatically
   - If local account exists with Google email → allow Google login
   - Seamless experience for users

6. **Password Requirements:** Standard
   ```
   - Minimum 8 characters
   - At least one uppercase letter (A-Z)
   - At least one lowercase letter (a-z)
   - At least one number (0-9)
   - Special characters optional but allowed
   ```

7. **Post-Login Landing:** Bookcase
   - After successful login → redirect to `/bookcase`
   - Show empty state if no VividPages yet
   - Matches natural user flow

8. **API Key Management:** Settings Page
   - Dedicated Settings section in main nav
   - API Keys subsection
   - Can also add keys during VividPage creation wizard

9. **Rate Limits:**
   - General API: 100 requests per 15 minutes
   - Auth endpoints: 5 attempts per 15 minutes
   - Prevents brute force and abuse

10. **Git Workflow:** Main branch
    - Work directly on `main`
    - Commit frequently with clear messages
    - Can switch to feature branches later if needed

---

## What We're Building (Phase 1)

### Backend (API)

#### 1. Database Migrations
- Run initial Drizzle migrations
- Create users, api_keys, sessions tables
- Verify pgvector extension

#### 2. Authentication Utilities
**File:** `backend/src/lib/auth.ts`
- Password hashing (bcrypt)
- Password validation (requirements check)
- JWT token generation
- JWT token verification
- Password strength validator

#### 3. Encryption Utilities
**File:** `backend/src/lib/encryption.ts`
- API key encryption (AES-256-GCM)
- API key decryption
- Secure key storage

#### 4. User Registration Endpoint
**Route:** `POST /api/auth/register`
- Validate email format
- Check email uniqueness
- Validate password requirements
- Hash password
- Create user record
- Generate JWT token
- Return token + user info

#### 5. User Login Endpoint
**Route:** `POST /api/auth/login`
- Validate credentials
- Check password
- Update last login timestamp
- Generate JWT token
- Return token + user info

#### 6. Google OAuth Flow
**Routes:**
- `GET /api/auth/google` - Initiate OAuth
- `GET /api/auth/google/callback` - Handle callback

**Logic:**
- Exchange code for Google token
- Fetch user info from Google
- Check if user exists (by Google ID or email)
- If exists: login
- If new: create account
- If email matches local account: link accounts
- Generate JWT token
- Redirect to frontend with token

#### 7. Auth Middleware
**File:** `backend/src/api/middleware/auth.ts`
- Extract JWT from headers
- Verify JWT signature
- Decode payload
- Attach user to request
- Handle expired tokens
- Handle invalid tokens

#### 8. Get Current User Endpoint
**Route:** `GET /api/auth/me`
- Protected route (requires auth)
- Return current user info
- Used for session restoration

#### 9. Logout Endpoint
**Route:** `POST /api/auth/logout`
- Clear session (if using session storage)
- Return success
- Frontend handles token removal

#### 10. Rate Limiting Middleware
**File:** `backend/src/api/middleware/rateLimiter.ts`
- General API limiter (100/15min)
- Auth limiter (5/15min)
- Redis-backed storage
- Per-IP tracking

---

### Frontend (React)

#### 1. Auth Context/Store
**File:** `frontend/src/lib/auth.tsx`
- Zustand store for auth state
- Current user
- Token management
- Login/logout functions
- Session persistence

#### 2. API Client
**File:** `frontend/src/lib/api.ts`
- Axios instance with interceptors
- Automatic token injection
- Error handling
- Token refresh (if needed)

#### 3. Login Page
**Route:** `/login`
**Features:**
- Email + password form
- Input validation
- Error messages
- "Login with Google" button
- Link to register page
- Remember me (optional)

#### 4. Register Page
**Route:** `/register`
**Features:**
- Email + password + confirm password
- Real-time password strength indicator
- Password requirements checklist
- Input validation
- Error messages
- "Sign up with Google" button
- Link to login page

#### 5. Protected Route Component
**File:** `frontend/src/components/ProtectedRoute.tsx`
- Check authentication status
- Redirect to login if not authenticated
- Show loading state while checking
- Wrap protected pages

#### 6. Auth Callback Page
**Route:** `/auth/callback`
- Handle OAuth redirects
- Extract token from URL
- Store token
- Redirect to bookcase

#### 7. Navigation Component
**File:** `frontend/src/components/Navigation.tsx`
- Show different nav based on auth status
- Logout button
- User avatar/name
- Links to main sections

#### 8. Bookcase Page (Empty State)
**Route:** `/bookcase`
- Protected route
- Welcome message
- "No VividPages yet" state
- "Generate New VividPage" button (disabled for now)
- Nice empty state illustration

#### 9. Settings Page (Skeleton)
**Route:** `/settings`
- Protected route
- User profile section
- API Keys section (Phase 1)
- Other settings (placeholder)

#### 10. API Keys Management
**Component:** Part of Settings
**Features:**
- List user's API keys
- Add new API key
- Delete API key
- Provider selection (Claude, OpenAI, etc.)
- Nickname for each key
- Never display actual keys (security)

---

## File Structure (Phase 1)

```
backend/src/
├── api/
│   ├── routes/
│   │   └── auth.ts              # Auth endpoints
│   ├── middleware/
│   │   ├── auth.ts              # JWT verification
│   │   └── rateLimiter.ts       # Rate limiting
│   └── server.ts                # Updated with auth routes
├── lib/
│   ├── auth.ts                  # Auth utilities
│   └── encryption.ts            # Encryption utilities
└── db/
    └── migrations/              # Generated by Drizzle

frontend/src/
├── pages/
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── Bookcase.tsx
│   ├── Settings.tsx
│   └── AuthCallback.tsx
├── components/
│   ├── Navigation.tsx
│   ├── ProtectedRoute.tsx
│   └── ApiKeyManager.tsx
├── lib/
│   ├── auth.tsx                 # Auth store (Zustand)
│   └── api.ts                   # Axios client
└── App.tsx                      # Updated with routes
```

---

## Implementation Order

### Week 1: Backend Auth Foundation
1. Run database migrations
2. Create auth utilities (password, JWT)
3. Implement registration endpoint
4. Implement login endpoint
5. Create auth middleware
6. Test with curl/Postman

### Week 2: Google OAuth & Protection
1. Implement Google OAuth flow
2. Add account linking logic
3. Implement /api/auth/me endpoint
4. Add rate limiting
5. Test OAuth flow
6. Integration testing

### Week 3: Frontend Auth UI
1. Set up React Router
2. Create auth context/store
3. Build Login page
4. Build Register page
5. Build OAuth callback handler
6. Test login/register flows

### Week 4: Protected Pages & Polish
1. Create ProtectedRoute component
2. Build Bookcase page (empty state)
3. Build Settings page skeleton
4. Build API Key management UI
5. Add Navigation component
6. End-to-end testing
7. UI polish and error handling

---

## Testing Checklist

**Backend:**
- [ ] User can register with valid credentials
- [ ] Registration fails with weak password
- [ ] Registration fails with duplicate email
- [ ] User can login with correct credentials
- [ ] Login fails with wrong password
- [ ] JWT token is generated correctly
- [ ] Protected endpoints require valid token
- [ ] Invalid/expired tokens are rejected
- [ ] Google OAuth flow works end-to-end
- [ ] Account linking works (Google email matches local)
- [ ] Rate limiting blocks after 5 failed attempts

**Frontend:**
- [ ] Login form validates inputs
- [ ] Registration form validates inputs
- [ ] Password strength indicator works
- [ ] Google OAuth button redirects correctly
- [ ] Token is stored after successful login
- [ ] Protected routes redirect to login when not authenticated
- [ ] User info loads on page refresh
- [ ] Logout clears token and redirects
- [ ] Bookcase shows for authenticated users
- [ ] API key can be added/deleted

---

## Success Criteria

Phase 1 is complete when:

1. ✅ Users can register with email/password
2. ✅ Users can login with email/password
3. ✅ Users can login with Google OAuth
4. ✅ JWT authentication working on all endpoints
5. ✅ Protected routes redirect unauthenticated users
6. ✅ Bookcase page displays after login
7. ✅ Settings page accessible
8. ✅ API keys can be managed in Settings
9. ✅ All auth flows tested and working
10. ✅ Code committed to GitHub

---

## Environment Variables (Already Configured)

```bash
JWT_SECRET=<configured in .env>
ENCRYPTION_KEY=<configured in .env>
GOOGLE_CLIENT_ID=<configured in .env>
GOOGLE_CLIENT_SECRET=<configured in .env>
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
```

✅ All secrets configured and ready!

---

## Dependencies (Already Installed)

**Backend:**
- ✅ bcrypt - Password hashing
- ✅ jsonwebtoken - JWT tokens
- ✅ passport - OAuth framework
- ✅ passport-google-oauth20 - Google strategy
- ✅ express-validator - Input validation
- ✅ express-rate-limit - Rate limiting
- ✅ crypto-js - API key encryption

**Frontend:**
- ✅ zustand - State management
- ✅ axios - HTTP client
- ✅ react-router-dom - Routing
- ✅ react-hot-toast - Notifications

---

## Notes

### Security Considerations
- Passwords hashed with bcrypt (cost factor 10)
- JWT tokens signed with strong secret
- API keys encrypted at rest (AES-256-GCM)
- Rate limiting prevents brute force
- HTTPS enforced in production

### User Experience
- No email verification = faster onboarding
- Google OAuth = one-click signup
- Auto-linking = seamless experience
- Clear error messages
- Password strength feedback

### Future Enhancements (Phase 6)
- Email verification
- Password reset flow
- Refresh tokens
- 2FA/MFA
- Session management dashboard
- Account deletion

---

## Ready to Start?

All decisions made ✅
All configuration complete ✅
All dependencies installed ✅

**Next step:** Begin Week 1 implementation!

---

**Created:** October 31, 2025
**Last Updated:** October 31, 2025
