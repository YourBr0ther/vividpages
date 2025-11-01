import { connection } from '../queue/connection.js';

/**
 * Emit progress update via Redis pub/sub
 * This allows workers to send progress updates to the API server,
 * which then emits them via Socket.IO to connected clients
 */
export function emitProgress(
  vividPageId: string,
  progressPercent: number,
  currentStep: string
) {
  connection.publish(
    'vividpage:progress',
    JSON.stringify({
      vividPageId,
      progressPercent,
      currentStep,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Emit status update via Redis pub/sub
 */
export function emitStatusUpdate(
  vividPageId: string,
  status: string,
  additionalData?: Record<string, any>
) {
  connection.publish(
    'vividpage:status',
    JSON.stringify({
      vividPageId,
      status,
      ...additionalData,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Emit error via Redis pub/sub
 */
export function emitErrorUpdate(
  vividPageId: string,
  errorMessage: string
) {
  connection.publish(
    'vividpage:error',
    JSON.stringify({
      vividPageId,
      errorMessage,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Emit completion via Redis pub/sub
 */
export function emitCompletion(
  vividPageId: string,
  data: Record<string, any>
) {
  connection.publish(
    'vividpage:complete',
    JSON.stringify({
      vividPageId,
      ...data,
      timestamp: new Date().toISOString(),
    })
  );
}
