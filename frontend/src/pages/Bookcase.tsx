import { useAuthStore } from '../lib/authStore';

export default function Bookcase() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Welcome back{user?.fullName ? `, ${user.fullName}` : ''}!
          </h1>
          <p className="text-gray-600">Your personal bookcase of VividPages</p>
        </div>

        {/* Empty State */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-12 border border-gray-200 text-center">
            <div className="text-6xl mb-6">📚</div>
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">
              Your bookcase is empty
            </h2>
            <p className="text-gray-600 mb-8">
              Start transforming your favorite books into immersive visual experiences.
              Upload your first EPUB to get started!
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
              Upload EPUB (Coming Soon)
            </button>

            {/* Info */}
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                <div className="text-3xl mb-2">📖</div>
                <h3 className="font-semibold text-gray-800 mb-1">Upload EPUB</h3>
                <p className="text-sm text-gray-600">
                  Upload any EPUB book from your collection
                </p>
              </div>

              <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="text-3xl mb-2">🤖</div>
                <h3 className="font-semibold text-gray-800 mb-1">AI Analysis</h3>
                <p className="text-sm text-gray-600">
                  Our AI identifies characters, scenes, and settings
                </p>
              </div>

              <div className="p-4 bg-pink-50 rounded-lg border border-pink-200">
                <div className="text-3xl mb-2">🎨</div>
                <h3 className="font-semibold text-gray-800 mb-1">Generate Art</h3>
                <p className="text-sm text-gray-600">
                  Beautiful storyboard images bring your book to life
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Phase Info */}
        <div className="mt-8 text-center">
          <div className="inline-block bg-yellow-50 border border-yellow-200 rounded-lg px-6 py-3">
            <p className="text-yellow-800 font-medium">
              Phase 1: Authentication - In Progress
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              EPUB processing coming in Phase 2
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
