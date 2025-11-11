import axios, { AxiosInstance } from 'axios';
import { BaseLLMService, SceneAnalysis, LLMConfig, LLMProvider } from './BaseLLMService.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_MODEL = 'deepseek-r1:latest';

// ============================================
// Ollama-Specific Types
// ============================================

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
  format?: 'json';
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// ============================================
// Ollama Service Implementation
// ============================================

export class OllamaService extends BaseLLMService {
  private client: AxiosInstance;
  private host: string;

  constructor(config?: Partial<LLMConfig & { host?: string }>) {
    super({
      model: config?.model || DEFAULT_MODEL,
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 2000,
      timeout: config?.timeout ?? 120000,
    });

    this.host = config?.host || OLLAMA_HOST;
    this.client = axios.create({
      baseURL: this.host,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`🤖 Ollama service initialized: ${this.host} with model ${this.model}`);
  }

  /**
   * Get provider name
   */
  getProvider(): LLMProvider {
    return LLMProvider.OLLAMA;
  }

  /**
   * Check if Ollama is accessible and the model is available
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/tags');
      const models = response.data.models || [];
      const modelExists = models.some((m: any) => m.name === this.model);

      if (!modelExists) {
        console.warn(
          `⚠️  Model ${this.model} not found on ${this.host}. Available models:`,
          models.map((m: any) => m.name)
        );
      }

      return true;
    } catch (error) {
      console.error('❌ Ollama health check failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Generate text completion using Ollama API
   */
  async generate(
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      format?: 'json' | 'text';
    }
  ): Promise<string> {
    try {
      const request: OllamaGenerateRequest = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? this.temperature,
          top_p: 0.9,
        },
      };

      if (options?.format === 'json') {
        request.format = 'json';
      }

      const response = await this.client.post<OllamaGenerateResponse>('/api/generate', request);
      return response.data.response;
    } catch (error) {
      console.error('❌ Ollama generation failed:', error);
      throw new Error(`Ollama generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate an image prompt from scene analysis
   * This is Ollama-specific utility method
   */
  generateImagePrompt(analysis: SceneAnalysis, style: string = 'realistic digital art'): string {
    const parts: string[] = [style];

    // Add characters
    if (analysis.characters.length > 0) {
      const characterDescs = analysis.characters.map((c) => `${c.name}: ${c.description}`).join(', ');
      parts.push(characterDescs);
    }

    // Add setting
    if (analysis.setting && analysis.setting !== 'Not specified') {
      parts.push(analysis.setting);
    }

    // Add time and weather
    if (analysis.timeOfDay) {
      parts.push(analysis.timeOfDay);
    }
    if (analysis.weather) {
      parts.push(analysis.weather);
    }

    // Add mood
    if (analysis.mood) {
      parts.push(`${analysis.mood} atmosphere`);
    }

    // Add visual elements
    if (analysis.visualElements.length > 0) {
      parts.push(...analysis.visualElements.slice(0, 3)); // Top 3 visual elements
    }

    return parts.join(', ');
  }
}

// Export types
export type { OllamaGenerateResponse };
