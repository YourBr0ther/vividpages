# VividPages - Security & API Key Management

**Version:** 1.0
**Date:** October 31, 2025

---

## Security Overview

VividPages handles sensitive user data including:
- User credentials (passwords)
- Third-party API keys (OpenAI, Anthropic, etc.)
- Personal book libraries
- Generated content

This document outlines security best practices and implementation details.

---

## Threat Model

### Assets to Protect
1. User passwords
2. Third-party API keys
3. User-generated content
4. System integrity

### Potential Threats
1. Unauthorized access to user accounts
2. API key theft
3. SQL injection
4. Cross-site scripting (XSS)
5. Cross-site request forgery (CSRF)
6. Man-in-the-middle attacks
7. Denial of service (DoS)
8. Malicious EPUB uploads

### Mitigation Strategies
Each threat has specific countermeasures detailed below.

---

## Authentication Security

### Password Storage

**Never store plaintext passwords.**

#### Implementation (bcrypt)

```typescript
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

// Registration
export async function hashPassword(plainPassword: string): Promise<string> {
  return await bcrypt.hash(plainPassword, SALT_ROUNDS);
}

// Login verification
export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return await bcrypt.compare(plainPassword, hashedPassword);
}
```

**Why bcrypt?**
- Designed for password hashing
- Adaptive (can increase cost factor over time)
- Includes salt automatically
- Resistant to rainbow table attacks

**Best Practices:**
- Minimum password length: 8 characters
- Require mix of uppercase, lowercase, numbers (optional special chars)
- Check against common password lists (optional)

---

### JWT Token Security

#### Token Structure

```typescript
interface JWTPayload {
  userId: string;
  email: string;
  iat: number; // Issued at
  exp: number; // Expiration
}
```

#### Token Generation

```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!; // Must be strong, random
const JWT_EXPIRY = '7d'; // 7 days

export function generateToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}
```

#### Token Verification

```typescript
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null; // Invalid or expired
  }
}
```

#### Middleware

```typescript
import { Request, Response, NextFunction } from 'express';

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7); // Remove "Bearer "
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Attach user info to request
  req.user = { id: payload.userId, email: payload.email };
  next();
}
```

**Security Considerations:**
- Use HTTPS only (tokens sent in headers)
- Store tokens securely on frontend (httpOnly cookies or secure localStorage)
- Implement token refresh for long sessions (optional)
- Revoke tokens on logout (optional: maintain blacklist in Redis)

---

### Google OAuth Security

#### OAuth 2.0 Flow

1. User clicks "Login with Google"
2. Redirect to Google authorization URL
3. User authorizes
4. Google redirects back with authorization code
5. Exchange code for access token
6. Fetch user info from Google
7. Create/find user in database
8. Issue JWT token

#### Implementation

```typescript
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: process.env.GOOGLE_CALLBACK_URL!
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Find or create user
    let user = await db.query.users.findFirst({
      where: eq(users.googleId, profile.id)
    });

    if (!user) {
      // Create new user from Google profile
      user = await db.insert(users).values({
        email: profile.emails![0].value,
        googleId: profile.id,
        fullName: profile.displayName,
        avatarUrl: profile.photos![0]?.value,
        emailVerified: true, // Google emails are verified
      }).returning();
    }

    done(null, user);
  } catch (error) {
    done(error, null);
  }
}));
```

**Security Considerations:**
- Validate redirect URLs
- Check email verification status
- Store minimal data from Google
- Handle email conflicts (Google email already exists as local account)

---

## API Key Management

This is the most critical security component as API keys grant access to paid services.

### Encryption Strategy

**Algorithm:** AES-256-GCM (Galois/Counter Mode)

**Why AES-256-GCM?**
- Industry standard
- Strong encryption (256-bit keys)
- Authenticated encryption (detects tampering)
- Fast in software

#### Encryption Implementation

```typescript
import crypto from 'crypto';

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes (256 bits)
const ALGORITHM = 'aes-256-gcm';

interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
}

export function encryptAPIKey(plainKey: string): EncryptedData {
  // Generate random initialization vector
  const iv = crypto.randomBytes(16);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  // Encrypt
  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

export function decryptAPIKey(encryptedData: EncryptedData): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(encryptedData.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

#### Database Storage

Store encrypted key as JSON:

```typescript
// When storing
const encryptedData = encryptAPIKey(userProvidedKey);
await db.insert(apiKeys).values({
  userId: user.id,
  provider: 'openai',
  encryptedKey: JSON.stringify(encryptedData),
  nickname: 'My OpenAI Key'
});

// When retrieving
const apiKeyRecord = await db.query.apiKeys.findFirst({
  where: and(
    eq(apiKeys.userId, userId),
    eq(apiKeys.provider, 'openai'),
    eq(apiKeys.isActive, true)
  )
});

const encryptedData = JSON.parse(apiKeyRecord.encryptedKey) as EncryptedData;
const plainKey = decryptAPIKey(encryptedData);

// Use plainKey for API call
// Discard from memory immediately after use
```

### Encryption Key Management

**Critical:** The master encryption key must be:
- Randomly generated (32 bytes)
- Stored as environment variable
- NEVER committed to git
- Backed up securely (offline)

#### Generate Encryption Key

```bash
# Generate 32-byte (256-bit) key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Output: e.g., 3f8a9b2c... (64 hex characters = 32 bytes)
```

Add to `.env`:
```
ENCRYPTION_KEY=3f8a9b2c1d5e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2
```

**Backup Strategy:**
- Store encryption key in secure password manager
- Document key rotation process
- If key lost, all API keys are unrecoverable

---

### API Key Frontend Flow

```typescript
// Frontend - Add API Key
async function addAPIKey(provider: string, apiKey: string, nickname: string) {
  const response = await fetch('/api/users/api-keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify({ provider, apiKey, nickname })
  });

  // API key is NEVER returned in response
  return response.json(); // { success: true, id: '...' }
}

// Frontend - List API Keys
async function listAPIKeys() {
  const response = await fetch('/api/users/api-keys', {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });

  // Only returns metadata, NOT the actual keys
  return response.json();
  /* Example:
  [
    {
      id: '...',
      provider: 'openai',
      nickname: 'My OpenAI Key',
      isActive: true,
      createdAt: '...'
    }
  ]
  */
}
```

**Security Rules:**
- API keys NEVER sent to frontend after initial storage
- Frontend only sees metadata (provider, nickname, status)
- Users cannot retrieve their own keys (only delete and re-add)

---

### API Key Validation

Before using an API key, validate it:

```typescript
async function validateAPIKey(provider: string, apiKey: string): Promise<boolean> {
  try {
    switch (provider) {
      case 'openai':
        const openai = new OpenAI({ apiKey });
        await openai.models.list(); // Simple test call
        return true;

      case 'anthropic':
        const anthropic = new Anthropic({ apiKey });
        await anthropic.messages.create({ /* minimal test */ });
        return true;

      case 'stable-diffusion':
        // Make test request
        return true;

      default:
        return false;
    }
  } catch (error) {
    return false;
  }
}
```

**When to validate:**
- When user first adds key (optional: before storing)
- When starting generation job (fail fast if invalid)
- Periodically in background (notify user if key expired)

---

## Input Validation & Sanitization

### Express Validator

Use `express-validator` for all user inputs:

```typescript
import { body, validationResult } from 'express-validator';

// Registration endpoint
app.post('/api/auth/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).trim(),
    body('fullName').optional().trim().escape()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Proceed with registration
  }
);
```

### EPUB Upload Validation

```typescript
import multer from 'multer';

const upload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max
  },
  fileFilter: (req, file, cb) => {
    // Check file extension
    if (!file.originalname.toLowerCase().endsWith('.epub')) {
      return cb(new Error('Only .epub files allowed'));
    }

    // Check MIME type
    if (file.mimetype !== 'application/epub+zip') {
      return cb(new Error('Invalid EPUB file'));
    }

    cb(null, true);
  }
});

app.post('/api/vividpages', upload.single('epub'), async (req, res) => {
  // File validated by multer
});
```

**Additional EPUB Security:**
- Scan for malicious content (zip bombs)
- Limit uncompressed size
- Validate EPUB structure
- Sanitize HTML content from EPUB

---

## Rate Limiting

Prevent abuse and DoS attacks:

```typescript
import rateLimit from 'express-rate-limit';

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later'
});

app.use('/api', apiLimiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 attempts per 15 minutes
  skipSuccessfulRequests: true
});

app.post('/api/auth/login', authLimiter, loginHandler);
app.post('/api/auth/register', authLimiter, registerHandler);
```

**Per-User Rate Limiting (Redis):**

```typescript
import Redis from 'ioredis';

const redis = new Redis();

async function checkUserRateLimit(userId: string): Promise<boolean> {
  const key = `ratelimit:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, 3600); // 1 hour window
  }

  return current <= 50; // 50 generations per hour
}
```

---

## HTTPS / TLS

**All traffic must be encrypted.**

### Development
Use self-signed certificate or `localhost` (browsers trust localhost).

### Production
Use Caddy for automatic HTTPS with Let's Encrypt:

```
# Caddyfile
vividpages.yourdomain.com {
    reverse_proxy frontend:3000
    reverse_proxy /api/* api:4000
}
```

Caddy automatically:
- Obtains SSL certificate
- Renews before expiry
- Redirects HTTP to HTTPS

---

## CORS Configuration

```typescript
import cors from 'cors';

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true, // Allow cookies
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
```

**Production:** Set `FRONTEND_URL` to actual domain.

---

## Security Headers (Helmet)

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind needs inline
      imgSrc: ["'self'", "data:", "https:"], // Allow external images
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", process.env.API_URL!]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

**Headers Set:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (HSTS)
- Content Security Policy (CSP)

---

## SQL Injection Prevention

**Drizzle ORM uses parameterized queries automatically.**

```typescript
// Safe - parameterized
const user = await db.query.users.findFirst({
  where: eq(users.email, userInputEmail)
});

// NEVER do this:
const query = `SELECT * FROM users WHERE email = '${userInputEmail}'`;
```

**Best Practices:**
- Always use ORM/query builder
- Never concatenate SQL strings with user input
- Use prepared statements if writing raw SQL

---

## XSS Prevention

### Backend
- Sanitize all user inputs
- Escape HTML in responses
- Set Content-Type headers correctly

### Frontend (React)
React automatically escapes content:

```tsx
// Safe - React escapes automatically
<div>{userProvidedContent}</div>

// Unsafe - dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: userContent }} />
```

**Rule:** Never use `dangerouslySetInnerHTML` with user content unless sanitized.

**Use DOMPurify if HTML needed:**
```typescript
import DOMPurify from 'dompurify';

const sanitized = DOMPurify.sanitize(userHTML);
```

---

## CSRF Protection

For cookie-based authentication, implement CSRF tokens:

```typescript
import csrf from 'csurf';

const csrfProtection = csrf({ cookie: true });

app.use(csrfProtection);

// Send token to frontend
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Validate on state-changing requests
app.post('/api/protected', csrfProtection, (req, res) => {
  // CSRF token validated automatically
});
```

**For JWT auth:** CSRF is less critical (tokens in headers, not cookies), but still good practice.

---

## Secrets Management

### Environment Variables

**Never commit secrets to git.**

#### `.env.example`
```bash
# Copy to .env and fill in values

# Database
POSTGRES_PASSWORD=

# JWT
JWT_SECRET=

# Encryption
ENCRYPTION_KEY=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# MinIO
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
```

#### `.gitignore`
```
.env
.env.local
.env.production
*.pem
*.key
```

### Docker Secrets (Production Alternative)

For more secure secret management:

```yaml
# docker-compose.yml
services:
  api:
    secrets:
      - db_password
      - jwt_secret

secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
```

Access in app:
```typescript
import fs from 'fs';

const JWT_SECRET = process.env.JWT_SECRET ||
  fs.readFileSync('/run/secrets/jwt_secret', 'utf8');
```

---

## Logging Security

**Never log sensitive data:**

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Bad - logs password
logger.info('User login attempt', { email, password });

// Good - no sensitive data
logger.info('User login attempt', { email });

// Good - redact API keys
logger.info('API call', {
  provider: 'openai',
  apiKey: apiKey.substring(0, 8) + '...' // Only log prefix
});
```

---

## Dependency Security

### Regular Updates

```bash
# Check for vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Update dependencies
pnpm update
```

### Automated Scanning

Use GitHub Dependabot or similar:
- Automatic pull requests for security updates
- Alerts for vulnerable dependencies

---

## Backup Security

### Database Backups
- Encrypt backup files
- Store in secure location
- Limit access
- Test restore process

```bash
# Backup with encryption
docker exec vividpages-postgres pg_dump -U vividpages vividpages | \
  gpg --symmetric --cipher-algo AES256 > backup_$(date +%Y%m%d).sql.gpg

# Restore
gpg --decrypt backup_20261231.sql.gpg | \
  docker exec -i vividpages-postgres psql -U vividpages vividpages
```

---

## Incident Response Plan

### If API Keys Compromised

1. Immediately revoke affected keys in third-party services
2. Notify affected users
3. Force password reset for affected accounts
4. Investigate breach source
5. Rotate encryption keys (if master key compromised)
6. Review and enhance security measures

### If Database Compromised

1. Take system offline
2. Assess extent of breach
3. Notify users
4. Force password resets
5. Review access logs
6. Restore from clean backup
7. Patch vulnerability

---

## Security Checklist

### Development
- [ ] No secrets in git
- [ ] .env.example documented
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (ORM)
- [ ] XSS prevention
- [ ] CORS configured
- [ ] Rate limiting implemented

### Deployment
- [ ] HTTPS enabled (Caddy)
- [ ] Security headers (Helmet)
- [ ] API keys encrypted (AES-256)
- [ ] Master encryption key backed up securely
- [ ] Database password strong and unique
- [ ] JWT secret random and strong
- [ ] OAuth credentials secured
- [ ] Firewall configured
- [ ] Logs reviewed for sensitive data
- [ ] Dependency audit passed

### Operations
- [ ] Regular dependency updates
- [ ] Automated vulnerability scanning
- [ ] Backup encryption
- [ ] Incident response plan documented
- [ ] User education (strong passwords, API key safety)

---

## User Education

Provide security guidance to users:

### API Key Safety
- "Never share your API keys with anyone"
- "VividPages never asks for your API keys via email"
- "Regenerate keys if you suspect compromise"
- "Monitor your API usage on provider dashboards"

### Account Security
- "Use a strong, unique password"
- "Enable 2FA on connected accounts (Google)"
- "Log out on shared devices"

---

## Compliance Considerations

### GDPR (if EU users)
- User data export
- Right to deletion
- Data processing agreements
- Cookie consent

### CCPA (California)
- Privacy policy
- Data disclosure
- Opt-out mechanisms

### API Provider Terms
- Comply with OpenAI, Anthropic, etc. terms of service
- Respect rate limits
- Proper attribution
- No prohibited use cases

---

## Summary

**Security is not optional.**

Key Takeaways:
1. Encrypt API keys at rest (AES-256)
2. Hash passwords (bcrypt)
3. Use HTTPS everywhere
4. Validate all inputs
5. Rate limit endpoints
6. Never log sensitive data
7. Keep dependencies updated
8. Have an incident response plan

**When in doubt, be more secure rather than less.**

---

**Status:** ✅ Security Strategy Complete
**Next Document:** Docker Deployment Configuration
