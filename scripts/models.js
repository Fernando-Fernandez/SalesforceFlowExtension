// Default API parameters used for all models unless overridden below.
const DEFAULT_CONFIG = {
    tokenLimitParam: 'max_tokens',
    temperature:     0.3,
    top_p:           0.2
};

// Per-model overrides. Only specify what differs from DEFAULT_CONFIG.
// Add a new entry here whenever a model requires non-standard parameters.
const MODEL_OVERRIDES = {
    'gpt-5-mini': {
        tokenLimitParam: 'max_completion_tokens',
        temperature:     1,
        top_p:           1
    },
    'gpt-5-nano': {
        tokenLimitParam: 'max_completion_tokens',
        temperature:     1,
        top_p:           1
    }
};

export function getModelConfig( modelId ) {
    return { ...DEFAULT_CONFIG, ...( MODEL_OVERRIDES[ modelId ] ?? {} ) };
}
