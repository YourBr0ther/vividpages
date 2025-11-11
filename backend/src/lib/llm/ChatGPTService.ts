import axios, { AxiosInstance } from 'axios';
import { BaseLLMService, SceneAnalysis, LLMConfig, LLMProvider } from './BaseLLMService.js';

const OPENAI_API_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4-turbo-preview'; // Latest GPT-4 Turbo model

// ============================================
// OpenAI-Specific Types
// ============================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: {
    type: 'json_object';
  };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================
// ChatGPT Service Implementation
// ============================================

export class ChatGPTService extends BaseLLMService {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string, config?: Partial<LLMConfig>) {
    super({
      model: config?.model || DEFAULT_MODEL,
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 4000,
      timeout: config?.timeout ?? 120000,
    });

    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: OPENAI_API_URL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    console.log(`🤖 ChatGPT service initialized with model ${this.model}`);
  }

  /**
   * Get provider name
   */
  getProvider(): LLMProvider {
    return LLMProvider.CHATGPT;
  }

  /**
   * Check if OpenAI API is accessible
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Try to list models to verify API key
      const response = await this.client.get('/models');
      return response.status === 200;
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.error('❌ OpenAI API key is invalid');
        return false;
      }
      console.error('❌ OpenAI health check failed:', error.message);
      return false;
    }
  }

  /**
   * Generate text completion using OpenAI API
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
      const messages: OpenAIMessage[] = [];

      // Add system message for JSON mode
      if (options?.format === 'json') {
        messages.push({
          role: 'system',
          content:
            'You are a helpful assistant that always responds with valid JSON. Never include any text outside the JSON object.',
        });
      }

      // Add user prompt
      messages.push({
        role: 'user',
        content: prompt,
      });

      const request: OpenAIRequest = {
        model: this.model,
        messages,
        temperature: options?.temperature ?? this.temperature,
        max_tokens: options?.maxTokens ?? this.maxTokens,
      };

      // Enable JSON mode if requested
      if (options?.format === 'json') {
        request.response_format = { type: 'json_object' };
      }

      const response = await this.client.post<OpenAIResponse>('/chat/completions', request);

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      return content;
    } catch (error: any) {
      console.error('❌ OpenAI generation failed:', error);

      if (error.response?.status === 401) {
        throw new Error('OpenAI API key is invalid');
      }
      if (error.response?.status === 429) {
        throw new Error('OpenAI API rate limit exceeded');
      }
      if (error.response?.data?.error?.message) {
        throw new Error(`OpenAI API error: ${error.response.data.error.message}`);
      }

      throw new Error(`OpenAI generation failed: ${error.message}`);
    }
  }

  /**
   * Override buildAnalysisPrompt to use ChatGPT-optimized prompting
   */
  protected buildAnalysisPrompt(sceneText: string, chapterTitle?: string): string {
    const chapterContext = chapterTitle ? `Chapter: "${chapterTitle}"\n\n` : '';

    return `${chapterContext}Analyze this book scene and extract structured information for visual representation.

Scene Text:
"""
${sceneText}
"""

Return a JSON object with this exact structure:

{
  "characters": [
    {
      "name": "Character name",
      "description": "Physical appearance and visible traits in this scene"
    }
  ],
  "setting": "Detailed description of the location/environment",
  "timeOfDay": "morning/afternoon/evening/night or null",
  "weather": "Weather conditions or null",
  "mood": "Overall atmosphere (e.g., tense, peaceful, mysterious)",
  "visualElements": [
    "Important visual detail 1",
    "Important visual detail 2"
  ],
  "keyActions": [
    "Main action 1",
    "Main action 2"
  ]
}

Guidelines:
- Only include characters physically present in this scene
- Focus on visual details for illustration
- Use null for timeOfDay/weather if not mentioned
- Keep descriptions concise
- Return only valid JSON`;
  }
}

// Export types
export type { OpenAIResponse, OpenAIMessage };
