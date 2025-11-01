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
