import Redis from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

// Redis connection configuration
export const connection = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

connection.on('connect', () => {
  console.log('✅ Connected to Redis');
});

connection.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

connection.on('ready', () => {
  console.log('✅ Redis is ready');
});
