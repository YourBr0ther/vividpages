import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/redact';

describe('redactSecrets', () => {
  it('redacts an Anthropic-style key', () => {
    expect(redactSecrets('auth failed: sk-ant-api03-abc123XYZ_def')).toBe(
      'auth failed: sk-***',
    );
  });

  it('redacts an OpenAI project key', () => {
    expect(redactSecrets('bad key sk-proj-AbC123_def-456')).toBe('bad key sk-***');
  });

  it('leaves a message with no key unchanged', () => {
    const msg = 'OpenAI images.generate failed: 429 rate limited';
    expect(redactSecrets(msg)).toBe(msg);
  });

  it('replaces multiple occurrences', () => {
    expect(redactSecrets('first sk-abc123 then sk-proj-def456 done')).toBe(
      'first sk-*** then sk-*** done',
    );
  });

  it('does not redact short sk- fragments below the length threshold', () => {
    // Fewer than 6 trailing chars: not a key shape, left as-is.
    expect(redactSecrets('value sk-12345')).toBe('value sk-12345');
  });
});
