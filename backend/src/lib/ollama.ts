import axios, { AxiosInstance } from 'axios';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_MODEL = 'deepseek-r1:latest';

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

interface SceneAnalysis {
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

/**
 * Ollama API Client
 */
class OllamaService {
  private client: AxiosInstance;
  private model: string;

  constructor(host: string = OLLAMA_HOST, model: string = DEFAULT_MODEL) {
    this.client = axios.create({
      baseURL: host,
      timeout: 120000, // 2 minutes for LLM responses
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.model = model;
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
        console.warn(`⚠️  Model ${this.model} not found. Available models:`, models.map((m: any) => m.name));
      }

      return true;
    } catch (error) {
      console.error('❌ Ollama health check failed:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Generate text completion
   */
  async generate(prompt: string, format?: 'json'): Promise<string> {
    try {
      const request: OllamaGenerateRequest = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
        },
      };

      if (format === 'json') {
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
   * Analyze a scene and extract structured information
   */
  async analyzeScene(sceneText: string, chapterTitle?: string): Promise<SceneAnalysis> {
    const prompt = this.buildAnalysisPrompt(sceneText, chapterTitle);

    try {
      const response = await this.generate(prompt, 'json');
      const analysis = JSON.parse(response);

      // Validate and clean up the response
      return {
        characters: Array.isArray(analysis.characters) ? analysis.characters : [],
        setting: analysis.setting || 'Not specified',
        timeOfDay: analysis.timeOfDay || null,
        weather: analysis.weather || null,
        mood: analysis.mood || 'neutral',
        visualElements: Array.isArray(analysis.visualElements) ? analysis.visualElements : [],
        keyActions: Array.isArray(analysis.keyActions) ? analysis.keyActions : [],
      };
    } catch (error) {
      console.error('❌ Scene analysis failed:', error);
      throw new Error(`Scene analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build the analysis prompt for scene extraction
   */
  private buildAnalysisPrompt(sceneText: string, chapterTitle?: string): string {
    const context = chapterTitle ? `This scene is from the chapter titled "${chapterTitle}".` : '';

    return `${context}

Analyze the following scene from a book and extract key information for visual representation. Return your analysis as a JSON object with the following structure:

{
  "characters": [{"name": "Character Name", "description": "Brief physical description and key traits"}],
  "setting": "Detailed description of the location/environment",
  "timeOfDay": "morning/afternoon/evening/night or null if not mentioned",
  "weather": "Description of weather conditions or null if not mentioned",
  "mood": "The overall emotional tone/atmosphere (e.g., tense, joyful, melancholic, mysterious)",
  "visualElements": ["List", "of", "important", "visual", "details", "for", "illustration"],
  "keyActions": ["List", "of", "significant", "actions", "or", "events"]
}

Scene text:
${sceneText}

Provide ONLY the JSON object, no additional text.`;
  }

  /**
   * Generate an image prompt from scene analysis
   */
  generateImagePrompt(analysis: SceneAnalysis, style: string = 'realistic digital art'): string {
    const parts: string[] = [style];

    // Add characters
    if (analysis.characters.length > 0) {
      const characterDescs = analysis.characters
        .map(c => `${c.name}: ${c.description}`)
        .join(', ');
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

// Export singleton instance
export const ollama = new OllamaService();

// Export types
export type { SceneAnalysis, OllamaGenerateResponse };
