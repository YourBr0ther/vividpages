import { useAuthStore } from '../lib/authStore';
import ApiKeyManager from '../components/ApiKeyManager';

export default function Settings() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Settings</h1>
          <p className="text-gray-600">Manage your account and API integrations</p>
        </div>

        {/* Profile Section */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200 mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Profile</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200 text-gray-700">
                {user?.email}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Full Name
              </label>
              <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200 text-gray-700">
                {user?.fullName || 'Not set'}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Verified
              </label>
              <div className="flex items-center gap-2">
                {user?.emailVerified ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                    Not verified
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* API Keys Section */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <ApiKeyManager />
        </div>
      </div>
    </div>
  );
}
