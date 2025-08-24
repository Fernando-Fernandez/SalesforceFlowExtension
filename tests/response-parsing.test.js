// Tests for API response parsing logic

describe('Response Parsing Logic', () => {
  // Helper function to simulate GPT-5 response parsing
  function parseGPT5Response(apiResponse) {
    if (apiResponse === null || apiResponse === undefined) {
      throw new Error('Response cannot be null or undefined');
    }
    
    try {
      const parsedResponse = JSON.parse(apiResponse);
      
      if (parsedResponse.error) {
        return `${parsedResponse.error.message} (${parsedResponse.error.type})`;
      }
      
      if (parsedResponse.output?.content?.text !== undefined) {
        let responseText = parsedResponse.output.content.text;
        
        // Check if response was truncated due to token limit
        if (parsedResponse.status === 'incomplete' && parsedResponse.incomplete_details?.reason === 'max_tokens') {
          responseText += ' (RESPONSE TRUNCATED DUE TO LIMIT)';
        }
        
        return responseText;
      } else {
        return 'No response content received from GPT-5 model';
      }
    } catch (error) {
      return `Failed to parse response: ${error.message}`;
    }
  }

  // Helper function to simulate standard response parsing
  function parseStandardResponse(apiResponse) {
    if (apiResponse === null || apiResponse === undefined) {
      throw new Error('Response cannot be null or undefined');
    }
    
    try {
      const parsedResponse = JSON.parse(apiResponse);
      
      if (parsedResponse.error) {
        return `${parsedResponse.error.message} (${parsedResponse.error.type})`;
      }
      
      let finishReason = parsedResponse.choices[0].finish_reason;
      let responseText = parsedResponse.choices[0].message.content;
      
      // Check if response was truncated due to token limit
      if (finishReason === 'length') {
        responseText += ' (RESPONSE TRUNCATED DUE TO LIMIT)';
      }
      
      return responseText;
    } catch (error) {
      return `Failed to parse response: ${error.message}`;
    }
  }

  describe('GPT-5 Response Parsing', () => {
    test('should parse successful GPT-5 response', () => {
      const mockResponse = JSON.stringify({
        output: {
          content: {
            text: 'This is a sample response from GPT-5'
          }
        },
        status: 'complete'
      });

      const result = parseGPT5Response(mockResponse);
      expect(result).toBe('This is a sample response from GPT-5');
    });

    test('should handle GPT-5 response truncated due to max tokens', () => {
      const mockResponse = JSON.stringify({
        output: {
          content: {
            text: 'This is a truncated response'
          }
        },
        status: 'incomplete',
        incomplete_details: {
          reason: 'max_tokens'
        }
      });

      const result = parseGPT5Response(mockResponse);
      expect(result).toBe('This is a truncated response (RESPONSE TRUNCATED DUE TO LIMIT)');
    });

    test('should handle GPT-5 response with incomplete status but different reason', () => {
      const mockResponse = JSON.stringify({
        output: {
          content: {
            text: 'Response stopped for other reason'
          }
        },
        status: 'incomplete',
        incomplete_details: {
          reason: 'stop_sequence'
        }
      });

      const result = parseGPT5Response(mockResponse);
      expect(result).toBe('Response stopped for other reason');
    });

    test('should handle GPT-5 response without content', () => {
      const mockResponse = JSON.stringify({
        output: {},
        status: 'complete'
      });

      const result = parseGPT5Response(mockResponse);
      expect(result).toBe('No response content received from GPT-5 model');
    });

    test('should handle GPT-5 API error response', () => {
      const mockResponse = JSON.stringify({
        error: {
          message: 'Invalid API key',
          type: 'authentication_error'
        }
      });

      const result = parseGPT5Response(mockResponse);
      expect(result).toBe('Invalid API key (authentication_error)');
    });

    test('should handle malformed GPT-5 JSON response', () => {
      const mockResponse = 'invalid json {';

      const result = parseGPT5Response(mockResponse);
      expect(result).toMatch(/Failed to parse response:/);
    });
  });

  describe('Standard Response Parsing', () => {
    test('should parse successful standard response', () => {
      const mockResponse = JSON.stringify({
        choices: [{
          message: {
            content: 'This is a sample response from GPT-4'
          },
          finish_reason: 'stop'
        }]
      });

      const result = parseStandardResponse(mockResponse);
      expect(result).toBe('This is a sample response from GPT-4');
    });

    test('should handle standard response truncated due to length', () => {
      const mockResponse = JSON.stringify({
        choices: [{
          message: {
            content: 'This is a truncated response'
          },
          finish_reason: 'length'
        }]
      });

      const result = parseStandardResponse(mockResponse);
      expect(result).toBe('This is a truncated response (RESPONSE TRUNCATED DUE TO LIMIT)');
    });

    test('should handle standard API error response', () => {
      const mockResponse = JSON.stringify({
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit_error'
        }
      });

      const result = parseStandardResponse(mockResponse);
      expect(result).toBe('Rate limit exceeded (rate_limit_error)');
    });

    test('should handle malformed standard JSON response', () => {
      const mockResponse = 'invalid json {';

      const result = parseStandardResponse(mockResponse);
      expect(result).toMatch(/Failed to parse response:/);
    });

    test('should handle missing choices in standard response', () => {
      const mockResponse = JSON.stringify({
        usage: { total_tokens: 100 }
      });

      const result = parseStandardResponse(mockResponse);
      expect(result).toMatch(/Failed to parse response:/);
    });
  });

  describe('Common Error Cases', () => {
    const commonErrorCases = [
      {
        name: 'authentication error',
        response: {
          error: {
            message: 'Incorrect API key provided',
            type: 'invalid_request_error'
          }
        },
        expected: 'Incorrect API key provided (invalid_request_error)'
      },
      {
        name: 'rate limit error',
        response: {
          error: {
            message: 'Rate limit reached',
            type: 'rate_limit_error'
          }
        },
        expected: 'Rate limit reached (rate_limit_error)'
      },
      {
        name: 'model not found error',
        response: {
          error: {
            message: 'The model does not exist',
            type: 'invalid_request_error'
          }
        },
        expected: 'The model does not exist (invalid_request_error)'
      }
    ];

    commonErrorCases.forEach(testCase => {
      test(`should handle ${testCase.name} for GPT-5`, () => {
        const result = parseGPT5Response(JSON.stringify(testCase.response));
        expect(result).toBe(testCase.expected);
      });

      test(`should handle ${testCase.name} for standard models`, () => {
        const result = parseStandardResponse(JSON.stringify(testCase.response));
        expect(result).toBe(testCase.expected);
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty response string', () => {
      expect(parseGPT5Response('')).toMatch(/Failed to parse response:/);
      expect(parseStandardResponse('')).toMatch(/Failed to parse response:/);
    });

    test('should handle null response', () => {
      expect(() => parseGPT5Response(null)).toThrow();
      expect(() => parseStandardResponse(null)).toThrow();
    });

    test('should handle response with null content', () => {
      const gpt5Response = JSON.stringify({
        output: {
          content: {
            text: null
          }
        },
        status: 'complete'
      });

      const standardResponse = JSON.stringify({
        choices: [{
          message: {
            content: null
          },
          finish_reason: 'stop'
        }]
      });

      // These should handle null gracefully - GPT-5 will return the null value, standard will too
      expect(parseGPT5Response(gpt5Response)).toBe(null);
      expect(parseStandardResponse(standardResponse)).toBe(null);
    });

    test('should handle deeply nested missing properties', () => {
      const gpt5ResponseMissingText = JSON.stringify({
        output: {
          content: {}
        }
      });

      const gpt5ResponseMissingContent = JSON.stringify({
        output: {}
      });

      expect(parseGPT5Response(gpt5ResponseMissingText)).toBe('No response content received from GPT-5 model');
      expect(parseGPT5Response(gpt5ResponseMissingContent)).toBe('No response content received from GPT-5 model');
    });
  });
});