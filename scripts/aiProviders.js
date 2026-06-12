// AI provider registry and streaming client used by popup.js.
//
// Loaded as a classic script (extension pages cannot import extension files
// as ES modules), so it attaches a single global object, like flowParser.js.
//
// Each provider knows how to build its streaming HTTP request and how to pull
// the text delta out of one parsed stream chunk. streamChat() handles the
// transport: SSE ("data: {...}" lines, used by OpenAI/Anthropic/Gemini) and
// NDJSON (one JSON object per line, used by Ollama) both parse line-by-line.
globalThis.AIProviders = ( function() {

    const MAX_OUTPUT_TOKENS = 2000;
    // the responses API models get a larger budget (reasoning consumes tokens)
    const OPENAI_RESPONSES_MAX_TOKENS = 5000;

    // OpenAI models served by the responses endpoint instead of chat completions
    function isOpenAIResponsesModel( model ) {
        return model.toLowerCase().startsWith( 'gpt-5' )
            || model.toLowerCase().includes( 'o4-mini' );
    }

    const PROVIDERS = {
        openai: {
            label: 'OpenAI'
            , requiresKey: true
            , models: [ 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4.1' ]
            , defaultModel: 'gpt-5-mini'
            , buildRequest( { model, apiKey, systemPrompt, userText, temperature } ) {
                if( isOpenAIResponsesModel( model ) ) {
                    return {
                        url: 'https://api.openai.com/v1/responses'
                        , headers: {
                            'Content-Type': 'application/json'
                            , 'Authorization': 'Bearer ' + apiKey
                        }
                        , body: {
                            model: model
                            , input: `${ systemPrompt }\n\n${ userText }`
                            // GPT-5 models only support temperature = 1
                            , temperature: 1
                            , max_output_tokens: OPENAI_RESPONSES_MAX_TOKENS
                            , stream: true
                        }
                    };
                }
                return {
                    url: 'https://api.openai.com/v1/chat/completions'
                    , headers: {
                        'Content-Type': 'application/json'
                        , 'Authorization': 'Bearer ' + apiKey
                    }
                    , body: {
                        model: model
                        , messages: [
                            { role: 'system', content: systemPrompt }
                            , { role: 'user', content: userText }
                        ]
                        , temperature: temperature
                        , max_tokens: MAX_OUTPUT_TOKENS
                        , stream: true
                    }
                };
            }
            , extractDelta( chunk ) {
                // responses API stream event
                if( chunk.type === 'response.output_text.delta' ) {
                    return chunk.delta ?? null;
                }
                // chat completions stream chunk
                return chunk.choices?.[ 0 ]?.delta?.content ?? null;
            }
            , extractError( parsed ) {
                return parsed.error?.message;
            }
        }

        , anthropic: {
            label: 'Anthropic'
            , requiresKey: true
            , models: [ 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8' ]
            , defaultModel: 'claude-sonnet-4-6'
            , buildRequest( { model, apiKey, systemPrompt, userText, temperature } ) {
                return {
                    url: 'https://api.anthropic.com/v1/messages'
                    , headers: {
                        'Content-Type': 'application/json'
                        , 'x-api-key': apiKey
                        , 'anthropic-version': '2023-06-01'
                        // required for the API to accept requests sent
                        // directly from a browser context
                        , 'anthropic-dangerous-direct-browser-access': 'true'
                    }
                    , body: {
                        model: model
                        , max_tokens: MAX_OUTPUT_TOKENS
                        , system: systemPrompt
                        , messages: [ { role: 'user', content: userText } ]
                        , temperature: temperature
                        , stream: true
                    }
                };
            }
            , extractDelta( chunk ) {
                if( chunk.type === 'content_block_delta' ) {
                    return chunk.delta?.text ?? null;
                }
                return null;
            }
            , extractError( parsed ) {
                return parsed.error?.message;
            }
        }

        , gemini: {
            label: 'Google Gemini'
            , requiresKey: true
            , models: [ 'gemini-2.5-flash', 'gemini-2.5-pro' ]
            , defaultModel: 'gemini-2.5-flash'
            , buildRequest( { model, apiKey, systemPrompt, userText, temperature } ) {
                return {
                    url: `https://generativelanguage.googleapis.com/v1beta/models/${ model }:streamGenerateContent?alt=sse`
                    , headers: {
                        'Content-Type': 'application/json'
                        , 'x-goog-api-key': apiKey
                    }
                    , body: {
                        systemInstruction: { parts: [ { text: systemPrompt } ] }
                        , contents: [ { role: 'user', parts: [ { text: userText } ] } ]
                        , generationConfig: {
                            maxOutputTokens: MAX_OUTPUT_TOKENS
                            , temperature: temperature
                        }
                    }
                };
            }
            , extractDelta( chunk ) {
                return chunk.candidates?.[ 0 ]?.content?.parts?.[ 0 ]?.text ?? null;
            }
            , extractError( parsed ) {
                return parsed.error?.message;
            }
        }

        , ollama: {
            label: 'Ollama (local)'
            , requiresKey: false
            , models: [ 'llama3.2', 'qwen3', 'mistral' ]
            , defaultModel: 'llama3.2'
            , buildRequest( { model, systemPrompt, userText, temperature } ) {
                return {
                    url: 'http://localhost:11434/api/chat'
                    , headers: { 'Content-Type': 'application/json' }
                    , body: {
                        model: model
                        , messages: [
                            { role: 'system', content: systemPrompt }
                            , { role: 'user', content: userText }
                        ]
                        , stream: true
                        , options: {
                            temperature: temperature
                            , num_predict: MAX_OUTPUT_TOKENS
                        }
                    }
                };
            }
            , extractDelta( chunk ) {
                return chunk.message?.content ?? null;
            }
            , extractError( parsed ) {
                // ollama errors are either a string or { message: ... }
                return parsed.error?.message ?? parsed.error;
            }
        }
    };

    // streams a chat completion from the given provider; onDelta is called with
    // (deltaText, fullTextSoFar) for every chunk; resolves to the full text
    async function streamChat( { provider, model, apiKey, systemPrompt, userText
                                , temperature, onDelta } ) {
        const providerDef = PROVIDERS[ provider ];
        if( ! providerDef ) {
            throw new Error( `Unknown AI provider: ${ provider }` );
        }

        const request = providerDef.buildRequest( { model, apiKey, systemPrompt
                                                    , userText, temperature } );
        const response = await fetch( request.url, {
            method: 'POST'
            , headers: request.headers
            , body: JSON.stringify( request.body )
        } );

        if( ! response.ok ) {
            const text = await response.text();
            let message = text;
            try {
                message = providerDef.extractError( JSON.parse( text ) ) ?? text;
            } catch( e ) {
                // response was not JSON, show it as-is
            }
            // never show "[object Object]" when the error payload is structured
            if( typeof message !== 'string' ) {
                message = JSON.stringify( message );
            }
            throw new Error( `${ providerDef.label } request failed (${ response.status }): ${ message }` );
        }

        // read the stream line by line; SSE payload lines carry a "data: "
        // prefix, NDJSON lines are bare JSON; both end up parsed the same way
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        const consumeLine = ( rawLine ) => {
            let line = rawLine.trim();
            if( ! line || line.startsWith( 'event:' ) || line === 'data: [DONE]' ) {
                return;
            }
            if( line.startsWith( 'data:' ) ) {
                line = line.slice( 5 ).trim();
            }
            let parsed;
            try {
                parsed = JSON.parse( line );
            } catch( e ) {
                return; // partial or non-JSON line (e.g. SSE comments)
            }
            // streamed error events (e.g. Anthropic mid-stream errors)
            if( parsed.type === 'error' || ( parsed.error && ! parsed.choices ) ) {
                throw new Error( providerDef.extractError( parsed )
                                ?? parsed.error?.message ?? 'stream error' );
            }
            const delta = providerDef.extractDelta( parsed );
            if( delta ) {
                fullText += delta;
                if( onDelta ) {
                    onDelta( delta, fullText );
                }
            }
        };

        while( true ) {
            const { done, value } = await reader.read();
            if( done ) {
                break;
            }
            buffer += decoder.decode( value, { stream: true } );
            let newlineIndex;
            while( ( newlineIndex = buffer.indexOf( '\n' ) ) >= 0 ) {
                const line = buffer.slice( 0, newlineIndex );
                buffer = buffer.slice( newlineIndex + 1 );
                consumeLine( line );
            }
        }
        // flush whatever remains after the final chunk
        consumeLine( buffer );

        return fullText;
    }

    return { PROVIDERS, streamChat };
} )();

// allow unit tests (Node/Jest) to load this file directly
if( typeof module !== 'undefined' && module.exports ) {
    module.exports = globalThis.AIProviders;
}
