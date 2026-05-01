import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { api } from '../services/api.js';

export const useModelsStore = create(
  subscribeWithSelector((set, get) => ({
    // Models state
    models: [],
    ollamaModels: [], // Local Ollama models
    ollamaAvailable: false,
    loading: false,
    error: null,
    lastFetched: null,

    // Personal API key statuses (for direct access models)
    apiKeyStatuses: {},

    // Actions
    fetchModels: async () => {
      set({ loading: true, error: null });

      try {
        // Fetch platform models and Ollama models in parallel
        const [platformResponse, ollamaResponse] = await Promise.allSettled([
          api.getAvailableModels(),
          api.getOllamaStatus().catch(() => ({ success: false, available: false, models: [] }))
        ]);

        const models = platformResponse.status === 'fulfilled' && platformResponse.value.success !== false
          ? (platformResponse.value.models || [])
          : [];

        const ollamaResult = ollamaResponse.status === 'fulfilled' ? ollamaResponse.value : { available: false, models: [] };

        set({
          models,
          ollamaModels: ollamaResult.models || [],
          ollamaAvailable: ollamaResult.available || false,
          loading: false,
          lastFetched: new Date().toISOString()
        });

        if (platformResponse.status === 'rejected') {
          throw platformResponse.reason || new Error('Failed to fetch models');
        }

        return models;
      } catch (error) {
        console.error('Failed to fetch models:', error);
        set({
          error: error.message,
          loading: false,
          models: []
        });
        throw error;
      }
    },

    // Refresh Ollama models specifically
    fetchOllamaModels: async () => {
      try {
        const response = await api.getOllamaStatus();
        set({
          ollamaModels: response.models || [],
          ollamaAvailable: response.available || false
        });
        return response.models || [];
      } catch (error) {
        console.warn('Failed to fetch Ollama models:', error.message);
        return [];
      }
    },
    
    // Get models organized by category
    getModelsByCategory: () => {
      const { models } = get();

      const hasVendorKey = (provider) => {
        const settings = JSON.parse(localStorage.getItem('loxia-settings') || '{}');
        return !!(settings.apiKeys && typeof settings.apiKeys[provider] === 'string' && settings.apiKeys[provider].trim().length > 0);
      };

      // Cloud-provider models (OpenAI / Anthropic / Gemini / xAI / custom).
      // Only chat models — image / video / vision tools were removed.
      const chatModels = models.filter(m => !m.type || m.type === 'chat' || m.type === 'completion');
      const cloudModels = chatModels
        .filter(m => m.provider !== 'ollama')
        .map(m => ({
          id:           m.name,
          modelName:    m.name,
          local:        false,
          displayName:  m.displayName || m.name,
          description:  get().getModelDescription(m),
          provider:     m.provider,
          available:    hasVendorKey(m.provider),
          requiresKey:  m.provider,
          pricing:      m.pricing,
          features: {
            supportsVision: m.supportsVision || false,
            supportsTools:  m.supportsTools !== false,
            maxTokens:      m.maxTokens || 4096,
            contextWindow:  m.contextWindow || 128000,
          },
        }));

      // Local Ollama models (free, offline)
      const { ollamaModels, ollamaAvailable } = get();
      const localModels = (ollamaModels || []).map(m => ({
        id:          m.name, // already prefixed: ollama-xxx
        modelName:   m.name,
        local:       true,
        displayName: m.displayName || m.ollamaName || m.name,
        description: `Local model${m.details?.parameterSize ? ` • ${m.details.parameterSize}` : ''}${m.contextWindow ? ` • ${Math.round(m.contextWindow / 1000)}K context` : ''}`,
        provider:    'ollama',
        available:   ollamaAvailable,
        pricing:     { input: 0, output: 0 },
        features: {
          supportsVision: false,
          supportsTools:  true,
          maxTokens:      m.maxTokens || 4096,
          contextWindow:  m.contextWindow || 4096,
        },
      }));

      return {
        cloud: {
          title:       'Cloud Providers',
          description: 'OpenAI, Anthropic, Gemini, xAI, and custom OpenAI-compatible endpoints (configure keys in Settings).',
          badge:       'BYOK',
          models:      cloudModels,
        },
        local: {
          title:       'Local Models (Ollama)',
          description: 'Free offline models running on your machine via Ollama.',
          badge:       'Free',
          models:      localModels,
        },
      };
    },
    
    // Helper functions
    getModelDescription: (model) => {
      // Use contextWindow for more informative descriptions
      const contextStr = model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K context` : '';
      const visionStr = model.supportsVision ? ', vision' : '';
      return `${model.displayName}${contextStr ? ` • ${contextStr}` : ''}${visionStr}`;
    },
    
    getProviderKey: (category) => {
      const providerMap = {
        anthropic: 'anthropic',
        openai:    'openai',
        gemini:    'gemini',
        xai:       'xai',
      };
      return providerMap[category?.toLowerCase()];
    },


    // Refresh models if they're stale
    refreshIfStale: async () => {
      const { lastFetched, fetchModels } = get();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      if (!lastFetched || new Date(lastFetched) < fiveMinutesAgo) {
        try {
          await fetchModels();
        } catch (error) {
          // Silently fail - we'll use cached/default models
          console.warn('Failed to refresh models:', error.message);
        }
      }
    },
    
    // Update API key status
    updateApiKeyStatus: (provider, status) => {
      set(state => ({
        apiKeyStatuses: {
          ...state.apiKeyStatuses,
          [provider]: status
        }
      }));
    },
    
    // Check if model is available (cloud requires a vendor key; local
    // requires a reachable Ollama daemon).
    isModelAvailable: (modelId) => {
      const categories = get().getModelsByCategory();
      const cloudModel = categories.cloud?.models.find(m => m.id === modelId);
      if (cloudModel) return cloudModel.available;
      const localModel = categories.local?.models.find(m => m.id === modelId);
      if (localModel) return localModel.available;
      return false;
    },
    
    clearError: () => {
      set({ error: null });
    }
  }))
);

// Initialize models on app start
useModelsStore.getState().fetchModels().catch(console.error);