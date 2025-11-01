import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface ProgressUpdate {
  vividPageId: string;
  progressPercent: number;
  currentStep: string;
  timestamp: string;
}

export interface StatusUpdate {
  vividPageId: string;
  status: string;
  timestamp: string;
  totalChapters?: number;
  totalScenes?: number;
}

export interface ErrorUpdate {
  vividPageId: string;
  errorMessage: string;
  timestamp: string;
}

export interface CompletionUpdate {
  vividPageId: string;
  chaptersProcessed: number;
  scenesDetected: number;
  wordCount: number;
  timestamp: string;
}

export interface SocketCallbacks {
  onProgress?: (data: ProgressUpdate) => void;
  onStatus?: (data: StatusUpdate) => void;
  onError?: (data: ErrorUpdate) => void;
  onComplete?: (data: CompletionUpdate) => void;
}

/**
 * Hook to manage Socket.IO connection and subscriptions for a VividPage
 */
export function useSocket(vividPageId: string | null, callbacks: SocketCallbacks) {
  const socketRef = useRef<Socket | null>(null);

  // Connect to Socket.IO server
  useEffect(() => {
    if (!socketRef.current) {
      console.log('🔌 Connecting to Socket.IO server...');
      socketRef.current = io(API_URL, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
      });

      socketRef.current.on('connect', () => {
        console.log('✅ Connected to Socket.IO server');
      });

      socketRef.current.on('disconnect', () => {
        console.log('🔌 Disconnected from Socket.IO server');
      });

      socketRef.current.on('connect_error', (error) => {
        console.error('❌ Socket.IO connection error:', error);
      });
    }

    return () => {
      if (socketRef.current) {
        console.log('🔌 Disconnecting from Socket.IO server...');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  // Subscribe to VividPage updates
  useEffect(() => {
    if (!vividPageId || !socketRef.current) return;

    const socket = socketRef.current;
    const { onProgress, onStatus, onError, onComplete } = callbacks;

    console.log(`📡 Subscribing to VividPage: ${vividPageId}`);
    socket.emit('subscribe:vividpage', vividPageId);

    // Set up event listeners
    if (onProgress) {
      socket.on('progress', onProgress);
    }

    if (onStatus) {
      socket.on('status', onStatus);
    }

    if (onError) {
      socket.on('error', onError);
    }

    if (onComplete) {
      socket.on('complete', onComplete);
    }

    // Cleanup
    return () => {
      console.log(`📡 Unsubscribing from VividPage: ${vividPageId}`);
      socket.emit('unsubscribe:vividpage', vividPageId);
      socket.off('progress');
      socket.off('status');
      socket.off('error');
      socket.off('complete');
    };
  }, [vividPageId, callbacks]);

  const subscribe = useCallback((id: string) => {
    if (socketRef.current) {
      console.log(`📡 Subscribing to VividPage: ${id}`);
      socketRef.current.emit('subscribe:vividpage', id);
    }
  }, []);

  const unsubscribe = useCallback((id: string) => {
    if (socketRef.current) {
      console.log(`📡 Unsubscribing from VividPage: ${id}`);
      socketRef.current.emit('unsubscribe:vividpage', id);
    }
  }, []);

  return {
    socket: socketRef.current,
    subscribe,
    unsubscribe,
  };
}
