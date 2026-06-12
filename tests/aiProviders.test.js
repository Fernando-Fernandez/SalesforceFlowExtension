// Tests for the AI provider registry and streaming client (scripts/aiProviders.js).
// These load the real production file.

const AIProviders = require('../scripts/aiProviders.js');

// builds a fake streaming fetch Response from a list of text chunks
function fakeStreamResponse(chunks) {
  const encoder = new TextEncoder();
  const pending = chunks.map(c => encoder.encode(c));
  return {
    ok: true,
    body: {
      getReader() {
        return {
          read: async () => {
            if (pending.length === 0) {
              return { done: true, value: undefined };
            }
            return { done: false, value: pending.shift() };
          }
        };
      }
    }
  };
}

describe('AIProviders', () => {

  describe('buildRequest', () => {
    const args = {
      model: '', apiKey: 'test-key',
      systemPrompt: 'You are an expert.', userText: 'Explain this flow',
      temperature: 0.3
    };

    test('OpenAI chat-completions models use the chat endpoint with bearer auth', () => {
      const request = AIProviders.PROVIDERS.openai.buildRequest({ ...args, model: 'gpt-4o' });

      expect(request.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(request.headers.Authorization).toBe('Bearer test-key');
      expect(request.body.stream).toBe(true);
      expect(request.body.messages).toHaveLength(2);
      expect(request.body.temperature).toBe(0.3);
    });

    test('OpenAI gpt-5 models use the responses endpoint with temperature 1', () => {
      const request = AIProviders.PROVIDERS.openai.buildRequest({ ...args, model: 'gpt-5-mini' });

      expect(request.url).toBe('https://api.openai.com/v1/responses');
      expect(request.body.temperature).toBe(1);
      expect(request.body.input).toContain('You are an expert.');
      expect(request.body.stream).toBe(true);
    });

    test('Anthropic uses the messages endpoint with browser-access headers', () => {
      const request = AIProviders.PROVIDERS.anthropic.buildRequest({ ...args, model: 'claude-sonnet-4-6' });

      expect(request.url).toBe('https://api.anthropic.com/v1/messages');
      expect(request.headers['x-api-key']).toBe('test-key');
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(request.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
      expect(request.body.system).toBe('You are an expert.');
      expect(request.body.stream).toBe(true);
    });

    test('Gemini uses the streaming SSE endpoint with the key in a header', () => {
      const request = AIProviders.PROVIDERS.gemini.buildRequest({ ...args, model: 'gemini-2.5-flash' });

      expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
      expect(request.headers['x-goog-api-key']).toBe('test-key');
      expect(request.body.systemInstruction.parts[0].text).toBe('You are an expert.');
    });

    test('Ollama targets localhost and needs no key', () => {
      const request = AIProviders.PROVIDERS.ollama.buildRequest({ ...args, model: 'llama3.2' });

      expect(request.url).toBe('http://localhost:11434/api/chat');
      expect(AIProviders.PROVIDERS.ollama.requiresKey).toBe(false);
      expect(request.headers.Authorization).toBeUndefined();
      expect(request.body.stream).toBe(true);
    });
  });

  describe('extractDelta', () => {
    test('OpenAI handles both chat-completions and responses chunks', () => {
      const { openai } = AIProviders.PROVIDERS;
      expect(openai.extractDelta({ choices: [{ delta: { content: 'abc' } }] })).toBe('abc');
      expect(openai.extractDelta({ type: 'response.output_text.delta', delta: 'xyz' })).toBe('xyz');
      expect(openai.extractDelta({ choices: [{ delta: {} }] })).toBeNull();
    });

    test('Anthropic extracts content_block_delta text', () => {
      const { anthropic } = AIProviders.PROVIDERS;
      expect(anthropic.extractDelta({ type: 'content_block_delta', delta: { text: 'hi' } })).toBe('hi');
      expect(anthropic.extractDelta({ type: 'message_start' })).toBeNull();
    });

    test('Gemini extracts candidate part text', () => {
      const { gemini } = AIProviders.PROVIDERS;
      expect(gemini.extractDelta({ candidates: [{ content: { parts: [{ text: 'g' }] } }] })).toBe('g');
      expect(gemini.extractDelta({})).toBeNull();
    });

    test('Ollama extracts message content', () => {
      const { ollama } = AIProviders.PROVIDERS;
      expect(ollama.extractDelta({ message: { content: 'o' }, done: false })).toBe('o');
      expect(ollama.extractDelta({ done: true })).toBeNull();
    });
  });

  describe('streamChat', () => {
    afterEach(() => {
      delete global.fetch;
    });

    test('accumulates SSE deltas and reports them via onDelta', async () => {
      global.fetch = jest.fn(async () => fakeStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\ndata: [DONE]\n'
      ]));
      const deltas = [];

      const fullText = await AIProviders.streamChat({
        provider: 'openai', model: 'gpt-4o', apiKey: 'k',
        systemPrompt: 's', userText: 'u', temperature: 0.3,
        onDelta: (delta, soFar) => deltas.push([delta, soFar])
      });

      expect(fullText).toBe('Hello world');
      expect(deltas).toEqual([['Hello', 'Hello'], [' world', 'Hello world']]);
    });

    test('parses SSE chunks split across network reads', async () => {
      global.fetch = jest.fn(async () => fakeStreamResponse([
        'data: {"choices":[{"delta":{"con',
        'tent":"AB"}}]}\n'
      ]));

      const fullText = await AIProviders.streamChat({
        provider: 'openai', model: 'gpt-4o', apiKey: 'k',
        systemPrompt: 's', userText: 'u', temperature: 0.3
      });

      expect(fullText).toBe('AB');
    });

    test('parses Anthropic event/data SSE pairs', async () => {
      global.fetch = jest.fn(async () => fakeStreamResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"An"}}\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"thropic"}}\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n'
      ]));

      const fullText = await AIProviders.streamChat({
        provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k',
        systemPrompt: 's', userText: 'u', temperature: 0.3
      });

      expect(fullText).toBe('Anthropic');
    });

    test('parses Ollama NDJSON lines without data prefixes', async () => {
      global.fetch = jest.fn(async () => fakeStreamResponse([
        '{"message":{"content":"Ol"},"done":false}\n{"message":{"content":"lama"},"done":false}\n',
        '{"done":true}\n'
      ]));

      const fullText = await AIProviders.streamChat({
        provider: 'ollama', model: 'llama3.2',
        systemPrompt: 's', userText: 'u', temperature: 0.3
      });

      expect(fullText).toBe('Ollama');
    });

    test('throws a labeled error on a non-ok response', async () => {
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'invalid api key' } })
      }));

      await expect(AIProviders.streamChat({
        provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'bad',
        systemPrompt: 's', userText: 'u', temperature: 0.3
      })).rejects.toThrow('Anthropic request failed (401): invalid api key');
    });

    test('stringifies structured error payloads instead of [object Object]', async () => {
      // Ollama rejects untrusted origins with 403 and a structured body
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: { message: 'origin not allowed', code: 403 } })
      }));

      await expect(AIProviders.streamChat({
        provider: 'ollama', model: 'llama3.2',
        systemPrompt: 's', userText: 'u', temperature: 0.3
      })).rejects.toThrow('Ollama (local) request failed (403): origin not allowed');
    });

    test('throws on mid-stream error events', async () => {
      global.fetch = jest.fn(async () => fakeStreamResponse([
        'data: {"type":"error","error":{"message":"overloaded"}}\n'
      ]));

      await expect(AIProviders.streamChat({
        provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k',
        systemPrompt: 's', userText: 'u', temperature: 0.3
      })).rejects.toThrow('overloaded');
    });

    test('rejects unknown providers', async () => {
      await expect(AIProviders.streamChat({ provider: 'nope' }))
        .rejects.toThrow('Unknown AI provider: nope');
    });
  });
});
