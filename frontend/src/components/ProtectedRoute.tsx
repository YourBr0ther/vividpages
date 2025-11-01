import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, token } = useAuthStore();

  // If not authenticated, redirect to login
  if (!isAuthenticated || !token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
