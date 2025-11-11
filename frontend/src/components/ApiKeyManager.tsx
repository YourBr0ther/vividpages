import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  getApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  testApiKey,
  type ApiKey,
  type CreateApiKeyData,
} from '../lib/api';

interface ApiKeyManagerProps {
  className?: string;
}

type Provider = 'claude' | 'chatgpt' | 'ollama' | 'dall-e' | 'stable-diffusion' | 'other';

const PROVIDERS: { value: Provider; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude (Anthropic)', description: 'For LLM text analysis' },
  { value: 'chatgpt', label: 'ChatGPT (OpenAI)', description: 'For LLM text analysis' },
  { value: 'ollama', label: 'Ollama (Local)', description: 'Self-hosted LLM' },
  { value: 'dall-e', label: 'DALL-E (OpenAI)', description: 'For image generation' },
  { value: 'stable-diffusion', label: 'Stable Diffusion', description: 'For image generation' },
  { value: 'other', label: 'Other', description: 'Custom provider' },
];

export default function ApiKeyManager({ className = '' }: ApiKeyManagerProps) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [formData, setFormData] = useState<CreateApiKeyData>({
    provider: 'claude',
    apiKey: '',
    nickname: '',
  });
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Fetch API keys
  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: getApiKeys,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      toast.success('API key added successfully');
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to add API key');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateApiKey(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      toast.success('API key updated successfully');
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update API key');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      toast.success('API key deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to delete API key');
    },
  });

  // Test mutation
  const testMutation = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      testApiKey(provider, apiKey),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      setTestingKeyId(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to test API key');
      setTestingKeyId(null);
    },
  });

  const resetForm = () => {
    setFormData({
      provider: 'claude',
      apiKey: '',
      nickname: '',
    });
    setEditingKey(null);
    setShowAddForm(false);
    setShowPassword(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.apiKey.trim()) {
      toast.error('API key is required');
      return;
    }

    if (editingKey) {
      updateMutation.mutate({
        id: editingKey.id,
        data: {
          apiKey: formData.apiKey.trim(),
          nickname: formData.nickname?.trim() || undefined,
          provider: formData.provider,
        },
      });
    } else {
      createMutation.mutate({
        provider: formData.provider,
        apiKey: formData.apiKey.trim(),
        nickname: formData.nickname?.trim() || undefined,
      });
    }
  };

  const handleEdit = (apiKey: ApiKey) => {
    setEditingKey(apiKey);
    setFormData({
      provider: apiKey.provider as Provider,
      apiKey: '', // Don't populate for security
      nickname: apiKey.nickname || '',
    });
    setShowAddForm(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this API key?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleTest = (apiKey: ApiKey) => {
    setTestingKeyId(apiKey.id);
    // For testing, we can't access the real key, so this only works during creation
    toast.error('Testing existing keys is not supported. Please test before saving.');
    setTestingKeyId(null);
  };

  const handleTestBeforeSave = () => {
    if (!formData.apiKey.trim()) {
      toast.error('Please enter an API key to test');
      return;
    }

    testMutation.mutate({
      provider: formData.provider,
      apiKey: formData.apiKey.trim(),
    });
  };

  if (isLoading) {
    return (
      <div className={`${className} flex items-center justify-center py-8`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900">API Keys</h3>
          <p className="text-sm text-gray-500 mt-1">
            Manage your API keys for LLM and image generation providers
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + Add API Key
          </button>
        )}
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">
          <h4 className="text-md font-medium text-gray-900 mb-4">
            {editingKey ? 'Edit API Key' : 'Add New API Key'}
          </h4>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Provider
              </label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value as Provider })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label} - {provider.description}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent pr-10"
                  placeholder="Enter your API key"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {editingKey && (
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to keep existing key
                </p>
              )}
            </div>

            {/* Nickname */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nickname (Optional)
              </label>
              <input
                type="text"
                value={formData.nickname}
                onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="e.g., My Personal Key"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingKey
                  ? 'Update Key'
                  : 'Save Key'}
              </button>

              <button
                type="button"
                onClick={handleTestBeforeSave}
                disabled={testMutation.isPending || !formData.apiKey.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testMutation.isPending ? 'Testing...' : 'Test Key'}
              </button>

              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* API Keys List */}
      {apiKeys.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No API keys</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by adding your first API key.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {apiKeys.map((apiKey) => (
            <div
              key={apiKey.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                      {PROVIDERS.find((p) => p.value === apiKey.provider)?.label || apiKey.provider}
                    </span>
                    {apiKey.nickname && (
                      <span className="text-sm font-medium text-gray-900">{apiKey.nickname}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500 font-mono">{apiKey.maskedKey}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Added {new Date(apiKey.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(apiKey)}
                    className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>

                  <button
                    onClick={() => handleDelete(apiKey.id)}
                    disabled={deleteMutation.isPending}
                    className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex gap-3">
          <svg
            className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Security Information</p>
            <ul className="list-disc list-inside space-y-1 text-blue-700">
              <li>All API keys are encrypted using AES-256-GCM before storage</li>
              <li>Keys are never exposed in API responses (only masked versions)</li>
              <li>We recommend using API keys with limited scopes when possible</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
