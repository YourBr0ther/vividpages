import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getVividPage, getVividPageScenes, triggerSceneAnalysis, Scene } from '../lib/api';

export default function VividPageViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Fetch VividPage details
  const { data: vividPage, refetch: refetchVividPage, isLoading: isLoadingVividPage } = useQuery({
    queryKey: ['vividPage', id],
    queryFn: () => getVividPage(id!),
    enabled: !!id,
    refetchInterval: (data) => {
      // Poll while analyzing
      if (data?.status === 'analyzing') {
        return 3000; // 3 seconds
      }
      return false;
    },
  });

  // Fetch scenes
  const { data: scenes = [], refetch: refetchScenes, isLoading: isLoadingScenes } = useQuery({
    queryKey: ['scenes', id],
    queryFn: () => getVividPageScenes(id!),
    enabled: !!id,
  });

  const handleTriggerAnalysis = async () => {
    if (!id) return;

    try {
      setIsAnalyzing(true);
      await triggerSceneAnalysis(id);
      toast.success('Scene analysis started!');
      refetchVividPage();
      refetchScenes();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Failed to start analysis';
      toast.error(errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSceneClick = (scene: Scene) => {
    setSelectedScene(scene);
  };

  const handleBack = () => {
    navigate('/bookcase');
  };

  if (isLoadingVividPage || isLoadingScenes) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-gray-600">Loading VividPage...</p>
        </div>
      </div>
    );
  }

  if (!vividPage) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">📚</div>
          <p className="text-gray-600 mb-4">VividPage not found</p>
          <button
            onClick={handleBack}
            className="inline-block bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition"
          >
            Back to Bookcase
          </button>
        </div>
      </div>
    );
  }

  const canAnalyze = vividPage.status === 'scenes_detected' || vividPage.status === 'analyzed';
  const isCurrentlyAnalyzing = vividPage.status === 'analyzing';

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Bookcase
          </button>

          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-4xl font-bold text-gray-900 mb-2">{vividPage.title}</h1>
              {vividPage.author && (
                <p className="text-xl text-gray-600 mb-4">by {vividPage.author}</p>
              )}

              <div className="flex gap-4 text-sm text-gray-600">
                {vividPage.totalChapters !== null && (
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <span>{vividPage.totalChapters} chapters</span>
                  </div>
                )}
                {vividPage.totalScenes !== null && (
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                    </svg>
                    <span>{vividPage.totalScenes} scenes</span>
                  </div>
                )}
                {vividPage.wordCount !== null && (
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>{vividPage.wordCount.toLocaleString()} words</span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Button */}
            {canAnalyze && !isCurrentlyAnalyzing && (
              <button
                onClick={handleTriggerAnalysis}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                {isAnalyzing ? 'Starting...' : 'Analyze Scenes'}
              </button>
            )}

            {isCurrentlyAnalyzing && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  <div>
                    <div className="text-sm font-medium text-blue-900">Analyzing scenes...</div>
                    <div className="text-xs text-blue-700">{vividPage.progressPercent}% complete</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Scene List */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Scenes</h2>

              <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto">
                {scenes.map((scene) => (
                  <button
                    key={scene.id}
                    onClick={() => handleSceneClick(scene)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      selectedScene?.id === scene.id
                        ? 'bg-indigo-50 border-indigo-300'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        Scene {scene.sceneNumber}
                      </span>
                      {scene.analysisStatus === 'completed' && (
                        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                      {scene.analysisStatus === 'processing' && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 truncate">{scene.chapterTitle}</div>
                    <div className="text-xs text-gray-500 mt-1">{scene.wordCount} words</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Scene Detail */}
          <div className="lg:col-span-2">
            {selectedScene ? (
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
                {/* Scene Header */}
                <div className="mb-6 pb-6 border-b border-gray-200">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="text-2xl font-semibold text-gray-900">
                        Scene {selectedScene.sceneNumber}
                      </h3>
                      <p className="text-gray-600">{selectedScene.chapterTitle}</p>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                      selectedScene.analysisStatus === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : selectedScene.analysisStatus === 'processing'
                        ? 'bg-blue-100 text-blue-800'
                        : selectedScene.analysisStatus === 'failed'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedScene.analysisStatus === 'completed' && '✓ Analyzed'}
                      {selectedScene.analysisStatus === 'processing' && '⏳ Processing'}
                      {selectedScene.analysisStatus === 'failed' && '✗ Failed'}
                      {selectedScene.analysisStatus === 'pending' && '○ Pending'}
                    </div>
                  </div>

                  <div className="flex gap-4 text-sm text-gray-600">
                    <span>{selectedScene.wordCount} words</span>
                    <span>•</span>
                    <span>Chapter {selectedScene.chapterNumber}</span>
                    {selectedScene.hasDialogue && (
                      <>
                        <span>•</span>
                        <span>💬 Has dialogue</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Analysis Results */}
                {selectedScene.analysisStatus === 'completed' && selectedScene.llmAnalysis && (
                  <div className="mb-6 space-y-6">
                    <h4 className="text-lg font-semibold text-gray-900">AI Analysis</h4>

                    {/* Characters */}
                    {selectedScene.llmAnalysis.characters.length > 0 && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Characters</h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {selectedScene.llmAnalysis.characters.map((char, idx) => (
                            <div key={idx} className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                              <div className="font-medium text-indigo-900">{char.name}</div>
                              <div className="text-sm text-indigo-700">{char.description}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Setting & Mood */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Setting</h5>
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                          <p className="text-sm text-purple-900">{selectedScene.llmAnalysis.setting}</p>
                        </div>
                      </div>

                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Mood</h5>
                        <div className="bg-pink-50 border border-pink-200 rounded-lg p-3">
                          <p className="text-sm text-pink-900">{selectedScene.llmAnalysis.mood}</p>
                        </div>
                      </div>
                    </div>

                    {/* Time & Weather */}
                    {(selectedScene.llmAnalysis.timeOfDay || selectedScene.llmAnalysis.weather) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {selectedScene.llmAnalysis.timeOfDay && (
                          <div>
                            <h5 className="text-sm font-medium text-gray-700 mb-2">Time of Day</h5>
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="text-sm text-amber-900">{selectedScene.llmAnalysis.timeOfDay}</p>
                            </div>
                          </div>
                        )}

                        {selectedScene.llmAnalysis.weather && (
                          <div>
                            <h5 className="text-sm font-medium text-gray-700 mb-2">Weather</h5>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <p className="text-sm text-blue-900">{selectedScene.llmAnalysis.weather}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Visual Elements */}
                    {selectedScene.llmAnalysis.visualElements.length > 0 && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Visual Elements</h5>
                        <div className="flex flex-wrap gap-2">
                          {selectedScene.llmAnalysis.visualElements.map((element, idx) => (
                            <span
                              key={idx}
                              className="bg-green-50 border border-green-200 text-green-800 text-xs font-medium px-3 py-1 rounded-full"
                            >
                              {element}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Actions */}
                    {selectedScene.llmAnalysis.keyActions.length > 0 && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Key Actions</h5>
                        <ul className="space-y-1">
                          {selectedScene.llmAnalysis.keyActions.map((action, idx) => (
                            <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                              <span className="text-gray-400 mt-1">•</span>
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Image Prompt */}
                    {selectedScene.imagePrompt && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Image Prompt</h5>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                          <p className="text-sm text-gray-700 font-mono">{selectedScene.imagePrompt}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Error State */}
                {selectedScene.analysisStatus === 'failed' && selectedScene.analysisError && (
                  <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
                    <h5 className="text-sm font-medium text-red-900 mb-1">Analysis Failed</h5>
                    <p className="text-sm text-red-700">{selectedScene.analysisError}</p>
                  </div>
                )}

                {/* Scene Text */}
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Scene Text</h4>
                  <div className="prose prose-sm max-w-none">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedScene.textContent}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
                <div className="text-6xl mb-4">👈</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Select a scene</h3>
                <p className="text-gray-600">
                  Click on any scene from the list to view its content and analysis
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
