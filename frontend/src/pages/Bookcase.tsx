import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '../lib/authStore';
import { getVividPages, retryVividPage, VividPage } from '../lib/api';
import { EpubUploader } from '../components/EpubUploader';

export default function Bookcase() {
  const { user } = useAuthStore();
  const [showUploader, setShowUploader] = useState(false);

  // Fetch VividPages
  const { data: vividPages = [], refetch, isLoading } = useQuery({
    queryKey: ['vividPages'],
    queryFn: getVividPages,
    refetchInterval: 5000, // Refetch every 5 seconds to update progress
  });

  const handleUploadComplete = () => {
    refetch();
    setShowUploader(false);
  };

  const handleRetry = async (vividPageId: string) => {
    try {
      await retryVividPage(vividPageId);
      toast.success('Retrying processing...');
      refetch();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Retry failed';
      toast.error(errorMessage);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'scenes_detected':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'uploading':
      case 'parsing':
      case 'analyzing':
      case 'generating':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'uploading':
        return 'Uploading...';
      case 'parsing':
        return 'Processing...';
      case 'scenes_detected':
        return 'Ready';
      case 'analyzing':
        return 'Analyzing...';
      case 'generating':
        return 'Generating...';
      case 'completed':
        return 'Complete';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Welcome back{user?.fullName ? `, ${user.fullName}` : ''}!
            </h1>
            <p className="text-gray-600">Your personal bookcase of VividPages</p>
          </div>

          <button
            onClick={() => setShowUploader(!showUploader)}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition"
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
            Upload EPUB
          </button>
        </div>

        {/* Upload Section */}
        {showUploader && (
          <div className="mb-8 max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-800">
                  Upload New EPUB
                </h2>
                <button
                  onClick={() => setShowUploader(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <EpubUploader onUploadComplete={handleUploadComplete} />
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">⏳</div>
            <p className="text-gray-600">Loading your bookcase...</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && vividPages.length === 0 && (
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
                onClick={() => setShowUploader(true)}
                className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition"
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
                Upload EPUB
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
        )}

        {/* VividPages Grid */}
        {!isLoading && vividPages.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {vividPages.map((vividPage: VividPage) => (
              <div
                key={vividPage.id}
                className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden hover:shadow-xl transition"
              >
                {/* Cover Image */}
                <div className="h-64 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center relative">
                  {vividPage.coverImagePath ? (
                    <img
                      src={`${import.meta.env.VITE_API_URL}/api/vividpages/${vividPage.id}/cover`}
                      alt={vividPage.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-8xl">📖</div>
                  )}

                  {/* Status Badge */}
                  <div className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(vividPage.status)}`}>
                    {getStatusLabel(vividPage.status)}
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-1 truncate" title={vividPage.title}>
                    {vividPage.title}
                  </h3>

                  {vividPage.author && (
                    <p className="text-sm text-gray-600 mb-3 truncate">
                      by {vividPage.author}
                    </p>
                  )}

                  {/* Progress Bar (for processing states) */}
                  {['uploading', 'parsing', 'analyzing', 'generating'].includes(vividPage.status) && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Processing</span>
                        <span className="text-xs text-gray-600">{vividPage.progressPercent}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${vividPage.progressPercent}%` }}
                        />
                      </div>
                      {vividPage.currentStep && (
                        <p className="text-xs text-gray-500 mt-1">{vividPage.currentStep}</p>
                      )}
                    </div>
                  )}

                  {/* Stats */}
                  {vividPage.status === 'scenes_detected' && (
                    <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                      <div className="bg-gray-50 rounded p-2">
                        <div className="text-gray-500">Chapters</div>
                        <div className="font-semibold text-gray-900">{vividPage.totalChapters || 0}</div>
                      </div>
                      <div className="bg-gray-50 rounded p-2">
                        <div className="text-gray-500">Scenes</div>
                        <div className="font-semibold text-gray-900">{vividPage.totalScenes || 0}</div>
                      </div>
                    </div>
                  )}

                  {/* Error Message */}
                  {vividPage.status === 'failed' && vividPage.errorMessage && (
                    <div className="mb-3 p-2 bg-red-50 rounded text-xs text-red-700">
                      {vividPage.errorMessage}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {vividPage.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(vividPage.id)}
                        className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
                      >
                        Retry
                      </button>
                    )}

                    {vividPage.status === 'scenes_detected' && (
                      <button
                        disabled
                        className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        View Scenes
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
