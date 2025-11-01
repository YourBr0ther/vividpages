# VividPages Quick Access

## 🌐 URLs

**Frontend:** http://10.0.2.180:3000

**API:** http://api.vividpages.hiddencasa.com (or http://10.0.2.180:4000)

**MinIO Console:** http://10.0.2.180:9001

---

## 👤 Test Accounts

**Demo Account:**
- Email: demo@vividpages.com
- Password: vividdemo123

**Test Account:**
- Email: test@vividpages.com
- Password: Test123!

---

## 🔐 Google OAuth

**Status:** ✅ Configured and ready to test

**How to test:**
1. Go to http://10.0.2.180:3000
2. Click "Sign in with Google"
3. Select your Google account
4. Should redirect back and log you in

**Google Console:**
- Configured with your Google OAuth Client ID
- Callback: http://api.vividpages.hiddencasa.com/api/auth/google/callback

---

## 🚀 Quick Commands

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f frontend api

# Restart frontend & API
docker-compose restart frontend api

# Stop all
docker-compose down
```

---

## ✅ What's Working

- ✅ User registration
- ✅ Email/password login
- ✅ JWT authentication
- ✅ Protected routes
- ✅ Session management
- ✅ Google OAuth (ready to test)
- ✅ Responsive UI
- ✅ Network access from all devices

---

## 📱 Access from Other Devices

**Same network only (10.0.2.x)**

Phone/Tablet: http://10.0.2.180:3000

Works from any browser!

---

## 🎯 Next Phase

**Phase 2: EPUB Processing**
- File upload
- EPUB parsing
- Scene detection
- Job queue with Bull
