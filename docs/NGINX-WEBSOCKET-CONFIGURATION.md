# Nginx WebSocket Configuration for VividPages

## Overview

VividPages uses Socket.IO for real-time progress updates during EPUB processing, scene analysis, and character discovery. WebSocket connections require special nginx reverse proxy configuration to properly upgrade HTTP connections to WebSocket protocol.

## Problem

Currently, WebSocket connections are failing with errors like:
```
WebSocket connection to 'ws://api.vividpages.hiddencasa.com/socket.io/?EIO=4&transport=websocket' failed
❌ Socket.IO connection error: TransportError: websocket error
```

This occurs because the nginx reverse proxy at `api.vividpages.hiddencasa.com` is not configured to handle WebSocket upgrade requests.

## Solution

Add the following configuration to your nginx reverse proxy configuration for the API backend:

### Required Nginx Configuration

```nginx
# In your server block for api.vividpages.hiddencasa.com

location / {
    # Proxy to backend API
    proxy_pass http://localhost:4000;  # or your backend container IP

    # Standard proxy headers
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket support
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Timeouts for WebSocket connections
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}
```

### Explanation

1. **`proxy_http_version 1.1;`**
   - WebSocket requires HTTP/1.1 (default is HTTP/1.0)

2. **`proxy_set_header Upgrade $http_upgrade;`**
   - Forwards the `Upgrade` header from client to backend
   - This header indicates the client wants to upgrade to WebSocket

3. **`proxy_set_header Connection "upgrade";`**
   - Sets the `Connection` header to "upgrade"
   - Required for the WebSocket handshake

4. **Timeout Settings**
   - WebSocket connections are long-lived
   - Default timeouts (60s) will close the connection
   - Set to 7 days or adjust based on your needs

## Alternative: Specific Socket.IO Location Block

If you want to handle Socket.IO separately from other API routes:

```nginx
# Socket.IO WebSocket endpoint
location /socket.io/ {
    proxy_pass http://localhost:4000/socket.io/;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
}

# Regular API routes
location /api/ {
    proxy_pass http://localhost:4000/api/;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Testing

After applying the configuration:

1. Reload nginx:
   ```bash
   sudo nginx -t  # Test configuration
   sudo systemctl reload nginx  # Apply changes
   ```

2. Open browser console on VividPages frontend

3. You should see:
   ```
   🔌 Connecting to Socket.IO server...
   ✅ Connected to Socket.IO server
   ```

4. No more WebSocket connection errors

## Current Workaround

Until nginx is configured, the frontend now uses **enhanced polling** as a fallback:
- Polls every 1 second during active processing (`analyzing`, `discovering_characters`, `building_character_profiles`)
- Polls every 3 seconds during transitional states (`analyzed`, `characters_discovered`, `scenes_detected`)
- Stops polling only for terminal states (`completed`, `failed`)

This ensures the UI updates automatically without manual refresh, even when WebSocket connections fail.

## Benefits of WebSocket Support

Once nginx is properly configured for WebSocket:

1. **Real-time updates** - Progress updates appear instantly
2. **Reduced server load** - No constant polling overhead
3. **Better UX** - Smoother, more responsive interface
4. **Lower bandwidth** - Only send data when status changes

## References

- [Nginx WebSocket Proxying Documentation](https://nginx.org/en/docs/http/websocket.html)
- [Socket.IO Behind a Reverse Proxy](https://socket.io/docs/v4/reverse-proxy/)
- [VividPages Socket Implementation](/home/chris/vividpages/backend/src/lib/socket.ts)

## Related Files

- Backend Socket.IO server: `/backend/src/lib/socket.ts`
- Frontend Socket hook: `/frontend/src/lib/useSocket.ts`
- Frontend polling logic: `/frontend/src/pages/VividPageViewer.tsx` (lines 48-66)
