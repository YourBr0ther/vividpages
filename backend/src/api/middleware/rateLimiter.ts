import rateLimit from 'express-rate-limit';

// Development vs Production rate limits
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * General API rate limiter
 * Development: 1000 requests per 15 minutes
 * Production: 100 requests per 15 minutes
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 100, // Much higher limit for development
  message: {
    error: 'Too Many Requests',
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  validate: false, // Disable validations in development
});

/**
 * Strict rate limiter for authentication endpoints
 * Development: 50 requests per 15 minutes
 * Production: 5 requests per 15 minutes
 * Helps prevent brute force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 50 : 5, // Much higher limit for development testing
  message: {
    error: 'Too Many Requests',
    message: 'Too many login attempts, please try again later.',
  },
  skipSuccessfulRequests: true, // Don't count successful requests
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable validations in development
});
