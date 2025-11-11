import axios, { AxiosInstance } from 'axios';
import { BaseLLMService, SceneAnalysis, LLMConfig, LLMProvider } from './BaseLLMService.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022'; // Latest Claude model

// ============================================
// Claude-Specific Types
// ============================================

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  messages: ClaudeMessage[];
  system?: string;
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================
// Claude Service Implementation
// ============================================

export class ClaudeService extends BaseLLMService {
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
      baseURL: CLAUDE_API_URL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    console.log(`🤖 Claude service initialized with model ${this.model}`);
  }

  /**
   * Get provider name
   */
  getProvider(): LLMProvider {
    return LLMProvider.CLAUDE;
  }

  /**
   * Check if Claude API is accessible
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Try a minimal request to verify API key
      const response = await this.client.post<ClaudeResponse>('/messages', {
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });

      return response.status === 200;
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.error('❌ Claude API key is invalid');
        return false;
      }
      console.error('❌ Claude health check failed:', error.message);
      return false;
    }
  }

  /**
   * Generate text completion using Claude API
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
      const systemPrompt =
        options?.format === 'json'
          ? 'You are a helpful assistant that always responds with valid JSON. Never include any text outside the JSON object.'
          : undefined;

      const request: ClaudeRequest = {
        model: this.model,
        max_tokens: options?.maxTokens ?? this.maxTokens,
        temperature: options?.temperature ?? this.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      };

      if (systemPrompt) {
        request.system = systemPrompt;
      }

      const response = await this.client.post<ClaudeResponse>('/messages', request);

      // Extract text from Claude's response format
      const text = response.data.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      return text;
    } catch (error: any) {
      console.error('❌ Claude generation failed:', error);

      if (error.response?.status === 401) {
        throw new Error('Claude API key is invalid');
      }
      if (error.response?.status === 429) {
        throw new Error('Claude API rate limit exceeded');
      }
      if (error.response?.data?.error?.message) {
        throw new Error(`Claude API error: ${error.response.data.error.message}`);
      }

      throw new Error(`Claude generation failed: ${error.message}`);
    }
  }

  /**
   * Override buildAnalysisPrompt to use Claude-optimized prompting
   */
  protected buildAnalysisPrompt(sceneText: string, chapterTitle?: string): string {
    const chapterContext = chapterTitle ? `This scene is from the chapter: "${chapterTitle}"\n\n` : '';

    return `${chapterContext}Please analyze this scene from a book and extract structured information for visual representation.

Scene Text:
"""
${sceneText}
"""

Extract the following information and respond with a JSON object:

{
  "characters": [
    {
      "name": "Character's full name",
      "description": "Physical appearance, clothing, and key traits visible in this scene"
    }
  ],
  "setting": "Detailed description of the location and environment",
  "timeOfDay": "morning/afternoon/evening/night (or null if not specified)",
  "weather": "Weather conditions (or null if not mentioned)",
  "mood": "Overall atmosphere (e.g., tense, joyful, mysterious, somber)",
  "visualElements": [
    "Important visual detail 1",
    "Important visual detail 2"
  ],
  "keyActions": [
    "Main action or event 1",
    "Main action or event 2"
  ]
}

Important guidelines:
- Only include characters who are physically present in THIS specific scene
- Focus on visual details that would be important for creating an illustration
- Keep descriptions concise but specific
- Use null for timeOfDay and weather if not mentioned
- Return ONLY the JSON object`;
  }
}

// Export types
export type { ClaudeResponse, ClaudeMessage };
