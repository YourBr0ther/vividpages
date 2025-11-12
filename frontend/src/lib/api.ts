import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from './authStore';
import toast from 'react-hot-toast';

// Get API URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Debug: Log API URL
console.log('API URL:', API_URL);

// Create axios instance
export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Request interceptor - Add JWT token to all requests
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().token;

    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle 401 errors (unauthorized)
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Unauthorized - clear auth state and redirect to login
      const { logout } = useAuthStore.getState();
      logout();

      // Only show toast if not already on login page
      if (!window.location.pathname.includes('/login')) {
        toast.error('Your session has expired. Please log in again.');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// ============================================
// Auth API Functions
// ============================================

export interface RegisterData {
  email: string;
  password: string;
  fullName?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResponse {
  message: string;
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl?: string | null;
    createdAt: string;
  };
}

export interface UserResponse {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    emailVerified: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
}

/**
 * Register a new user with email and password
 */
export const register = async (data: RegisterData): Promise<AuthResponse> => {
  const response = await api.post<AuthResponse>('/api/auth/register', data);
  return response.data;
};

/**
 * Login with email and password
 */
export const login = async (data: LoginData): Promise<AuthResponse> => {
  const response = await api.post<AuthResponse>('/api/auth/login', data);
  return response.data;
};

/**
 * Get current user profile
 */
export const getCurrentUser = async (): Promise<UserResponse> => {
  const response = await api.get<UserResponse>('/api/auth/me');
  return response.data;
};

/**
 * Logout (client-side token removal)
 */
export const logout = async (): Promise<void> => {
  try {
    await api.post('/api/auth/logout');
  } catch (error) {
    // Ignore errors on logout
    console.error('Logout error:', error);
  }
};

// ============================================
// VividPages API Functions
// ============================================

export interface VividPage {
  id: string;
  userId: string;
  title: string;
  author: string | null;
  isbn: string | null;
  language: string | null;
  epubFilename: string;
  epubPath: string;
  epubSizeBytes: number;
  epubHash: string | null;
  coverImagePath: string | null;
  stylePreset: string | null;
  llmModel: string | null;
  imageModel: string | null;
  settings: Record<string, any>;
  status: 'uploading' | 'parsing' | 'scenes_detected' | 'analyzing' | 'analyzed' | 'discovering_characters' | 'building_character_profiles' | 'characters_discovered' | 'generating' | 'completed' | 'failed';
  progressPercent: number;
  currentStep: string | null;
  errorMessage: string | null;
  totalChapters: number | null;
  totalScenes: number | null;
  totalStoryboards: number | null;
  totalCharacters: number | null;
  wordCount: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Scene {
  id: string;
  vividPageId: string;
  chapterNumber: number;
  chapterTitle: string;
  sceneNumber: number;
  sceneIndexGlobal: number;
  textContent: string;
  wordCount: number;
  sceneType: string;
  hasDialogue: boolean;
  characterCount: number;
  llmAnalysis: {
    characters: Array<{
      name: string;
      description: string;
    }>;
    setting: string;
    timeOfDay: string | null;
    weather: string | null;
    mood: string;
    visualElements: string[];
    keyActions: string[];
  } | null;
  analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
  analyzedAt: string | null;
  analysisError: string | null;
  imagePrompt: string | null;
  createdAt: string;
}

export interface UploadResponse {
  success: boolean;
  vividPage: {
    id: string;
    title: string;
    filename: string;
    status: string;
    progressPercent: number;
  };
}

/**
 * Upload an EPUB file
 */
export const uploadEpub = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('epub', file);

  const response = await api.post<UploadResponse>('/api/vividpages/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

/**
 * Get all VividPages for the current user
 */
export const getVividPages = async (): Promise<VividPage[]> => {
  const response = await api.get<VividPage[]>('/api/vividpages');
  return response.data;
};

/**
 * Get a single VividPage by ID
 */
export const getVividPage = async (id: string): Promise<VividPage> => {
  const response = await api.get<VividPage>(`/api/vividpages/${id}`);
  return response.data;
};

/**
 * Get VividPage status (for polling)
 */
export const getVividPageStatus = async (id: string): Promise<{
  status: string;
  progressPercent: number;
  currentStep: string | null;
  errorMessage: string | null;
  totalChapters: number | null;
  totalScenes: number | null;
}> => {
  const response = await api.get(`/api/vividpages/${id}/status`);
  return response.data;
};

/**
 * Get scenes for a VividPage
 */
export const getVividPageScenes = async (id: string): Promise<Scene[]> => {
  const response = await api.get<Scene[]>(`/api/vividpages/${id}/scenes`);
  return response.data;
};

/**
 * Retry processing a failed VividPage
 */
export const retryVividPage = async (id: string): Promise<{
  success: boolean;
  message: string;
  vividPage: {
    id: string;
    status: string;
    progressPercent: number;
  };
}> => {
  const response = await api.post(`/api/vividpages/${id}/retry`);
  return response.data;
};

/**
 * Delete a VividPage
 */
export const deleteVividPage = async (id: string): Promise<{
  success: boolean;
  message: string;
}> => {
  const response = await api.delete(`/api/vividpages/${id}`);
  return response.data;
};

/**
 * Trigger scene analysis for a VividPage
 */
export const triggerSceneAnalysis = async (id: string, limit?: number): Promise<{
  success: boolean;
  message: string;
  vividPage: {
    id: string;
    status: string;
    progressPercent: number;
  };
}> => {
  const response = await api.post(`/api/vividpages/${id}/analyze`, { limit });
  return response.data;
};

/**
 * Get a single scene with analysis data
 */
export const getScene = async (vividPageId: string, sceneId: string): Promise<Scene> => {
  const response = await api.get<Scene>(`/api/vividpages/${vividPageId}/scenes/${sceneId}`);
  return response.data;
};

// ============================================
// API Keys
// ============================================

export interface ApiKey {
  id: string;
  provider: string;
  nickname: string | null;
  maskedKey: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApiKeyData {
  provider: 'claude' | 'chatgpt' | 'ollama' | 'dall-e' | 'stable-diffusion' | 'other';
  apiKey: string;
  nickname?: string;
}

export interface UpdateApiKeyData {
  provider?: string;
  apiKey?: string;
  nickname?: string;
}

export interface TestApiKeyResult {
  success: boolean;
  message: string;
  details?: any;
}

/**
 * Get all API keys for the authenticated user
 */
export const getApiKeys = async (): Promise<ApiKey[]> => {
  const response = await api.get<{ success: boolean; apiKeys: ApiKey[] }>('/api/api-keys');
  return response.data.apiKeys;
};

/**
 * Create a new API key
 */
export const createApiKey = async (data: CreateApiKeyData): Promise<ApiKey> => {
  const response = await api.post<{ success: boolean; apiKey: ApiKey; message: string }>('/api/api-keys', data);
  return response.data.apiKey;
};

/**
 * Update an existing API key
 */
export const updateApiKey = async (id: string, data: UpdateApiKeyData): Promise<ApiKey> => {
  const response = await api.put<{ success: boolean; apiKey: ApiKey; message: string }>(`/api/api-keys/${id}`, data);
  return response.data.apiKey;
};

/**
 * Delete an API key
 */
export const deleteApiKey = async (id: string): Promise<void> => {
  await api.delete(`/api/api-keys/${id}`);
};

/**
 * Test an API key before saving
 */
export const testApiKey = async (provider: string, apiKey: string): Promise<TestApiKeyResult> => {
  const response = await api.post<TestApiKeyResult>('/api/api-keys/test', { provider, apiKey });
  return response.data;
};

// ============================================
// Characters
// ============================================

export interface CharacterAppearance {
  physicalDescription: string;
  visualSummary: string;
  ageAppearance: string;
  age: string;
  height: string;
  build: string;
  bodyType: string;
  bustSize: string;
  shoulders: string;
  hairColor: string;
  hairStyle: string;
  hairLength: string;
  hairTexture: string;
  eyeColor: string;
  eyeShape: string;
  eyebrows: string;
  faceShape: string;
  jawline: string;
  cheekbones: string;
  nose: string;
  lips: string;
  skinTone: string;
  complexion: string;
  ethnicity: string;
  facialHair: string;
  voice: string;
  accent: string;
  posture: string;
  gait: string;
  distinctiveFeatures: string[];
  tattoos: string[];
  piercings: string[];
  accessories: string[];
  typicalClothing: string;
  clothingColors: string[];
  overallStyle: string;
}

export interface Character {
  id: string;
  vividPageId: string;
  name: string;
  aliases: string[];
  initialAppearance: CharacterAppearance;
  referenceImagePath: string | null;
  role: 'protagonist' | 'antagonist' | 'supporting' | 'minor';
  firstAppearanceScene: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoverCharactersResponse {
  success: boolean;
  message: string;
  jobId: string;
  vividPage: {
    id: string;
    status: string;
    progressPercent: number;
  };
}

export interface SimilarCharacter {
  character: Character;
  similarity: number;
}

/**
 * Get all discovered characters for a VividPage
 */
export const getCharacters = async (vividPageId: string): Promise<Character[]> => {
  const response = await api.get<{ success: boolean; characters: Character[] }>(
    `/api/vividpages/${vividPageId}/characters`
  );
  return response.data.characters;
};

/**
 * Trigger character discovery for a VividPage
 */
export const discoverCharacters = async (
  vividPageId: string,
  options?: { provider?: string; model?: string }
): Promise<DiscoverCharactersResponse> => {
  const response = await api.post<DiscoverCharactersResponse>(
    `/api/vividpages/${vividPageId}/discover-characters`,
    options
  );
  return response.data;
};

/**
 * Regenerate embedding for a character
 */
export const regenerateCharacterEmbedding = async (
  vividPageId: string,
  characterId: string,
  provider?: string
): Promise<{ success: boolean; message: string }> => {
  const response = await api.post(
    `/api/vividpages/${vividPageId}/characters/${characterId}/regenerate-embedding`,
    { provider }
  );
  return response.data;
};

/**
 * Find similar characters using embeddings
 */
export const getSimilarCharacters = async (
  vividPageId: string,
  characterId: string,
  limit?: number
): Promise<SimilarCharacter[]> => {
  const response = await api.get<{ success: boolean; similar: SimilarCharacter[] }>(
    `/api/vividpages/${vividPageId}/characters/${characterId}/similar`,
    { params: { limit } }
  );
  return response.data.similar;
};

// ============================================
// Health Check
// ============================================

export interface HealthStatus {
  status: string;
  timestamp: string;
  database: string;
  version: string;
}

export const checkHealth = async (): Promise<HealthStatus> => {
  const response = await api.get<HealthStatus>('/api/health');
  return response.data;
};
