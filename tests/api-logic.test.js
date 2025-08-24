// Tests for API logic and model detection

describe('Model Detection and API Logic', () => {
  // Helper function to simulate the model detection logic
  function isGPT5Model(model) {
    return !!(model && typeof model === 'string' && model.trim().length > 0 && model.toLowerCase().startsWith('gpt-5'));
  }

  // Helper function to get the correct token parameter
  function getTokenLimitParam(model) {
    return isGPT5Model(model) ? 'max_output_tokens' : 'max_tokens';
  }

  // Helper function to get correct temperature
  function getModelTemperature(model, defaultTemp = 0.3) {
    return isGPT5Model(model) ? 1 : defaultTemp;
  }

  // Helper function to get API endpoint
  function getApiEndpoint(model) {
    return isGPT5Model(model) 
      ? 'https://api.openai.com/v1/responses'
      : 'https://api.openai.com/v1/chat/completions';
  }

  // Helper function to build payload
  function buildPayload(model, prompt, data, systemPrompt = 'Test system prompt') {
    const isGPT5 = isGPT5Model(model);
    const tokenLimitParam = getTokenLimitParam(model);
    const temperature = getModelTemperature(model);
    const maxTokens = 2000;

    if (isGPT5) {
      // GPT-5 payload structure
      return {
        model: model,
        input: `${systemPrompt}\n\n${prompt} ${data}`,
        temperature: temperature,
        [tokenLimitParam]: maxTokens
      };
    } else {
      // Standard payload structure
      return {
        model: model,
        messages: [
          { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'text', text: `${prompt} ${data}` }] }
        ],
        temperature: temperature,
        [tokenLimitParam]: maxTokens,
        top_p: 0.2,
        frequency_penalty: 0,
        presence_penalty: 0
      };
    }
  }

  describe('Model Detection', () => {
    test('should detect GPT-5 models correctly', () => {
      expect(isGPT5Model('gpt-5-nano')).toBe(true);
      expect(isGPT5Model('gpt-5-mini')).toBe(true);
      expect(isGPT5Model('GPT-5-Large')).toBe(true);
      expect(isGPT5Model('gpt-5')).toBe(true);
    });

    test('should not detect non-GPT-5 models as GPT-5', () => {
      expect(isGPT5Model('gpt-4o')).toBe(false);
      expect(isGPT5Model('gpt-4-turbo')).toBe(false);
      expect(isGPT5Model('gpt-3.5-turbo')).toBe(false);
      expect(isGPT5Model('claude-3-sonnet')).toBe(false);
      expect(isGPT5Model('custom-model')).toBe(false);
    });
  });

  describe('API Parameters', () => {
    test('should use correct token parameter for GPT-5', () => {
      expect(getTokenLimitParam('gpt-5-nano')).toBe('max_output_tokens');
      expect(getTokenLimitParam('gpt-5-mini')).toBe('max_output_tokens');
    });

    test('should use correct token parameter for non-GPT-5', () => {
      expect(getTokenLimitParam('gpt-4o')).toBe('max_tokens');
      expect(getTokenLimitParam('gpt-4-turbo')).toBe('max_tokens');
      expect(getTokenLimitParam('claude-3-sonnet')).toBe('max_tokens');
    });

    test('should use temperature = 1 for GPT-5 models', () => {
      expect(getModelTemperature('gpt-5-nano')).toBe(1);
      expect(getModelTemperature('gpt-5-mini')).toBe(1);
    });

    test('should use default temperature for non-GPT-5 models', () => {
      expect(getModelTemperature('gpt-4o')).toBe(0.3);
      expect(getModelTemperature('gpt-4-turbo')).toBe(0.3);
      expect(getModelTemperature('claude-3-sonnet')).toBe(0.3);
    });

    test('should use correct API endpoints', () => {
      expect(getApiEndpoint('gpt-5-nano')).toBe('https://api.openai.com/v1/responses');
      expect(getApiEndpoint('gpt-4o')).toBe('https://api.openai.com/v1/chat/completions');
    });
  });

  describe('Payload Generation', () => {
    const testPrompt = 'Explain this flow:';
    const testData = 'Sample flow data';
    const systemPrompt = 'You are a Salesforce flow expert.';

    test('should generate correct payload for GPT-5 models', () => {
      const payload = buildPayload('gpt-5-nano', testPrompt, testData, systemPrompt);
      
      expect(payload).toEqual({
        model: 'gpt-5-nano',
        input: `${systemPrompt}\n\n${testPrompt} ${testData}`,
        temperature: 1,
        max_output_tokens: 2000
      });

      // Should not have chat completion parameters
      expect(payload.messages).toBeUndefined();
      expect(payload.top_p).toBeUndefined();
      expect(payload.frequency_penalty).toBeUndefined();
      expect(payload.presence_penalty).toBeUndefined();
    });

    test('should generate correct payload for non-GPT-5 models', () => {
      const payload = buildPayload('gpt-4o', testPrompt, testData, systemPrompt);
      
      expect(payload).toEqual({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'text', text: `${testPrompt} ${testData}` }] }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        top_p: 0.2,
        frequency_penalty: 0,
        presence_penalty: 0
      });

      // Should not have GPT-5 parameters
      expect(payload.input).toBeUndefined();
      expect(payload.max_output_tokens).toBeUndefined();
    });

    test('should handle custom models as non-GPT-5', () => {
      const payload = buildPayload('claude-3-sonnet', testPrompt, testData, systemPrompt);
      
      expect(payload.model).toBe('claude-3-sonnet');
      expect(payload.messages).toBeDefined();
      expect(payload.temperature).toBe(0.3);
      expect(payload.max_tokens).toBe(2000);
      expect(payload.input).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty model names', () => {
      expect(isGPT5Model('')).toBe(false);
      expect(isGPT5Model(null)).toBe(false);
      expect(isGPT5Model(undefined)).toBe(false);
    });

    test('should handle case sensitivity', () => {
      expect(isGPT5Model('GPT-5-NANO')).toBe(true);
      expect(isGPT5Model('Gpt-5-Mini')).toBe(true);
      expect(isGPT5Model('gPt-5')).toBe(true);
    });

    test('should handle models that start with gpt-5 but have additional text', () => {
      expect(isGPT5Model('gpt-5-custom-version')).toBe(true);
      expect(isGPT5Model('gpt-5a')).toBe(true);
    });

    test('should not match models that contain but do not start with gpt-5', () => {
      expect(isGPT5Model('custom-gpt-5-model')).toBe(false);
      expect(isGPT5Model('new-gpt-5')).toBe(false);
    });
  });
});