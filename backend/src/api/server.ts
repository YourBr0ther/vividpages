import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as dotenv from 'dotenv';
import { pool } from '../db/index.js';
import authRoutes from './routes/auth.js';
import vividpagesRoutes from './routes/vividpages.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import passport from '../lib/passport.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 4000;

// ============================================
// Middleware
// ============================================

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://vividpages.hiddencasa.com',
    'https://vividpages.hiddencasa.com',
    /^http:\/\/10\.0\.2\.\d+:3000$/, // Allow any IP in 10.0.2.x range
  ],
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Passport initialization
app.use(passport.initialize());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Rate limiting
app.use('/api', apiLimiter);

// ============================================
// Routes
// ============================================

// Auth routes
app.use('/api/auth', authRoutes);

// VividPages routes
app.use('/api/vividpages', vividpagesRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Check database connection
    const result = await pool.query('SELECT NOW()');

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      dbTime: result.rows[0].now,
      version: '1.0.0',
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'VividPages API',
    version: '1.0.0',
    description: 'Transform books into immersive visual experiences',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      vividpages: '/api/vividpages',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// ============================================
// Server Startup
// ============================================

const server = app.listen(PORT, () => {
  console.log('');
  console.log('🚀 VividPages API Server Started');
  console.log('================================');
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌 Port: ${PORT}`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
  console.log('================================');
  console.log('');
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');

  server.close(async () => {
    console.log('✅ HTTP server closed');

    try {
      await pool.end();
      console.log('✅ Database pool closed');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
