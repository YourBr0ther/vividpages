import { useAuthStore } from '../lib/authStore';

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
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">API Keys</h2>
          <p className="text-gray-600 mb-6">
            Configure your API keys for AI and image generation services
          </p>

          {/* Empty State */}
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <div className="text-4xl mb-4">🔑</div>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              API Key Management
            </h3>
            <p className="text-gray-600 mb-6">
              Add your API keys for Anthropic Claude, OpenAI, and image generation services
            </p>

            <button
              disabled
              className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add API Key (Coming Soon)
            </button>
          </div>

          {/* Info */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex gap-3">
              <svg
                className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">Your API keys are encrypted</p>
                <p className="text-blue-700">
                  All API keys are encrypted using AES-256-GCM and stored securely. They are
                  only decrypted when needed for processing your books.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Phase Info */}
        <div className="mt-8 text-center">
          <div className="inline-block bg-yellow-50 border border-yellow-200 rounded-lg px-6 py-3">
            <p className="text-yellow-800 font-medium">
              Phase 1: Authentication Complete
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              API key management coming in Phase 2-3
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
