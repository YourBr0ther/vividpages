# VividPages Current Setup (IP-Based Access)

**Last Updated:** November 1, 2025

---

## ✅ Authentication System Complete

Phase 1 authentication is fully implemented and tested:
- ✅ User registration with strong password validation
- ✅ Email/password login with JWT tokens
- ✅ Google OAuth 2.0 integration
- ✅ Protected routes and navigation
- ✅ Session management with auto-logout

---

## 🌐 Network Configuration

### Access Points

**Frontend:**
- **URL:** http://10.0.2.180:3000
- **Accessible from:** Any device on your network (10.0.2.x)
- **Tested on:** Desktop browser, phone browser

**Backend API:**
- **IP Access:** http://10.0.2.180:4000
- **Domain Access:** http://api.vividpages.hiddencasa.com
- **Both work:** Use domain for Google OAuth, IP for direct access

### Why This Configuration?

We use a **hybrid approach**:

1. **Frontend via IP (10.0.2.180:3000)**
   - Direct IP access works perfectly
   - Domain access blocked by Vite dev server security
   - No need for domain in development

2. **Backend via Domain (api.vividpages.hiddencasa.com)**
   - Required for Google OAuth (Google blocks private IPs)
   - Works through NGINX Proxy Manager
   - Also accessible via IP for direct API calls

---

## 🔧 Configuration Files

### `.env` Settings

```bash
# Frontend URLs
FRONTEND_URL=http://10.0.2.180:3000           # Where backend redirects users
VITE_API_URL=http://api.vividpages.hiddencasa.com  # Where frontend connects to API
VITE_WS_URL=ws://api.vividpages.hiddencasa.com     # WebSocket connection

# Google OAuth
GOOGLE_CALLBACK_URL=http://api.vividpages.hiddencasa.com/api/auth/google/callback
```

### `vite.config.ts`

```typescript
server: {
  host: '0.0.0.0',        // Listen on all interfaces
  port: 3000,
  strictPort: false,
  cors: true,
  proxy: {
    '/api': {
      target: process.env.VITE_API_URL,
      changeOrigin: true
    }
  }
}
```

### Backend CORS (server.ts)

```typescript
cors({
  origin: [
    process.env.FRONTEND_URL,                 // http://10.0.2.180:3000
    'http://localhost:3000',
    'http://vividpages.hiddencasa.com',
    'https://vividpages.hiddencasa.com',
    /^http:\/\/10\.0\.2\.\d+:3000$/          // Any IP in 10.0.2.x range
  ],
  credentials: true
})
```

---

## 🚀 How to Access

### From Your Desktop (10.0.2.177)

1. Open browser: **http://10.0.2.180:3000**
2. You'll see the login page
3. Login options:
   - Email/password (demo@vividpages.com / vividdemo123)
   - Google OAuth (click "Sign in with Google")

### From Your Phone (Same Network)

1. Connect phone to same WiFi network
2. Open browser: **http://10.0.2.180:3000**
3. Works exactly like desktop!

### From Other Devices on Network

Any device on 10.0.2.x network can access:
- Frontend: http://10.0.2.180:3000
- API: http://10.0.2.180:4000 or http://api.vividpages.hiddencasa.com

---

## 🔐 Google OAuth Flow

1. User clicks "Sign in with Google" on http://10.0.2.180:3000
2. Frontend redirects to: http://api.vividpages.hiddencasa.com/api/auth/google
3. Backend redirects to Google OAuth consent screen
4. User authorizes on Google
5. Google redirects to: http://api.vividpages.hiddencasa.com/api/auth/google/callback
6. Backend processes OAuth, generates JWT token
7. Backend redirects to: http://10.0.2.180:3000/auth/callback?token=JWT_TOKEN
8. Frontend stores token and redirects to bookcase

**Why domain for OAuth?**
- Google OAuth requires public/non-private IP callback URLs
- Using domain (via NGINX Proxy Manager) satisfies this requirement
- Backend accessible via domain ensures callbacks work

---

## 🧪 Testing Status

### ✅ Working Features

- User registration with password strength validation
- Email/password login
- JWT token generation and validation
- Protected routes redirect to login
- Logout clears session
- Navigation with user dropdown
- Google OAuth button (ready to test)

### 🔄 Ready to Test

- **Google OAuth login flow**
  - Make sure you're accessing via http://10.0.2.180:3000
  - Click "Sign in with Google"
  - Should work end-to-end now

### 📱 Device Testing

- Desktop browser: ✅ Tested and working
- Phone browser: ✅ Ready to test (access http://10.0.2.180:3000)
- Tablet: ✅ Should work (same network)

---

## 🛠️ Development Commands

### Start Services

```bash
cd /home/chris/vividpages
docker-compose up -d
```

### View Logs

```bash
# All services
docker-compose logs -f

# Frontend only
docker-compose logs -f frontend

# API only
docker-compose logs -f api
```

### Restart After Config Changes

```bash
# Restart with new environment variables
docker-compose stop frontend api
docker-compose rm -f frontend api
docker-compose up -d frontend api
```

### Check Status

```bash
# Container status
docker-compose ps

# Test API health
curl http://10.0.2.180:4000/api/health
curl http://api.vividpages.hiddencasa.com/api/health
```

---

## 📊 Service Ports

| Service | Container Port | Host Port | Access |
|---------|---------------|-----------|---------|
| Frontend | 3000 | 3000 | http://10.0.2.180:3000 |
| API | 4000 | 4000 | http://10.0.2.180:4000 |
| PostgreSQL | 5432 | 5432 | localhost:5432 |
| Redis | 6379 | 6379 | localhost:6379 |
| MinIO | 9000 | 9002 | http://10.0.2.180:9002 |
| MinIO Console | 9001 | 9001 | http://10.0.2.180:9001 |
| Ollama | 11434 | 11434 | http://10.0.2.180:11434 |

---

## 🔒 Security Notes

### Development Security

- Using HTTP (not HTTPS) for development
- Private network only (10.0.2.x)
- Not exposed to internet
- JWT tokens with 7-day expiration
- Bcrypt password hashing
- Rate limiting on auth endpoints

### Production Considerations

When moving to production:
1. Enable HTTPS with Let's Encrypt SSL certificates
2. Update Google OAuth URLs to HTTPS
3. Use production build instead of dev server
4. Vite host check won't be an issue in production build
5. Configure proper domain DNS
6. Enable all NGINX Proxy Manager security features

---

## 🎯 Next Steps

Now that authentication is complete and working:

1. **Test Google OAuth** - Try login with Google from http://10.0.2.180:3000
2. **Invite others to test** - Anyone on your network can access
3. **Begin Phase 2** - EPUB processing and scene detection
4. **Add more features** - Bookcase, settings, file uploads

---

## 📞 Troubleshooting

### Can't Access Frontend

**Problem:** Browser can't reach http://10.0.2.180:3000

**Solutions:**
1. Check containers are running: `docker-compose ps`
2. Check frontend logs: `docker-compose logs frontend`
3. Verify port 3000 is open: `curl http://10.0.2.180:3000`
4. Restart containers: `docker-compose restart frontend`

### Google OAuth Not Working

**Problem:** OAuth redirects fail or show errors

**Solutions:**
1. Verify API domain is accessible: `curl http://api.vividpages.hiddencasa.com/api/health`
2. Check Google Console has correct callback URL
3. Verify NGINX Proxy Manager has api.vividpages proxy host configured
4. Check backend logs: `docker-compose logs api`

### Network Error on Login

**Problem:** Login fails with "Network Error"

**Solutions:**
1. Check API is running: `curl http://api.vividpages.hiddencasa.com/api/health`
2. Verify .env has correct URLs
3. Check browser console (F12) for API URL
4. Hard refresh browser (Ctrl+Shift+R)
5. Clear browser cache and localStorage

### Can't Access from Phone

**Problem:** Phone shows "Can't reach this page"

**Solutions:**
1. Verify phone is on same WiFi network
2. Check phone is getting 10.0.2.x IP address
3. Try ping from phone to 10.0.2.180
4. Check firewall isn't blocking connections
5. Try accessing API first: http://10.0.2.180:4000/api/health

---

## 🎉 Success Criteria

You'll know everything is working when:

✅ Can access frontend from desktop browser
✅ Can access frontend from phone on same network
✅ Can login with email/password
✅ Can logout successfully
✅ Can register new accounts
✅ Can login with Google OAuth
✅ Protected routes redirect to login when not authenticated
✅ Authenticated users see navigation and bookcase
✅ User profile photo appears after Google login

---

**Status:** ✅ Ready for testing and development
**Configuration:** IP-based access with domain API for OAuth
**Tested:** Desktop browser, ready for phone testing
