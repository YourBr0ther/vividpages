import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import Redis from 'ioredis';

let io: SocketIOServer | null = null;
let subscriber: Redis | null = null;

/**
 * Initialize Socket.IO server
 */
export function initializeSocket(server: HTTPServer, corsOrigin: string[]): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Subscribe to VividPage updates
    socket.on('subscribe:vividpage', (vividPageId: string) => {
      console.log(`📡 Client ${socket.id} subscribed to VividPage: ${vividPageId}`);
      socket.join(`vividpage:${vividPageId}`);
    });

    // Unsubscribe from VividPage updates
    socket.on('unsubscribe:vividpage', (vividPageId: string) => {
      console.log(`📡 Client ${socket.id} unsubscribed from VividPage: ${vividPageId}`);
      socket.leave(`vividpage:${vividPageId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });

  // Set up Redis subscriber for worker progress updates
  subscriber = new Redis({
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });

  subscriber.subscribe(
    'vividpage:progress',
    'vividpage:status',
    'vividpage:error',
    'vividpage:complete',
    (err) => {
      if (err) {
        console.error('❌ Failed to subscribe to Redis channels:', err);
      } else {
        console.log('✅ Subscribed to Redis progress channels');
      }
    }
  );

  subscriber.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);

      switch (channel) {
        case 'vividpage:progress':
          io?.to(`vividpage:${data.vividPageId}`).emit('progress', data);
          break;
        case 'vividpage:status':
          io?.to(`vividpage:${data.vividPageId}`).emit('status', data);
          break;
        case 'vividpage:error':
          io?.to(`vividpage:${data.vividPageId}`).emit('error', data);
          break;
        case 'vividpage:complete':
          io?.to(`vividpage:${data.vividPageId}`).emit('complete', data);
          break;
      }
    } catch (error) {
      console.error('Error processing Redis message:', error);
    }
  });

  console.log('✅ Socket.IO initialized with Redis pub/sub');

  return io;
}

/**
 * Get the Socket.IO instance
 */
export function getSocket(): SocketIOServer | null {
  return io;
}

/**
 * Emit progress update for a VividPage
 */
export function emitVividPageProgress(
  vividPageId: string,
  progressPercent: number,
  currentStep: string,
  additionalData?: Record<string, any>
) {
  if (io) {
    io.to(`vividpage:${vividPageId}`).emit('progress', {
      vividPageId,
      progressPercent,
      currentStep,
      timestamp: new Date().toISOString(),
      ...additionalData,
    });
  }
}

/**
 * Emit status update for a VividPage
 */
export function emitVividPageStatus(
  vividPageId: string,
  status: string,
  additionalData?: Record<string, any>
) {
  if (io) {
    io.to(`vividpage:${vividPageId}`).emit('status', {
      vividPageId,
      status,
      timestamp: new Date().toISOString(),
      ...additionalData,
    });
  }
}

/**
 * Emit error for a VividPage
 */
export function emitVividPageError(
  vividPageId: string,
  errorMessage: string
) {
  if (io) {
    io.to(`vividpage:${vividPageId}`).emit('error', {
      vividPageId,
      errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Emit completion for a VividPage
 */
export function emitVividPageComplete(
  vividPageId: string,
  data: Record<string, any>
) {
  if (io) {
    io.to(`vividpage:${vividPageId}`).emit('complete', {
      vividPageId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }
}
