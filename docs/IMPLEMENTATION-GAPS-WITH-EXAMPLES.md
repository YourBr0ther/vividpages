# Phase 1 Implementation Gaps - With Code Examples

**Created:** November 1, 2025
**Purpose:** Show exactly what exists and what's missing with actual code examples

---

## BACKEND: What EXISTS

### ✅ Registration Endpoint (Working)

```typescript
// backend/src/api/routes/auth.ts - Lines 21-100
router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('fullName').optional().trim().escape(),
  ],
  async (req: Request, res: Response) => {
    const { email, password, fullName } = req.body;
    
    // Validate password strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'Weak Password',
        details: passwordValidation.errors,
      });
    }
    
    // Check if email exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'User with this email already exists',
      });
    }
    
    // Hash and create user
    const passwordHash = await hashPassword(password);
    const [newUser] = await db.insert(users).values({
      email,
      passwordHash,
      fullName: fullName || null,
      emailVerified: true,
    }).returning();
    
    // Return JWT token
    const token = generateToken(newUser.id, newUser.email);
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: newUser.id, email: newUser.email },
    });
  }
);
```

**Status:** ✅ WORKING - Tested with curl

---

### ✅ Login Endpoint (Working)

```typescript
// backend/src/api/routes/auth.ts - Lines 106-184
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req: Request, res: Response) => {
    const { email, password } = req.body;
    
    // Find user
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    
    if (!user || !user.passwordHash) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }
    
    // Verify password
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }
    
    // Check active status
    if (!user.isActive) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Account is disabled',
      });
    }
    
    // Update login timestamp and generate token
    await db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    
    const token = generateToken(user.id, user.email);
    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email },
    });
  }
);
```

**Status:** ✅ WORKING - Tested with curl

---

### ✅ Auth Middleware (Working)

```typescript
// backend/src/api/middleware/auth.ts
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = extractTokenFromHeader(authHeader);
  
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No authentication token provided',
    });
  }
  
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
  
  req.user = {
    id: payload.userId,
    email: payload.email,
  };
  
  next();
}

// Usage in endpoints:
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  // Protected route - user is already verified here
  const userId = req.user!.id;
  // ...
});
```

**Status:** ✅ WORKING - Used on /api/auth/me endpoint

---

### ✅ Password Hashing & Validation (Working)

```typescript
// backend/src/lib/auth.ts

export async function hashPassword(plainPassword: string): Promise<string> {
  return await bcrypt.hash(plainPassword, 10); // 10 salt rounds
}

export async function verifyPassword(
  plainPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
```

**Status:** ✅ WORKING

---

### ✅ JWT Token Generation & Verification (Working)

```typescript
// backend/src/lib/auth.ts

export function generateToken(userId: string, email: string): string {
  const payload: JWTPayload = { userId, email };
  return jwt.sign(payload, JWT_SECRET!, {
    expiresIn: '7d', // 7 day expiration
  });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET!) as JWTPayload;
    return decoded;
  } catch (error) {
    return null; // Invalid or expired
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
}
```

**Status:** ✅ WORKING

---

### ✅ Rate Limiting (Working)

```typescript
// backend/src/api/middleware/rateLimiter.ts

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too Many Requests',
    message: 'Too many login attempts, please try again later.',
  },
  skipSuccessfulRequests: true, // Don't count successful attempts
  standardHeaders: true,
  legacyHeaders: false,
});

// Applied in routes:
router.post('/login', authLimiter, async (req, res) => {
  // Rate limited to 5 failed attempts per 15 minutes
});
```

**Status:** ✅ WORKING - Applied to /register and /login

---

## BACKEND: What's MISSING

### ❌ Google OAuth (NOT Implemented)

**What should exist:**

```typescript
// MISSING: backend/src/api/routes/auth.ts should have these endpoints:

// Step 1: Initiate OAuth
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
}));

// Step 2: Handle callback from Google
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req: Request, res: Response) => {
    // Get user from Passport
    const user = req.user as any;
    
    // Generate JWT token
    const token = generateToken(user.id, user.email);
    
    // Redirect to frontend with token in URL
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
  }
);
```

**What's also missing:**

```typescript
// MISSING: backend/src/api/server.ts should have this:
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

// Passport configuration
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  // Find or create user
  let user = await db.query.users.findFirst({
    where: or(
      eq(users.googleId, profile.id),
      eq(users.email, profile.emails[0].value)
    ),
  });
  
  if (!user) {
    // Create new user
    const [newUser] = await db.insert(users).values({
      googleId: profile.id,
      email: profile.emails[0].value,
      fullName: profile.displayName,
      avatarUrl: profile.photos[0]?.value,
      emailVerified: true,
    }).returning();
    user = newUser;
  } else if (!user.googleId) {
    // Link existing user to Google
    await db.update(users)
      .set({ googleId: profile.id })
      .where(eq(users.id, user.id));
  }
  
  return done(null, user);
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  done(null, user);
});
```

**Status:** ❌ NOT IMPLEMENTED - Planned for Week 2

---

### ❌ Password Reset (NOT Implemented)

**What should exist:**

```typescript
// MISSING: Endpoints needed in backend/src/api/routes/auth.ts

router.post('/password-reset-request', async (req: Request, res: Response) => {
  const { email } = req.body;
  
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  
  if (!user) {
    // Don't reveal if email exists
    return res.json({ message: 'If email exists, reset link sent' });
  }
  
  // Generate reset token (short-lived)
  const resetToken = generateToken(user.id, user.email); // Or use different secret
  
  // Store in database (implementation would need token table)
  // Send email with reset link
  // res.json({ message: 'Reset link sent' });
});

router.post('/password-reset', async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  
  // Verify token
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  
  // Validate new password
  const validation = validatePasswordStrength(newPassword);
  if (!validation.valid) {
    return res.status(400).json({ error: 'Weak password', details: validation.errors });
  }
  
  // Hash and update
  const newHash = await hashPassword(newPassword);
  await db.update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, payload.userId));
  
  res.json({ message: 'Password reset successful' });
});
```

**Status:** ❌ NOT IMPLEMENTED - Deferred to Phase 6

---

## FRONTEND: What EXISTS

### ✅ Basic Project Structure (Exists but incomplete)

```
frontend/src/
├── App.tsx ............................ Shows health check
├── main.tsx ........................... Entry point
├── pages/ ............................ EMPTY (needs Login, Register, Bookcase, Settings)
├── components/ ....................... EMPTY (needs Navigation, ProtectedRoute, etc)
├── hooks/ ............................ EMPTY (needs useAuth, etc)
├── lib/ .............................. EMPTY (needs auth store, api client)
├── types/ ............................ EMPTY (needs type definitions)
└── styles/
    └── index.css ..................... Configured
```

**Status:** ⚠️ STRUCTURE EXISTS but EMPTY - No functional components

---

### ❌ React Router (NOT Set Up)

**What should exist:**

```typescript
// MISSING: frontend/src/App.tsx should be rewritten like this:

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './lib/auth'; // NOT YET CREATED
import Login from './pages/Login'; // NOT YET CREATED
import Register from './pages/Register'; // NOT YET CREATED
import Bookcase from './pages/Bookcase'; // NOT YET CREATED
import Settings from './pages/Settings'; // NOT YET CREATED
import AuthCallback from './pages/AuthCallback'; // NOT YET CREATED
import ProtectedRoute from './components/ProtectedRoute'; // NOT YET CREATED
import Navigation from './components/Navigation'; // NOT YET CREATED

function App() {
  const { restoreSession, isAuthenticated, isLoading } = useAuthStore();
  
  useEffect(() => {
    restoreSession(); // Restore from localStorage on app load
  }, []);
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <Router>
      <Navigation />
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        
        {/* Protected routes */}
        <Route
          path="/bookcase"
          element={<ProtectedRoute><Bookcase /></ProtectedRoute>}
        />
        <Route
          path="/settings"
          element={<ProtectedRoute><Settings /></ProtectedRoute>}
        />
        
        {/* Default route */}
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to="/bookcase" /> : <Navigate to="/login" />}
        />
      </Routes>
    </Router>
  );
}

export default App;
```

**Status:** ❌ NOT IMPLEMENTED - Critical blocker

---

### ❌ Auth State Management (NOT Implemented)

**What should exist:**

```typescript
// MISSING: frontend/src/lib/auth.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api'; // Also missing

interface User {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
}

interface AuthStore {
  // State
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
  setUser: (user: User) => void;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      
      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await api.post('/auth/login', { email, password });
          set({
            token: response.data.token,
            user: response.data.user,
            isAuthenticated: true,
          });
        } catch (error) {
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },
      
      register: async (email: string, password: string, fullName?: string) => {
        set({ isLoading: true });
        try {
          const response = await api.post('/auth/register', {
            email,
            password,
            fullName,
          });
          set({
            token: response.data.token,
            user: response.data.user,
            isAuthenticated: true,
          });
        } catch (error) {
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },
      
      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      },
      
      setToken: (token: string) => {
        set({ token });
      },
      
      setUser: (user: User) => {
        set({ user, isAuthenticated: true });
      },
      
      restoreSession: async () => {
        // Try to restore from localStorage
        const token = localStorage.getItem('auth_token');
        if (token) {
          try {
            const response = await api.get('/auth/me');
            set({
              token,
              user: response.data.user,
              isAuthenticated: true,
            });
          } catch (error) {
            // Token invalid, clear it
            localStorage.removeItem('auth_token');
          }
        }
      },
    }),
    {
      name: 'auth-store', // localStorage key
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
    }
  )
);
```

**Status:** ❌ NOT IMPLEMENTED - Critical blocker

---

### ❌ API Client with Interceptors (NOT Implemented)

**What should exist:**

```typescript
// MISSING: frontend/src/lib/api.ts

import axios from 'axios';
import { useAuthStore } from './auth'; // Missing

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Add token to every request
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: Handle 401 errors (token expired)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired, clear auth and redirect to login
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

**Status:** ❌ NOT IMPLEMENTED - Critical blocker

---

### ❌ Login Page (NOT Implemented)

**What should exist:**

```typescript
// MISSING: frontend/src/pages/Login.tsx

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../lib/auth'; // Missing
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }
    
    setIsLoading(true);
    try {
      await login(email, password);
      toast.success('Login successful!');
      navigate('/bookcase');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6">Login to VividPages</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border rounded"
            disabled={isLoading}
          />
          
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 border rounded"
            disabled={isLoading}
          />
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 rounded font-medium"
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        
        <div className="mt-6 border-t pt-6">
          <a
            href="/api/auth/google"
            className="w-full bg-white border text-center py-2 rounded font-medium"
          >
            Login with Google
          </a>
        </div>
        
        <p className="text-center mt-6">
          Don't have an account? <Link to="/register" className="text-blue-600">Register</Link>
        </p>
      </div>
    </div>
  );
}
```

**Status:** ❌ NOT IMPLEMENTED

---

### ❌ Protected Route Component (NOT Implemented)

**What should exist:**

```typescript
// MISSING: frontend/src/components/ProtectedRoute.tsx

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth'; // Missing

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuthStore();
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  return <>{children}</>;
}
```

**Status:** ❌ NOT IMPLEMENTED

---

### ❌ Bookcase Page (NOT Implemented)

**What should exist:**

```typescript
// MISSING: frontend/src/pages/Bookcase.tsx

import { useAuthStore } from '../lib/auth'; // Missing

export default function Bookcase() {
  const { user } = useAuthStore();
  
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">My Bookcase</h1>
      
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">No VividPages yet</p>
        <p className="text-gray-500 mb-6">Upload your first EPUB to get started</p>
        <button className="bg-blue-600 text-white px-6 py-2 rounded">
          Generate New VividPage (Coming Soon)
        </button>
      </div>
    </div>
  );
}
```

**Status:** ❌ NOT IMPLEMENTED

---

## INTEGRATION: What's Missing

### ❌ Frontend Calling Backend Registration

**What should work:**

```typescript
// User fills in form in Login.tsx
const handleRegister = async (email: string, password: string) => {
  const response = await api.post('/auth/register', {
    email,
    password,
  });
  
  // Should store token:
  const { token, user } = response.data;
  localStorage.setItem('auth_token', token);
  
  // And redirect to bookcase
  navigate('/bookcase');
};
```

**Current Status:** ❌ Login page doesn't exist, API client not set up

---

### ❌ Frontend Calling Backend Login

**What should work:**

```typescript
// User submits login form
const { token, user } = await api.post('/auth/login', {
  email: 'user@example.com',
  password: 'Password123',
});

// Frontend receives token and stores it
localStorage.setItem('auth_token', token);

// Future requests automatically include token:
// Authorization: Bearer <token>
```

**Current Status:** ❌ Not implemented

---

### ❌ Protected Routes With Auth Check

**What should work:**

```typescript
// Frontend tries to access /bookcase
// ProtectedRoute checks auth status
// If not authenticated -> redirect to /login
// If authenticated -> show bookcase
```

**Current Status:** ❌ Not implemented

---

## SUMMARY TABLE

| Component | Backend | Frontend | Integration |
|-----------|---------|----------|-------------|
| **Register Endpoint** | ✅ Done | ❌ No UI | ❌ Not tested |
| **Login Endpoint** | ✅ Done | ❌ No UI | ❌ Not tested |
| **Auth Middleware** | ✅ Done | N/A | ❌ Not tested |
| **JWT Tokens** | ✅ Done | ❌ No storage | ❌ Not tested |
| **Rate Limiting** | ✅ Done | N/A | ❌ Not tested |
| **Google OAuth** | ❌ Missing | ❌ Missing | ❌ Missing |
| **React Router** | N/A | ❌ Missing | ❌ Missing |
| **Auth Store** | N/A | ❌ Missing | ❌ Missing |
| **API Client** | N/A | ❌ Missing | ❌ Missing |
| **Login Page** | N/A | ❌ Missing | ❌ Missing |
| **Register Page** | N/A | ❌ Missing | ❌ Missing |
| **Bookcase Page** | N/A | ❌ Missing | ❌ Missing |
| **Settings Page** | N/A | ❌ Missing | ❌ Missing |
| **Navigation** | N/A | ❌ Missing | ❌ Missing |
| **Protected Routes** | N/A | ❌ Missing | ❌ Missing |

---

## BLOCKERS FOR PHASE 1 COMPLETION

### Critical (Must Have):
1. **Frontend routing setup** - App.tsx with React Router
2. **Auth store** - Zustand for managing auth state
3. **API client** - Axios with token interceptors
4. **Login/Register pages** - User interfaces for auth
5. **Protected routes** - Route guards for authenticated pages

### High Priority (Should Have):
6. **Google OAuth** - Full implementation on backend & frontend
7. **Bookcase page** - Landing page after login
8. **Settings page** - User profile and API key management
9. **Navigation component** - Header showing auth status
10. **End-to-end testing** - Verify all flows work

---

## QUICK ACTION ITEMS

### This Week:
- [ ] Verify backend endpoints with curl commands
- [ ] Document curl test examples

### Next Week (Week 2):
- [ ] Configure Passport Google OAuth
- [ ] Implement OAuth endpoints

### Weeks 3-4:
- [ ] Set up React Router in App.tsx
- [ ] Create Zustand auth store
- [ ] Create API client
- [ ] Build all pages and components
- [ ] Implement protected routes
- [ ] End-to-end testing

