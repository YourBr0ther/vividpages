/**
 * LLM Services - Unified interface for multiple LLM providers
 *
 * This module provides a consistent API for interacting with different
 * LLM providers (Claude, ChatGPT, Ollama) through a factory pattern.
 */

export { BaseLLMService, LLMProvider, type SceneAnalysis, type LLMConfig } from './BaseLLMService.js';
export { OllamaService } from './OllamaService.js';
export { ClaudeService } from './ClaudeService.js';
export { ChatGPTService } from './ChatGPTService.js';
export { LLMFactory, llmFactory } from './LLMFactory.js';
