import { useState, useEffect } from 'react';
import axios from 'axios';

interface HealthStatus {
  status: string;
  timestamp: string;
  database: string;
  version: string;
}

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await axios.get<HealthStatus>('/api/health');
        setHealth(response.data);
        setError(null);
      } catch (err) {
        setError('Failed to connect to API');
        console.error('Health check failed:', err);
      } finally {
        setLoading(false);
      }
    };

    checkHealth();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold text-gray-900 mb-4">
            Vivid<span className="text-primary-600">Pages</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Transform your favorite books into immersive visual experiences with AI-generated storyboards
          </p>
        </div>

        {/* Status Card */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">System Status</h2>

            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800 font-medium">❌ {error}</p>
              </div>
            )}

            {health && !loading && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                  <span className="text-green-800 font-medium">API Status</span>
                  <span className="text-green-600 text-2xl">✅</span>
                </div>

                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <span className="text-blue-800 font-medium">Database</span>
                  <span className="text-blue-600 capitalize">{health.database}</span>
                </div>

                <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <span className="text-purple-800 font-medium">Version</span>
                  <span className="text-purple-600">{health.version}</span>
                </div>

                <div className="text-sm text-gray-500 text-center mt-4">
                  Last checked: {new Date(health.timestamp).toLocaleString()}
                </div>
              </div>
            )}
          </div>

          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            <div className="bg-white rounded-xl shadow-lg p-6 text-center border border-gray-200">
              <div className="text-4xl mb-3">📚</div>
              <h3 className="font-semibold text-gray-800">EPUB Processing</h3>
              <p className="text-sm text-gray-600 mt-2">Parse and analyze book content</p>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 text-center border border-gray-200">
              <div className="text-4xl mb-3">🤖</div>
              <h3 className="font-semibold text-gray-800">AI Analysis</h3>
              <p className="text-sm text-gray-600 mt-2">Character & scene detection</p>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 text-center border border-gray-200">
              <div className="text-4xl mb-3">🎨</div>
              <h3 className="font-semibold text-gray-800">Image Generation</h3>
              <p className="text-sm text-gray-600 mt-2">Create stunning storyboards</p>
            </div>
          </div>

          {/* Phase Info */}
          <div className="mt-8 text-center">
            <div className="inline-block bg-yellow-50 border border-yellow-200 rounded-lg px-6 py-3">
              <p className="text-yellow-800 font-medium">
                🚧 Phase 0: Foundation & Setup - In Progress
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
