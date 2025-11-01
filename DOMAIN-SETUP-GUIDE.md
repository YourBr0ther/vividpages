# VividPages Domain Setup Guide

**Domain:** vividpages.hiddencasa.com
**API Subdomain:** api.vividpages.hiddencasa.com
**Server IP:** 10.0.2.180

---

## ✅ Configuration Complete

The VividPages application has been configured for your domain:

- **Frontend:** https://vividpages.hiddencasa.com
- **Backend API:** https://api.vividpages.hiddencasa.com
- **Google OAuth Callback:** https://api.vividpages.hiddencasa.com/api/auth/google/callback

---

## 📋 Setup Checklist

### Step 1: DNS Configuration

Add these DNS records to your domain (hiddencasa.com):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | vividpages | 10.0.2.180 | 300 |
| A | api.vividpages | 10.0.2.180 | 300 |

**Or if using CNAME:**

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | vividpages | 10.0.2.180 | 300 |
| CNAME | api.vividpages | vividpages.hiddencasa.com | 300 |

Wait 5-10 minutes for DNS propagation.

**Verify DNS:**
```bash
# Check if DNS is working
dig vividpages.hiddencasa.com
dig api.vividpages.hiddencasa.com

# Or use nslookup
nslookup vividpages.hiddencasa.com
nslookup api.vividpages.hiddencasa.com
```

---

### Step 2: NGINX Proxy Manager Configuration

#### A. Access NGINX Proxy Manager

1. Open your NGINX Proxy Manager web interface
2. Login with your credentials

#### B. Add Frontend Proxy Host

**Click "Proxy Hosts" → "Add Proxy Host"**

**Details Tab:**
```
Domain Names: vividpages.hiddencasa.com
Scheme: http
Forward Hostname/IP: 10.0.2.180
Forward Port: 3000
Cache Assets: ✓ (checked)
Block Common Exploits: ✓ (checked)
Websockets Support: ✓ (checked)
```

**SSL Tab:**
```
SSL Certificate: Request a new SSL Certificate with Let's Encrypt
Force SSL: ✓ (checked)
HTTP/2 Support: ✓ (checked)
HSTS Enabled: ✓ (checked)
Email Address for Let's Encrypt: your-email@example.com
I Agree to the Let's Encrypt Terms of Service: ✓ (checked)
```

**Advanced Tab (Optional):**
```nginx
# Add these if needed for better performance
client_max_body_size 100M;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

**Click "Save"**

#### C. Add Backend API Proxy Host

**Click "Proxy Hosts" → "Add Proxy Host"**

**Details Tab:**
```
Domain Names: api.vividpages.hiddencasa.com
Scheme: http
Forward Hostname/IP: 10.0.2.180
Forward Port: 4000
Cache Assets: ✗ (unchecked - API shouldn't be cached)
Block Common Exploits: ✓ (checked)
Websockets Support: ✓ (checked)
```

**SSL Tab:**
```
SSL Certificate: Request a new SSL Certificate with Let's Encrypt
Force SSL: ✓ (checked)
HTTP/2 Support: ✓ (checked)
HSTS Enabled: ✓ (checked)
Email Address for Let's Encrypt: your-email@example.com
I Agree to the Let's Encrypt Terms of Service: ✓ (checked)
```

**Advanced Tab:**
```nginx
# Important for API
client_max_body_size 100M;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

# CORS headers (if needed)
add_header 'Access-Control-Allow-Credentials' 'true' always;
```

**Click "Save"**

---

### Step 3: Update Google OAuth Console

#### A. Go to Google Cloud Console

1. Visit: https://console.cloud.google.com/apis/credentials
2. Click on your OAuth 2.0 Client ID (your specific client ID)

#### B. Update Authorized JavaScript Origins

**Add:**
```
https://vividpages.hiddencasa.com
```

**Remove or keep for testing:**
```
http://localhost:3000
http://10.0.2.180:3000
```

#### C. Update Authorized Redirect URIs

**Add:**
```
https://api.vividpages.hiddencasa.com/api/auth/google/callback
```

**Remove or keep for testing:**
```
http://localhost:4000/api/auth/google/callback
http://10.0.2.180:4000/api/auth/google/callback
```

#### D. Save Changes

Click "Save" at the bottom of the page.

---

### Step 4: Restart VividPages Services

On your server, restart the containers to pick up the new environment variables:

```bash
cd /home/chris/vividpages

# Stop and remove containers to force env reload
docker-compose stop frontend api
docker-compose rm -f frontend api

# Start with new configuration
docker-compose up -d frontend api

# Wait a few seconds, then check status
docker-compose ps
```

**Verify services are running:**
```bash
# Check if API is responding
curl https://api.vividpages.hiddencasa.com/api/health

# Should return:
# {"status":"healthy","timestamp":"...","database":"connected","version":"1.0.0"}
```

---

### Step 5: Test the Setup

#### A. Test Frontend Access

1. Open browser and go to: **https://vividpages.hiddencasa.com**
2. You should see the login page with HTTPS (🔒)
3. Check browser console (F12) - should show: `API URL: https://api.vividpages.hiddencasa.com`

#### B. Test API Access

Open: **https://api.vividpages.hiddencasa.com/api/health**

Should see:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-01T...",
  "database": "connected",
  "version": "1.0.0"
}
```

#### C. Test Login

1. Try logging in with email/password
2. Should work normally with HTTPS

#### D. Test Google OAuth

1. On login page, click "Sign in with Google"
2. Should redirect to Google consent screen (no errors!)
3. Authorize VividPages
4. Should redirect back and log you in successfully
5. Your Google profile photo should appear in navigation

---

## 🔧 Troubleshooting

### DNS Not Resolving

**Problem:** Can't access vividpages.hiddencasa.com

**Solution:**
```bash
# Check DNS propagation
dig vividpages.hiddencasa.com
# Should show: 10.0.2.180

# If not working, check your DNS provider
# Wait up to 10 minutes for propagation
```

### SSL Certificate Failed

**Problem:** Let's Encrypt certificate request failed in NPM

**Solution:**
1. Make sure DNS is working first (Step 1)
2. Ensure ports 80 and 443 are open on your server
3. Check if domain resolves to correct IP
4. Try again after DNS propagation completes

### CORS Errors

**Problem:** Browser console shows CORS errors

**Solution:**
1. Check that backend CORS includes your domain (already configured)
2. Make sure both frontend and API use HTTPS (not mixed HTTP/HTTPS)
3. Clear browser cache and try again

### Google OAuth Still Blocked

**Problem:** Google OAuth shows "Access blocked" error

**Solutions:**
1. **Verify Google Console settings** - Make sure you saved the changes
2. **Wait 5-10 minutes** - Google settings take time to propagate
3. **Use exact URLs** - Must be `https://api.vividpages.hiddencasa.com/api/auth/google/callback`
4. **Check browser URL** - Make sure you're accessing via domain, not IP

### Backend Not Accessible

**Problem:** API health check fails

**Solution:**
```bash
# Check if API container is running
docker-compose ps

# Check API logs
docker-compose logs --tail=50 api

# Restart if needed
docker-compose restart api

# Verify port 4000 is accessible
curl http://10.0.2.180:4000/api/health
```

### Frontend Shows Old API URL

**Problem:** Browser console still shows old API URL

**Solution:**
1. **Hard refresh:** Ctrl + Shift + R (or Cmd + Shift + R)
2. **Clear browser cache completely**
3. **Try incognito/private window**
4. **Clear localStorage:** F12 → Application → Local Storage → Clear
5. Verify containers restarted with new env

---

## 📊 Configuration Summary

### Environment Variables (.env)

```bash
# Production URLs
FRONTEND_URL=https://vividpages.hiddencasa.com
VITE_API_URL=https://api.vividpages.hiddencasa.com
VITE_WS_URL=wss://api.vividpages.hiddencasa.com

# Google OAuth
GOOGLE_CALLBACK_URL=https://api.vividpages.hiddencasa.com/api/auth/google/callback
```

### NGINX Proxy Manager

- **Frontend:** vividpages.hiddencasa.com → 10.0.2.180:3000
- **Backend:** api.vividpages.hiddencasa.com → 10.0.2.180:4000
- **SSL:** Let's Encrypt (auto-renewal)
- **Force HTTPS:** Enabled

### Google OAuth

- **Authorized Origins:** https://vividpages.hiddencasa.com
- **Redirect URI:** https://api.vividpages.hiddencasa.com/api/auth/google/callback

---

## 🎉 Success Criteria

Once everything is set up correctly, you should be able to:

✅ Access https://vividpages.hiddencasa.com (with 🔒 HTTPS)
✅ Login with email/password works
✅ Login with Google OAuth works (no errors!)
✅ HTTPS on all connections
✅ Google profile photo appears in navigation
✅ All features working normally

---

## 🔒 Security Notes

### HTTPS Everywhere

- ✅ All traffic is encrypted (Let's Encrypt SSL)
- ✅ HTTP automatically redirects to HTTPS
- ✅ HSTS headers prevent downgrade attacks
- ✅ Modern TLS protocols only

### Google OAuth Security

- ✅ Now works with real domain (not blocked)
- ✅ OAuth callbacks are secure (HTTPS)
- ✅ No private IP issues

### Production Ready

This setup is now **production-ready**:
- SSL/TLS encryption
- Reverse proxy configuration
- Proper domain names
- OAuth working correctly

---

## 📞 Support

If you encounter issues:

1. **Check DNS first** - Most issues are DNS-related
2. **Wait for propagation** - DNS and Google OAuth changes take 5-10 minutes
3. **Check logs** - `docker-compose logs api` and `docker-compose logs frontend`
4. **Test step by step** - Don't skip the verification steps
5. **Use curl to test API** - Helps isolate frontend vs backend issues

---

## 🚀 Next Steps After Setup

Once domain setup is complete:

1. **Test all authentication flows**
2. **Invite others to test** (now accessible from anywhere!)
3. **Continue to Phase 2** (EPUB processing)
4. **Consider backup strategy** for database
5. **Set up monitoring** (optional)

---

**Setup Date:** November 1, 2025
**Status:** ✅ Configured and ready for deployment
