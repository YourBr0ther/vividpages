# Google Cloud Console Setup for VividPages OAuth

**Current Configuration:** IP-based frontend (10.0.2.180:3000) with domain-based API (api.vividpages.hiddencasa.com)

---

## 🔐 OAuth Client Configuration

### 1. Access Google Cloud Console

1. Go to: https://console.cloud.google.com/apis/credentials
2. Click on your OAuth 2.0 Client ID (your specific client ID)

---

## 2. Configure Authorized JavaScript Origins

These are the URLs where users can initiate the OAuth flow.

### ⚠️ Important: Google OAuth Limitation

**Google blocks private IPs (like 10.0.2.180) from OAuth!**

You have **two options**:

### **Option A: Use localhost for testing (Recommended for Development)**

Since Google allows `localhost`, you can test OAuth by accessing the app via localhost on the server machine.

**Add these origins:**
```
http://localhost:3000
http://api.vividpages.hiddencasa.com
```

**To test:**
- On server machine (10.0.2.180): Access http://localhost:3000
- Google OAuth will work
- From other devices: Use IP (http://10.0.2.180:3000) but OAuth won't work

### **Option B: Use the domain for everything**

Set up the frontend domain and use it for all access.

**Add this origin:**
```
http://vividpages.hiddencasa.com
http://api.vividpages.hiddencasa.com
```

**Note:** This requires fixing the Vite host check issue we encountered.

---

## 3. Configure Authorized Redirect URIs

This is where Google sends users after they authorize.

**Add this URI:**
```
http://api.vividpages.hiddencasa.com/api/auth/google/callback
```

**Keep for local testing (optional):**
```
http://localhost:4000/api/auth/google/callback
```

---

## 4. Current Recommendation

### For Development/Testing:

**Authorized JavaScript Origins:**
```
http://localhost:3000
http://api.vividpages.hiddencasa.com
```

**Authorized Redirect URIs:**
```
http://localhost:4000/api/auth/google/callback
http://api.vividpages.hiddencasa.com/api/auth/google/callback
```

### Why This Works:

1. **On the server machine (10.0.2.180):**
   - Access via http://localhost:3000
   - Google OAuth works perfectly

2. **From other devices (phone, desktop at 10.0.2.177):**
   - Access via http://10.0.2.180:3000
   - Email/password login works
   - Google OAuth won't work (Google blocks private IPs)
   - This is a Google limitation, not a VividPages issue

---

## 5. Step-by-Step Configuration

### A. Click "Edit" on your OAuth Client

1. Go to https://console.cloud.google.com/apis/credentials
2. Find your OAuth 2.0 Client ID
3. Click the pencil icon (Edit)

### B. Add Authorized JavaScript Origins

Look for the **"Authorized JavaScript origins"** section.

**Click "+ ADD URI"** and add:
```
http://localhost:3000
```

**Click "+ ADD URI"** again and add:
```
http://api.vividpages.hiddencasa.com
```

### C. Add Authorized Redirect URIs

Look for the **"Authorized redirect URIs"** section.

**Click "+ ADD URI"** and add:
```
http://api.vividpages.hiddencasa.com/api/auth/google/callback
```

**Optional - Keep or add for local testing:**
```
http://localhost:4000/api/auth/google/callback
```

### D. Save Changes

Scroll to bottom and click **"SAVE"**

### E. Wait for Propagation

Google OAuth changes can take **5-10 minutes** to propagate. Don't test immediately!

---

## 6. Testing After Configuration

### Test from Server Machine (10.0.2.180):

1. On the server, open browser to: **http://localhost:3000**
2. Click "Sign in with Google"
3. Should redirect to Google consent screen
4. After authorizing, should redirect back and log you in

### Test from Other Devices:

1. From your desktop (10.0.2.177) or phone
2. Access: **http://10.0.2.180:3000**
3. **Email/password login:** ✅ Works
4. **Google OAuth:** ❌ Won't work (Google limitation with private IPs)

---

## 7. Understanding the OAuth Flow

### Current Flow with Domain API:

```
1. User at http://10.0.2.180:3000
   ↓
2. Clicks "Sign in with Google"
   ↓
3. Browser redirects to: http://api.vividpages.hiddencasa.com/api/auth/google
   ↓
4. Backend redirects to: Google OAuth consent screen
   ↓
5. User authorizes on Google
   ↓
6. Google redirects to: http://api.vividpages.hiddencasa.com/api/auth/google/callback
   ↓
7. Backend generates JWT token
   ↓
8. Backend redirects to: http://10.0.2.180:3000/auth/callback?token=JWT_TOKEN
   ↓
9. Frontend stores token and shows bookcase
```

### The Problem:

When the browser redirects from **http://10.0.2.180:3000** to the Google auth endpoint, Google checks the referrer. If it's a private IP (10.0.2.180), Google blocks it.

### The Solution:

Access the app from **http://localhost:3000** on the server machine, or use a public domain for the frontend.

---

## 8. Future: Production Setup

For production (when ready):

### Use HTTPS with Domain:

**Authorized JavaScript Origins:**
```
https://vividpages.hiddencasa.com
```

**Authorized Redirect URIs:**
```
https://api.vividpages.hiddencasa.com/api/auth/google/callback
```

### Benefits:
- ✅ Google OAuth works from anywhere
- ✅ Secure HTTPS connections
- ✅ No private IP limitations
- ✅ Professional URL
- ✅ Works on all devices

---

## 9. Quick Summary

### What to Add to Google Console NOW:

**Authorized JavaScript Origins:**
- `http://localhost:3000`
- `http://api.vividpages.hiddencasa.com`

**Authorized Redirect URIs:**
- `http://api.vividpages.hiddencasa.com/api/auth/google/callback`
- `http://localhost:4000/api/auth/google/callback` (optional)

### Testing Strategy:

- **Server machine:** Use localhost:3000 → Google OAuth works ✅
- **Other devices:** Use 10.0.2.180:3000 → Email/password only ✅, OAuth blocked ❌

### When to Fix:

Move to production with domain-based setup for full OAuth support everywhere.

---

## 10. Alternative: Domain-Based Frontend

If you want Google OAuth to work from all devices **right now**, we can revisit the Vite host check issue with these options:

1. **Build production version** - No host check in production build
2. **Modify NGINX Proxy Manager** - Override Host header
3. **Use Vite preview mode** - Less restrictive than dev mode

Let me know if you want to pursue any of these!

---

**Ready to configure?** Just follow Section 5 above and you'll have OAuth working from localhost! 🚀
