import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { getCurrentUser } from '../lib/api';
import toast from 'react-hot-toast';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, setLoading } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      setLoading(true);

      // Get token from URL
      const token = searchParams.get('token');

      if (!token) {
        toast.error('No authentication token received');
        navigate('/login');
        setLoading(false);
        return;
      }

      try {
        // Store token first
        useAuthStore.getState().setToken(token);

        // Fetch user profile using the token
        const response = await getCurrentUser();

        // Store user in auth store
        login(token, response.user);

        toast.success('Successfully signed in with Google!');
        navigate('/bookcase');
      } catch (error: any) {
        console.error('OAuth callback error:', error);

        const errorMessage =
          error.response?.data?.message ||
          error.response?.data?.error ||
          'Failed to complete authentication. Please try again.';

        toast.error(errorMessage);
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };

    handleCallback();
  }, [searchParams, navigate, login, setLoading]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mb-4"></div>
        <h2 className="text-2xl font-semibold text-gray-800">Completing sign in...</h2>
        <p className="text-gray-600 mt-2">Please wait while we set up your account</p>
      </div>
    </div>
  );
}
