export type { CompleteOptions, LLM, LLMCompletion } from './llm/types';
export { OllamaError, OllamaLLM, type OllamaLLMOptions } from './llm/ollama';
export type { Embedder } from './embed/types';
export { OllamaEmbedder, type OllamaEmbedderOptions } from './embed/ollama';
export {
  completeStructured,
  StructuredOutputError,
  type StructuredOptions,
  type StructuredResult,
} from './structured';
