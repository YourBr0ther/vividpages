/**
 * Base LLM Service - Abstract class for all LLM providers
 *
 * This defines a unified interface for interacting with different LLM providers
 * (Claude, ChatGPT, Ollama, etc.) to ensure consistent behavior across the application.
 */

// ============================================
// Types & Interfaces
// ============================================

export interface SceneAnalysis {
  characters: Array<{
    name: string;
    description: string;
  }>;
  setting: string;
  timeOfDay: string | null;
  weather: string | null;
  mood: string;
  visualElements: string[];
  keyActions: string[];
}

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface LLMResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export enum LLMProvider {
  OLLAMA = 'ollama',
  CLAUDE = 'claude',
  CHATGPT = 'chatgpt',
}

// ============================================
// Base LLM Service Abstract Class
// ============================================

export abstract class BaseLLMService {
  protected model: string;
  protected temperature: number;
  protected maxTokens: number;
  protected timeout: number;

  constructor(config: LLMConfig) {
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 2000;
    this.timeout = config.timeout ?? 120000; // 2 minutes default
  }

  /**
   * Get the provider name (ollama, claude, chatgpt)
   */
  abstract getProvider(): LLMProvider;

  /**
   * Check if the service is available and configured correctly
   */
  abstract checkHealth(): Promise<boolean>;

  /**
   * Generate a text response from a prompt
   * This is the core method that each provider must implement
   */
  abstract generate(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    format?: 'json' | 'text';
  }): Promise<string>;

  /**
   * Analyze a scene and extract structured information
   * This method can be overridden by providers for custom behavior,
   * but has a default implementation using generate()
   */
  async analyzeScene(sceneText: string, chapterTitle?: string): Promise<SceneAnalysis> {
    const prompt = this.buildAnalysisPrompt(sceneText, chapterTitle);

    try {
      const response = await this.generate(prompt, { format: 'json' });
      const analysis = JSON.parse(response);

      // Validate and normalize the response
      return this.normalizeSceneAnalysis(analysis);
    } catch (error) {
      console.error(`❌ Error analyzing scene with ${this.getProvider()}:`, error);
      throw new Error(`Failed to analyze scene: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build the analysis prompt for scene analysis
   * Can be overridden by providers for custom prompts
   */
  protected buildAnalysisPrompt(sceneText: string, chapterTitle?: string): string {
    const chapterContext = chapterTitle ? `Chapter: ${chapterTitle}\n\n` : '';

    return `${chapterContext}Analyze this scene from a book and extract the following information in JSON format:

Scene Text:
"""
${sceneText}
"""

Provide your analysis as a JSON object with this exact structure:
{
  "characters": [
    {
      "name": "Character Name",
      "description": "Brief physical description and role in this scene"
    }
  ],
  "setting": "Description of the location/setting",
  "timeOfDay": "morning/afternoon/evening/night or null if not specified",
  "weather": "Description of weather conditions or null if not mentioned",
  "mood": "Overall mood/atmosphere of the scene (e.g., tense, peaceful, melancholic)",
  "visualElements": ["Notable visual details that would be important for an image"],
  "keyActions": ["Main actions or events happening in this scene"]
}

IMPORTANT:
- Only include characters that are actually present and active in THIS scene
- Keep descriptions concise but specific
- Focus on visual details that would matter for image generation
- Return ONLY the JSON object, no additional text`;
  }

  /**
   * Normalize and validate the scene analysis response
   */
  protected normalizeSceneAnalysis(analysis: any): SceneAnalysis {
    return {
      characters: Array.isArray(analysis.characters) ? analysis.characters : [],
      setting: analysis.setting || 'Not specified',
      timeOfDay: analysis.timeOfDay || null,
      weather: analysis.weather || null,
      mood: analysis.mood || 'neutral',
      visualElements: Array.isArray(analysis.visualElements) ? analysis.visualElements : [],
      keyActions: Array.isArray(analysis.keyActions) ? analysis.keyActions : [],
    };
  }

  /**
   * Get current model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get current configuration
   */
  getConfig(): LLMConfig {
    return {
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      timeout: this.timeout,
    };
  }
}
