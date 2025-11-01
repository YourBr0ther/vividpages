# Google OAuth Limitation with Private IPs

## Issue

Google OAuth **does not allow callback URLs to private IP addresses** (like `10.0.2.180`).

When you try to use Google OAuth, you'll see this error:
```
Access blocked: Authorization Error
device_id and device_name are required for private IP
Error 400: invalid_request
```

## Why This Happens

This is a **Google security feature**, not a bug in VividPages. Google blocks OAuth redirects to:
- ❌ Private IP addresses (10.x.x.x, 192.168.x.x, 172.16.x.x)
- ❌ Any IP addresses (even public ones)
- ✅ Only allows: `localhost` or public domain names (like `example.com`)

## Current Status

**Working:**
- ✅ Email/password registration
- ✅ Email/password login
- ✅ All other authentication features

**Not Working:**
- ❌ Google OAuth (only on private IP networks)

## Solutions

### Solution 1: Use localhost (Only if accessing from server)

If you're accessing from the same machine as the server:

1. Access via: `http://localhost:3000` (not `http://10.0.2.180:3000`)
2. Google OAuth will work with localhost

**Limitation:** Only works if you're on the server machine.

---

### Solution 2: Set Up Local Domain Name (Recommended for Development)

Create a custom domain that resolves to your server:

**Step 1: On Server (10.0.2.180):**
```bash
echo "127.0.0.1 vividpages.local" | sudo tee -a /etc/hosts
```

**Step 2: On Client Machine (10.0.2.177):**
```bash
# Linux/Mac
echo "10.0.2.180 vividpages.local" | sudo tee -a /etc/hosts

# Windows (Run as Administrator in PowerShell)
Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value "10.0.2.180 vividpages.local"
```

**Step 3: Update Google Cloud Console:**
1. Go to: https://console.cloud.google.com/apis/credentials
2. Click your OAuth Client ID
3. Under "Authorized redirect URIs", add:
   - `http://vividpages.local:4000/api/auth/google/callback`

**Step 4: Update VividPages .env:**
```bash
GOOGLE_CALLBACK_URL=http://vividpages.local:4000/api/auth/google/callback
FRONTEND_URL=http://vividpages.local:3000
VITE_API_URL=http://vividpages.local:4000
```

**Step 5: Restart services:**
```bash
docker-compose restart api frontend
```

**Step 6: Access via:**
- http://vividpages.local:3000

---

### Solution 3: Use ngrok (Professional Tunnel Solution)

ngrok creates a public HTTPS URL that tunnels to your local server.

**Step 1: Install ngrok:**
```bash
# Add ngrok repository
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list

# Install
sudo apt update && sudo apt install ngrok

# Sign up and get auth token from: https://dashboard.ngrok.com/get-started/setup
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

**Step 2: Start ngrok tunnel:**
```bash
# Tunnel to backend API
ngrok http 4000
```

**Step 3: Copy the public URL:**
ngrok will show something like:
```
Forwarding   https://abc123.ngrok.io -> http://localhost:4000
```

**Step 4: Update Google Cloud Console:**
Add redirect URI: `https://abc123.ngrok.io/api/auth/google/callback`

**Step 5: Update .env:**
```bash
GOOGLE_CALLBACK_URL=https://abc123.ngrok.io/api/auth/google/callback
VITE_API_URL=https://abc123.ngrok.io
```

**Step 6: Restart and access:**
```bash
docker-compose restart api frontend
```

---

### Solution 4: Deploy to Production (Real Domain)

For production deployment:

1. **Get a domain name** (example.com)
2. **Set up DNS** to point to your server
3. **Configure SSL/TLS** (Let's Encrypt with Caddy)
4. **Update Google OAuth** with production URLs
5. **Use HTTPS** everywhere

**Production URLs would be:**
- Frontend: `https://vividpages.example.com`
- Backend: `https://api.vividpages.example.com`
- OAuth Callback: `https://api.vividpages.example.com/api/auth/google/callback`

---

## Recommendation

**For Development/Testing:**
- Use **Solution 2** (local domain name) - easiest and works well
- Or use **Solution 3** (ngrok) - more professional

**For Production:**
- Use **Solution 4** (real domain with HTTPS)

**For Now:**
- Email/password authentication works perfectly
- Google OAuth can be added later when you have a domain

---

## What Still Works Without Google OAuth

Everything else in VividPages works perfectly:
- ✅ User registration with email/password
- ✅ Login with email/password
- ✅ Password strength validation
- ✅ Protected routes
- ✅ Session management
- ✅ User profile
- ✅ Settings page
- ✅ Bookcase
- ✅ All API endpoints

Google OAuth is just **one of two login methods**. The core authentication system is fully functional.

---

## Google OAuth Support Matrix

| Environment | Email/Password | Google OAuth |
|-------------|----------------|--------------|
| localhost (same machine) | ✅ Works | ✅ Works |
| Private IP (10.x.x.x) | ✅ Works | ❌ Blocked by Google |
| Local domain (*.local) | ✅ Works | ✅ Works |
| ngrok tunnel | ✅ Works | ✅ Works |
| Production domain (HTTPS) | ✅ Works | ✅ Works |

---

## Next Steps

1. **For now:** Continue using email/password authentication (fully functional)
2. **Optional:** Set up local domain (vividpages.local) if you want Google OAuth
3. **Later:** When deploying to production, Google OAuth will work automatically with a real domain

---

**Bottom Line:** This is not a bug - it's Google's security policy. Email/password authentication works perfectly, and Google OAuth can be enabled with a domain name.

**Date:** November 1, 2025
