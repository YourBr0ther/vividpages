# Quick Start Testing Guide

## Your VividPages Application is Ready! ✅

All services are running and Phase 1 authentication is complete.

---

## Access the Application

**From your client machine (10.0.2.177), open your browser and navigate to:**

```
http://10.0.2.180:3000
```

**Note:** The server is at `10.0.2.180`, not `localhost`.

---

## Test Credentials

A demo account has been created for testing:

**Email:** demo@vividpages.com
**Password:** Demo1234

---

## What to Test

### 1. Registration Flow
1. Go to http://localhost:3000/register
2. Fill out the form with a new email
3. Watch the password strength indicator (must be "Strong" to submit)
4. Click "Create Account"
5. You should be redirected to your bookcase

### 2. Login Flow
1. Go to http://localhost:3000/login
2. Enter credentials:
   - Email: demo@vividpages.com
   - Password: Demo1234
3. Click "Sign In"
4. You should be redirected to your bookcase

### 3. Google OAuth Flow
1. On login or register page
2. Click "Sign in with Google" button
3. You'll be redirected to Google's consent screen
4. Authorize VividPages
5. You'll be redirected back and logged in automatically

### 4. Navigation
1. After logging in, check the top navigation bar
2. Click on your avatar/name to see the dropdown menu
3. Try navigating to Settings
4. Try the Sign out button

### 5. Session Persistence
1. Log in successfully
2. Refresh the page (F5)
3. You should remain logged in
4. Open browser DevTools → Application → Local Storage
5. You should see "vividpages-auth" with your token

### 6. Protected Routes
1. While logged out, try visiting: http://localhost:3000/bookcase
2. You should be redirected to /login
3. Log in
4. Try visiting: http://localhost:3000/settings
5. You should see your profile information

---

## API Endpoints for Testing

### Health Check
```bash
curl http://localhost:4000/api/health
```

### Register New User
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","password":"Test1234","fullName":"New User"}'
```

### Login
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@vividpages.com","password":"Demo1234"}'
```

### Get Current User (with token)
```bash
# First login and copy the token, then:
curl http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Google OAuth
```bash
# Initiate OAuth flow
curl -I http://localhost:4000/api/auth/google
# You should see a 302 redirect to Google
```

---

## Services Running

| Service | Port | URL | Status |
|---------|------|-----|--------|
| Frontend | 3000 | http://localhost:3000 | ✅ Running |
| Backend API | 4000 | http://localhost:4000 | ✅ Running |
| PostgreSQL | 5432 | localhost:5432 | ✅ Healthy |
| Redis | 6379 | localhost:6379 | ✅ Healthy |
| MinIO | 9002 | http://localhost:9002 | ✅ Healthy |
| MinIO Console | 9001 | http://localhost:9001 | ✅ Healthy |
| Ollama | 11434 | http://localhost:11434 | ✅ Running |

---

## Features Available

✅ User registration with email/password
✅ User login with email/password
✅ Google OAuth sign-in
✅ Protected routes (Bookcase, Settings)
✅ Session management with JWT
✅ Password strength validation
✅ User profile display
✅ Navigation with dropdown menu
✅ Logout functionality
✅ Toast notifications
✅ Responsive design

---

## Next Steps

Phase 1 is complete! Phase 2 will add:

- EPUB file upload
- Book parsing and chapter extraction
- Scene detection
- Job queue processing
- Real-time progress updates
- Bookcase with actual VividPages

---

## Troubleshooting

### Services Not Running
```bash
docker-compose up -d
```

### Clear Authentication
Open browser DevTools → Application → Local Storage → Clear "vividpages-auth"

### View Logs
```bash
# Frontend logs
docker-compose logs -f frontend

# Backend logs
docker-compose logs -f api

# All logs
docker-compose logs -f
```

### Restart Services
```bash
docker-compose restart
```

---

## Documentation

- **PHASE-1-COMPLETE.md** - Complete Phase 1 documentation (700+ lines)
- **GOOGLE-OAUTH-IMPLEMENTATION.md** - OAuth implementation details
- **docs/** - Full project documentation

---

**Happy Testing! 🚀**
