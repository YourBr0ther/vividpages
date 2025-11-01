# Network Access Configuration

## Server Information

**Server IP:** 10.0.2.180
**Client IP:** 10.0.2.177

---

## Access URLs

### From Your Client Machine (10.0.2.177)

**Frontend (Web App):**
```
http://10.0.2.180:3000
```

**Backend API:**
```
http://10.0.2.180:4000
```

**API Health Check:**
```
http://10.0.2.180:4000/api/health
```

---

## Test Accounts

### Demo Account
- **Email:** demo@vividpages.com
- **Password:** Demo1234

### Chris Account
- **Email:** chris@vividpages.com
- **Password:** Password123

---

## Configuration Changes Made

1. **Frontend API URL:** Changed from `localhost:4000` to `10.0.2.180:4000`
2. **CORS Settings:** Updated to allow connections from 10.0.2.x network
3. **Google OAuth Callback:** Updated to use `10.0.2.180:4000`

---

## How to Access

1. **Open your browser on your client machine (10.0.2.177)**

2. **Navigate to:**
   ```
   http://10.0.2.180:3000
   ```

3. **Login with demo account:**
   - Email: demo@vividpages.com
   - Password: Demo1234

4. **You should now be able to log in successfully!**

---

## Troubleshooting

### If you still get login errors:

1. **Check browser console** (F12 → Console tab)
   - Look for the "API URL" log
   - Should show: `http://10.0.2.180:4000`

2. **Test API connectivity from your browser:**
   - Open: http://10.0.2.180:4000/api/health
   - Should see JSON with "status": "healthy"

3. **Check firewall:**
   ```bash
   # On server, allow ports 3000 and 4000
   sudo ufw allow 3000
   sudo ufw allow 4000
   ```

4. **Clear browser cache:**
   - Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
   - Clear localStorage: F12 → Application → Local Storage → Clear

---

## Services Status

All services are running on the server (10.0.2.180):

| Service | Port | Status |
|---------|------|--------|
| Frontend | 3000 | ✅ Running |
| Backend API | 4000 | ✅ Running |
| PostgreSQL | 5432 | ✅ Healthy |
| Redis | 6379 | ✅ Healthy |
| MinIO | 9002 | ✅ Healthy |

---

## Network Diagram

```
Client Machine (10.0.2.177)
     |
     | Browser connects to
     v
Server (10.0.2.180)
     |
     ├─ Frontend :3000
     └─ Backend API :4000
         |
         ├─ PostgreSQL :5432
         ├─ Redis :6379
         └─ MinIO :9002
```

---

**Updated:** November 1, 2025
**Status:** ✅ Configured for network access
