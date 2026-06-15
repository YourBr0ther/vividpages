import { describe, expect, it } from 'vitest';
import { createEmbedder, createImageGen, createLLM, RegistryError } from '../src/registry';
import { AnthropicLLM } from '../src/llm/anthropic';
import { OpenAILLM } from '../src/llm/openai';
import { OllamaLLM } from '../src/llm/ollama';
import { OllamaEmbedder } from '../src/embed/ollama';
import { OpenAIEmbedder } from '../src/embed/openai';
import { ComfyUIImageGen } from '../src/image/comfyui';
import { OpenAIImageGen } from '../src/image/openai';

describe('createLLM', () => {
  it('ollama uses baseUrl, no key', () => {
    const llm = createLLM({ provider: 'ollama', baseUrl: 'http://host:11434', model: 'llama3.1' });
    expect(llm).toBeInstanceOf(OllamaLLM);
    expect(llm.provider).toBe('ollama');
    expect(llm.model).toBe('llama3.1');
  });

  it('ollama requires baseUrl', () => {
    expect(() => createLLM({ provider: 'ollama', model: 'llama3.1' })).toThrow(RegistryError);
  });

  it('anthropic requires apiKey and builds AnthropicLLM', () => {
    expect(() => createLLM({ provider: 'anthropic' })).toThrow(RegistryError);
    const llm = createLLM({ provider: 'anthropic', apiKey: 'sk-ant-x' });
    expect(llm).toBeInstanceOf(AnthropicLLM);
    expect(llm.model).toBe('claude-sonnet-4-6');
  });

  it('anthropic honors model override', () => {
    const llm = createLLM({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-4-8' });
    expect(llm.model).toBe('claude-opus-4-8');
  });

  it('openai requires apiKey and builds OpenAILLM', () => {
    expect(() => createLLM({ provider: 'openai' })).toThrow(RegistryError);
    const llm = createLLM({ provider: 'openai', apiKey: 'sk-x' });
    expect(llm).toBeInstanceOf(OpenAILLM);
  });

  it('unknown provider throws', () => {
    expect(() => createLLM({ provider: 'comfyui' as never, apiKey: 'k' })).toThrow(RegistryError);
    expect(() => createLLM({ provider: 'bogus' as never })).toThrow(RegistryError);
  });
});

describe('createEmbedder', () => {
  it('ollama uses baseUrl', () => {
    const e = createEmbedder({ provider: 'ollama', baseUrl: 'http://host:11434' });
    expect(e).toBeInstanceOf(OllamaEmbedder);
    expect(e.dimensions).toBe(768);
  });

  it('openai requires apiKey and exposes 1536 dims', () => {
    expect(() => createEmbedder({ provider: 'openai' })).toThrow(RegistryError);
    const e = createEmbedder({ provider: 'openai', apiKey: 'k' });
    expect(e).toBeInstanceOf(OpenAIEmbedder);
    expect(e.dimensions).toBe(1536);
  });

  it('anthropic has no embedder', () => {
    expect(() => createEmbedder({ provider: 'anthropic' as never, apiKey: 'k' })).toThrow(
      RegistryError,
    );
  });
});

describe('createImageGen', () => {
  it('comfyui uses baseUrl', () => {
    const g = createImageGen({ provider: 'comfyui', baseUrl: 'http://host:8188' });
    expect(g).toBeInstanceOf(ComfyUIImageGen);
  });

  it('openai requires apiKey', () => {
    expect(() => createImageGen({ provider: 'openai' })).toThrow(RegistryError);
    const g = createImageGen({ provider: 'openai', apiKey: 'k' });
    expect(g).toBeInstanceOf(OpenAIImageGen);
    expect(g.model).toBe('gpt-image-1');
  });

  it('ollama has no image gen', () => {
    expect(() => createImageGen({ provider: 'ollama' as never, baseUrl: 'x' })).toThrow(
      RegistryError,
    );
  });
});
