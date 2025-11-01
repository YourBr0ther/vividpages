import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { register as apiRegister } from '../lib/api';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
  requirements: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
  };
}

export default function Register() {
  const navigate = useNavigate();
  const { login, setLoading } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength>({
    score: 0,
    label: '',
    color: '',
    requirements: {
      minLength: false,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
    },
  });

  // Calculate password strength
  useEffect(() => {
    if (!password) {
      setPasswordStrength({
        score: 0,
        label: '',
        color: '',
        requirements: {
          minLength: false,
          hasUppercase: false,
          hasLowercase: false,
          hasNumber: false,
        },
      });
      return;
    }

    const requirements = {
      minLength: password.length >= 8,
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
    };

    const score = Object.values(requirements).filter(Boolean).length;

    let label = '';
    let color = '';

    if (score <= 1) {
      label = 'Weak';
      color = 'bg-red-500';
    } else if (score === 2) {
      label = 'Fair';
      color = 'bg-orange-500';
    } else if (score === 3) {
      label = 'Good';
      color = 'bg-yellow-500';
    } else {
      label = 'Strong';
      color = 'bg-green-500';
    }

    setPasswordStrength({
      score,
      label,
      color,
      requirements,
    });
  }, [password]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // Validation
    if (!email || !password) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (passwordStrength.score < 4) {
      toast.error('Please use a stronger password that meets all requirements');
      return;
    }

    setIsSubmitting(true);
    setLoading(true);

    try {
      const response = await apiRegister({
        email,
        password,
        fullName: fullName || undefined,
      });

      // Store token and user in auth store
      login(response.token, {
        id: response.user.id,
        email: response.user.email,
        fullName: response.user.fullName,
        avatarUrl: response.user.avatarUrl || null,
        emailVerified: true,
        createdAt: response.user.createdAt,
        lastLoginAt: new Date().toISOString(),
      });

      toast.success('Account created successfully!');
      navigate('/bookcase');
    } catch (error: any) {
      console.error('Registration error:', error);

      const errorMessage =
        error.response?.data?.message ||
        error.response?.data?.error ||
        'Registration failed. Please try again.';

      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
      setLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    // Redirect to backend Google OAuth endpoint
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Vivid<span className="text-indigo-600">Pages</span>
          </h1>
          <p className="text-gray-600">Create your account</p>
        </div>

        {/* Register Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Full Name Field */}
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
                Full Name <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                placeholder="John Doe"
              />
            </div>

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                placeholder="you@example.com"
                required
              />
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                placeholder="Create a strong password"
                required
              />

              {/* Password Strength Indicator */}
              {password && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Password strength:</span>
                    <span className={`text-sm font-medium ${
                      passwordStrength.score <= 1 ? 'text-red-600' :
                      passwordStrength.score === 2 ? 'text-orange-600' :
                      passwordStrength.score === 3 ? 'text-yellow-600' :
                      'text-green-600'
                    }`}>
                      {passwordStrength.label}
                    </span>
                  </div>

                  {/* Strength Bar */}
                  <div className="flex gap-1 mb-3">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-2 flex-1 rounded-full ${
                          level <= passwordStrength.score
                            ? passwordStrength.color
                            : 'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Requirements */}
                  <div className="space-y-1 text-sm">
                    <div className={passwordStrength.requirements.minLength ? 'text-green-600' : 'text-gray-500'}>
                      {passwordStrength.requirements.minLength ? '✓' : '○'} At least 8 characters
                    </div>
                    <div className={passwordStrength.requirements.hasUppercase ? 'text-green-600' : 'text-gray-500'}>
                      {passwordStrength.requirements.hasUppercase ? '✓' : '○'} One uppercase letter
                    </div>
                    <div className={passwordStrength.requirements.hasLowercase ? 'text-green-600' : 'text-gray-500'}>
                      {passwordStrength.requirements.hasLowercase ? '✓' : '○'} One lowercase letter
                    </div>
                    <div className={passwordStrength.requirements.hasNumber ? 'text-green-600' : 'text-gray-500'}>
                      {passwordStrength.requirements.hasNumber ? '✓' : '○'} One number
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || passwordStrength.score < 4}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">Or continue with</span>
            </div>
          </div>

          {/* Google OAuth Button */}
          <button
            type="button"
            onClick={handleGoogleSignup}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign up with Google
          </button>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
