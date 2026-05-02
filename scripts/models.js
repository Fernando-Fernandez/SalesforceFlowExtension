const DEFAULT_MODEL_CONFIG = {
    endpoint:          'https://api.openai.com/v1/chat/completions',
    payloadStyle:      'messages',
    tokenLimitParam:   'max_tokens',
    maxTokens:         2000,
    temperature:       0.3,
    top_p:             0.2,
    frequency_penalty: 0,
    presence_penalty:  0
};

// Models whose ID starts with or contains one of these strings use the Responses API
const RESPONSES_API_FAMILIES = ['gpt-5', 'o4-mini'];

const RESPONSES_API_OVERRIDE = {
    endpoint:        'https://api.openai.com/v1/responses',
    payloadStyle:    'input',
    tokenLimitParam: 'max_output_tokens',
    maxTokens:       5000,
    temperature:     1
};

function getModelConfig( modelId ) {
    const id = modelId.toLowerCase();
    const usesResponsesApi = RESPONSES_API_FAMILIES.some(
        family => id.startsWith( family ) || id.includes( family )
    );
    return usesResponsesApi
        ? { ...DEFAULT_MODEL_CONFIG, ...RESPONSES_API_OVERRIDE }
        : { ...DEFAULT_MODEL_CONFIG };
}
