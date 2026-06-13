// Configuration Constants
const CONFIG = {
    // Storage and caching
    // API keys are stored locally and unencrypted (an extension has no way to
    // keep a real secret client-side), one entry per provider
    PROVIDER_KEYS_STORAGE: 'aiProviderKeys',
    // older versions kept a single OpenAI key under these names
    LEGACY_OPENAI_STORAGE_KEY: 'openAIKey',
    LEGACY_LOCALSTORAGE_KEY: 'hashedKey',
    CACHE_DURATION: 300000, // 5 minutes in milliseconds

    // request parameters (provider-specific shapes live in aiProviders.js)
    GPT_PARAMS: {
        temperature: 0.3
    },

    // Data size limits
    DATA_LIMITS: {
        model_upgrade_threshold: 16200,    // chars - upgrade from gpt-5-nano to a larger model
        truncation_threshold: 130872,      // chars - hard limit for any model
        cache_key_substring_length: 20     // chars - for cache key generation
    },

    // System prompts and messages
    PROMPTS: {
        default: `Your purpose is to help everyone quickly understand what this Salesforce flow does and how. Let us think step-by-step and briefly summarize the flow in the format: \\npurpose of the flow, the main objects queried/inserted/updated, dependencies (labels, hard-coded ids, values, emails, names, etc) from outside the flow, the main conditions it evaluates, and any potential or evident issues.\\nFLOW: \\n`,
        system: 'You are an expert at troubleshooting and explaining Salesforce flows.',
        no_response: 'No response content received from the model'
    },

    // Error messages
    ERRORS: {
        no_key: "Please set an API key for the selected AI provider to get an AI explanation.",
        no_data_received: 'No data received from current page.',
        no_data_to_send: 'No data to send.'
    },

    // Flow element types and values
    FLOW: {
        element_types: {
            start: 'start'
        },
        parameter_separator: ' / ',
        parameter_separator_length: 2
    },

    // Hash function constants
    HASH: {
        shift_amount: 5,
        initial_value: 0
    }
};

const dom = {
    setKeyButton: document.getElementById('setKey'),
    defaultExplainer: document.getElementById('defaultExplainer'),
    lintResults: document.getElementById('lintResults'),
    response: document.getElementById('response'),
    error: document.getElementById('error'),
    spinner: document.getElementById('spinner'),
    gptDialogContainer: document.getElementById('gptDialogContainer'),
    gptButton: document.getElementById('gptButton'),
    gptModelSelection: document.getElementById('gptModelSelection'),
    modelSelect: document.getElementById('modelSelect'),
    customModelName: document.getElementById('custom-model-name'),
    providerSelection: document.getElementById('providerSelection'),
    apiKeyRow: document.getElementById('apiKeyRow'),
    apiKeyLabel: document.getElementById('apiKeyLabel'),
    ollamaHint: document.getElementById('ollamaHint'),
    gptQuestion: document.getElementById('gptQuestion'),
    flowTableContainer: document.getElementById('flowTableContainer'),
    downloadButton: document.getElementById('downloadButton'),
    openAIKeyInput: document.querySelector('input#openAIKey')
};

// ---- AI provider / model selection ----
const PROVIDER_PREF = 'selectedAIProvider';
const MODEL_PREF_PREFIX = 'selectedModel:';
const LEGACY_MODEL_PREF = 'selectedGPTModel';
const CUSTOM_MODEL_OPTION = 'custom';

function getSelectedProvider() {
    const saved = localStorage.getItem( PROVIDER_PREF );
    return AIProviders.PROVIDERS[ saved ] ? saved : 'openai';
}

function getSavedModel( provider ) {
    let saved = localStorage.getItem( MODEL_PREF_PREFIX + provider );
    // migrate the preference saved before multi-provider support
    if( ! saved && provider === 'openai' ) {
        saved = localStorage.getItem( LEGACY_MODEL_PREF );
    }
    return saved || AIProviders.PROVIDERS[ provider ].defaultModel;
}

// the model to call right now:  the dropdown value, or the custom name
function getSelectedModel( provider ) {
    if( dom.modelSelect.value === CUSTOM_MODEL_OPTION ) {
        return dom.customModelName.value.trim()
                || AIProviders.PROVIDERS[ provider ].defaultModel;
    }
    return dom.modelSelect.value || AIProviders.PROVIDERS[ provider ].defaultModel;
}

function populateModelSelect( provider ) {
    const providerDef = AIProviders.PROVIDERS[ provider ];
    dom.modelSelect.innerHTML = '';
    providerDef.models.forEach( aModel => {
        const option = document.createElement( 'option' );
        option.value = aModel;
        option.textContent = aModel;
        dom.modelSelect.appendChild( option );
    } );
    const customOption = document.createElement( 'option' );
    customOption.value = CUSTOM_MODEL_OPTION;
    customOption.textContent = 'Custom…';
    dom.modelSelect.appendChild( customOption );

    const saved = getSavedModel( provider );
    if( providerDef.models.includes( saved ) ) {
        dom.modelSelect.value = saved;
        dom.customModelName.style.display = 'none';
    } else {
        // a saved model outside the list is a custom model name
        dom.modelSelect.value = CUSTOM_MODEL_OPTION;
        dom.customModelName.value = ( saved === CUSTOM_MODEL_OPTION ? '' : saved );
        dom.customModelName.style.display = 'inline-block';
    }
}

function applyProviderSelection( provider ) {
    const providerDef = AIProviders.PROVIDERS[ provider ];
    const radio = dom.providerSelection.querySelector( `input[value="${ provider }"]` );
    if( radio ) {
        radio.checked = true;
    }
    dom.apiKeyRow.style.display = ( providerDef.requiresKey ? 'block' : 'none' );
    dom.ollamaHint.style.display = ( providerDef.requiresKey ? 'none' : 'block' );
    dom.apiKeyLabel.textContent = providerDef.label + ' API Key';
    populateModelSelect( provider );
}

// selection events, wired once at load (handler properties, no stacking)
dom.providerSelection.onchange = ( e ) => {
    if( e.target.name === 'ai-provider' ) {
        localStorage.setItem( PROVIDER_PREF, e.target.value );
        applyProviderSelection( e.target.value );
    }
};

dom.modelSelect.onchange = () => {
    if( dom.modelSelect.value === CUSTOM_MODEL_OPTION ) {
        dom.customModelName.style.display = 'inline-block';
        dom.customModelName.focus();
    } else {
        dom.customModelName.style.display = 'none';
        localStorage.setItem( MODEL_PREF_PREFIX + getSelectedProvider(), dom.modelSelect.value );
    }
};

dom.customModelName.oninput = () => {
    if( dom.modelSelect.value === CUSTOM_MODEL_OPTION && dom.customModelName.value.trim() ) {
        localStorage.setItem( MODEL_PREF_PREFIX + getSelectedProvider()
                            , dom.customModelName.value.trim() );
    }
};

applyProviderSelection( getSelectedProvider() );

class FlowParser {
    parseValue( rightValue ) {
        // shared extraction; the table prints 'null' for missing values
        return FlowParserShared.getValue( rightValue, 'null' );
    }

    convertOperator( operator ) {
        if( operator == undefined ) {
            return '=';
        }
        return ( operator.includes( 'Not' ) ? 'NOT ' : '' )
            + ( operator.includes( 'EqualTo' ) || operator.includes( 'Assign' ) ? '=' : operator );
    }

    getFilters( action ) {
        let parameters = '';
        parameters += ( action.filters?.length > 0 ? ` / Filters: ` : '');
        parameters += this.getFieldOperations( action.filters );
        return parameters;
    }

    addInputOutputParameters( action ) {
        let parameters = '';
        parameters += ( action.inputAssignments?.length > 0 ? ` / Input assignments: ` : '' );
        action.inputAssignments?.forEach(i => {
            parameters += ` / ${i.field} = ${this.parseValue(i.value)}`;
        });
        parameters += ( action.outputAssignments?.length > 0 ? ` / Output assignments: ` : '' );
        action.outputAssignments?.forEach(i => {
            parameters += ` / ${i.field} = ${this.parseValue(i.value)}`;
        });

        parameters += this.getFilters( action );

        parameters += ( action.inputParameters?.length > 0 ? ` / Input parameters: ` : '' );
        action.inputParameters?.forEach(i => {
            parameters += ` / ${i.name} = ${this.parseValue(i.value)}`;
        });
        parameters += ( action.outputParameters?.length > 0 ? ` / Output parameters: ` : '' );
        action.outputParameters?.forEach(o => {
            parameters += ` / ${o.name} = ${this.parseValue(o.value)}`;
        });
        return parameters;
    }

    parenthesis( value ) {
        return ( value ? ' (' + value + ')' : '' );
    }

    getFieldOperations( fieldOperations ) {
        let parameters = '';
        fieldOperations?.forEach( f => {
            let field = f.field ?? f.assignToReference ?? f.leftValueReference;
            let operator = this.convertOperator(f.operator);
            let value = f.value ?? f.rightValue;
            parameters += ` / ${field} ${operator} ${this.parseValue( value )}`;
        });
        return parameters;
    }

    getStoreOutput( action ) {
        if( action.storeOutputAutomatically ) {
            return ` / Store output? = ${action.storeOutputAutomatically}`;
        }
        return '';
    }

    getParameters( action ) {
        let parameters = '';
        let elementType = action.type;

        if( elementType == CONFIG.FLOW.element_types.start ) {
            let type = action.triggerType + ' ' + action.recordTriggerType;
            parameters += `Type = ${type}`;
            parameters += ` / Object = ${action.object}`;
            parameters += ` / Requires Record Changed To Meet Criteria = ${action.doesRequireRecordChangedToMeetCriteria}`;
            parameters += this.getFilters( action );
            if( action.filterFormula ) {
                parameters += ` / Filter formula = ${action.filterFormula}`;
            }
            if( action.schedule ) {
                parameters += ` / Schedule = ${action.schedule.startDate} ${action.schedule.startTime} ${action.schedule.frequency}`;
            }
        }

        if( elementType == 'assignment' ) {
            parameters += this.getFieldOperations( action.assignmentItems );
        }

        if( elementType == 'variable' ) {
            let type = ( action.isCollection ? 'Collection of ' : '' ) + action.dataType;
            parameters += `Type = ${type}`;
            parameters += ` / Input = ${action.isInput}`;
            parameters += ` / Output = ${action.isOutput}`;
            parameters += ` / Value = ${this.parseValue( action.value )}`;
        }

        if( elementType == 'constant' ) {
            parameters += `Type = ${action.dataType}`;
            parameters += ` / Value = ${this.parseValue( action.value )}`;
        }

        if( elementType == 'textTemplate' ) {
            let text = action.text.replaceAll( '<', '&lt;' ).replaceAll( '>', '&gt;' );
            parameters += `Text = ${text}`;
            parameters += ` / Plain Text = ${action.isViewedAsPlainText}`;
        }

        if( elementType == 'formula' ) {
            parameters += `Type = ${action.dataType}`;
            parameters += ` / Expression = ${action.expression}`;
        }

        if( elementType == 'choice' ) {
            parameters += `Text = ${action.choiceText}`;
            parameters += ` / Type = ${action.dataType}`;
            parameters += ` / Value = ${this.parseValue( action.value )}`;
        }

        if( elementType == 'transform' ) {
            parameters += ` \n Target = ${ action.objectType ?? action.dataType }`;

            action.transformValues?.forEach( aTransformValue => {
                aTransformValue?.transformValueActions.forEach( aTransformAction => {
                    let aValue = this.parseValue( aTransformAction.value );
                    let transformDescription = aTransformAction.transformType + ': '
                                + ( aValue !== 'null' ? aValue : 'formula' )
                                + ( aTransformAction.outputFieldApiName ? ' to ' + aTransformAction.outputFieldApiName : '' );
                    parameters += ` / ${transformDescription}`;
                } );
            } );
        }


        if( elementType == 'collectionProcessor' ) {
            parameters += `Collection = ${action.collectionReference}`;
            parameters += ` / Processing type = ${action.collectionProcessorType}`;
            parameters += ` / Assign next value to = ${action.assignNextValueToReference}`;
            parameters += ` / Filter formula = ${action.formula}`;
            parameters += ` / Output object = ${action.outputSObjectType}`;
            parameters += this.getFieldOperations( action.conditions );
        }

        if( elementType == 'dynamicChoiceSet' ) {
            parameters += `Collection = ${action.collectionReference}`;
            parameters += ` / Type = ${action.dataType}`;
            parameters += ` / Object = ${action.object}`;
            parameters += ` / Picklist object = ${action.picklistObject}`;
            parameters += ` / Picklist field = ${action.picklistField}`;
            parameters += ` / Display field = ${action.displayField}`;
        }

        if( elementType == 'actionCall' ) {
            parameters += `Type = ${action.actionType}`;
            parameters += this.getStoreOutput( action );
            parameters += this.addInputOutputParameters( action );
        }

        if( elementType == 'apexPluginCalls' ) {
            parameters += `Apex class = ${action.apexClass}`;
            parameters += this.addInputOutputParameters( action );
        }

        if( elementType == 'subflows' ) {
            parameters += `Flow = ${action.flowName}`;
            parameters += this.getStoreOutput( action );
            parameters += this.addInputOutputParameters( action );
        }

        if( elementType == 'recordLookup' ) {
            parameters += `Object = ${action.object}`;
            parameters += ` / Assign null if no records? = ${action.assignNullValuesIfNoRecordsFound}`;
            parameters += ` / First record only? = ${action.getFirstRecordOnly}`;
            parameters += this.getStoreOutput( action );
            parameters += this.getFieldOperations( action.filters );
        }

        if( elementType == 'recordCreate' ) {
            parameters += `Object = ${action.object}`;
            parameters += ` / Assign id? = ${action.assignRecordIdToReference}`;
            parameters += this.getStoreOutput( action );
            parameters += this.addInputOutputParameters( action );
        }

        if( elementType == 'recordUpdate' ) {
            parameters += `Reference = ${action.inputReference}`;
            if( action.object ) {
                parameters += ` / Object = ${action.object}`;
            }
            parameters += this.addInputOutputParameters( action );
            parameters += this.getFieldOperations( action.filters );
        }

        if( elementType == 'recordDelete' ) {
            parameters += `Reference = ${action.inputReference}`;
            if( action.object ) {
                parameters += ` / Object = ${action.object}`;
            }
            parameters += this.getFieldOperations( action.filters );
        }

        if( elementType == 'screen' ) {
            action.fields.forEach( f => {
                parameters += ` / ${f.fieldText ?? ''} ${f.dataType ?? ''} ${f.fieldType ?? ''} ${f.objectFieldReference ?? ''}`;
            });
        }

        if( elementType == 'loop' ) {
            parameters += `Collection = ${action.collectionReference}`;
            parameters += ` / Order = ${action.iterationOrder}`;
        }

        if( parameters.indexOf( CONFIG.FLOW.parameter_separator ) == 0 ) {
            parameters = parameters.substring( CONFIG.FLOW.parameter_separator_length );
        }

        return parameters;
    }

    // builds the table as structured rows of [ name, type, parameters, condition,
    // next element ]; continuation rows of the same element have the first three
    // cells empty; consumed by the DOM table builder and the markdown generator
    getTableRows( actionMap ) {
        let rows = [];
        const continuationCells = [ '', '', '' ];

        for( const [ identifier, action ] of actionMap ) {
            let elementType = action.type;
            let faultElement = action.faultElement;

            let nextElement = action.connector?.targetReference
                            ?? action.defaultConnector?.targetReference
                            ?? '';

            let firstCells = [ action.fullDescription, elementType, action.parameters ];

            // handle elements with multiple rows
            if( elementType == CONFIG.FLOW.element_types.start ) {
                rows.push( [ ...firstCells, 'Runs immediately', nextElement ] );
                action.scheduledPaths?.forEach( s => {
                    let condition = `${s.label} / ${s.offsetNumber} ${s.offsetUnit} `
                                + `${( s.timeSource == 'RecordField' ? s.recordField : 'RecordTriggerEvent' )}`;
                    rows.push( [ ...continuationCells, condition, s.connector?.targetReference ?? '' ] );
                } );
                continue;
            }

            if( elementType == 'decision' ) {
                rows.push( [ ...firstCells, action.defaultCondition
                            , action.defaultConnector?.targetReference ?? '' ] );
                firstCells = continuationCells;
            }

            if( elementType == 'loop' ) {
                rows.push( [ ...firstCells, 'Next value'
                            , action.nextValueConnector?.targetReference ?? '' ] );
                rows.push( [ ...continuationCells, 'No more values'
                            , action.noMoreValuesConnector?.targetReference ?? '' ] );
                continue;
            }

            if( elementType == 'wait' ) {
                action.waitEvents?.forEach( w => {
                    let elementCondition = `${w.label}`
                                        + ` \ Type: ${w.eventType}`
                                        + this.getFieldOperations( w.conditions );
                    rows.push( [ ...firstCells, elementCondition, w.connector?.targetReference ?? '' ] );
                    firstCells = continuationCells;
                } );
                continue;
            }

            // check for rule conditions
            if( action.rules == undefined || action.rules.length == 0 ) {
                if( nextElement && action.defaultConnectorLabel ) {
                    nextElement += ' ' + this.parenthesis( action.defaultConnectorLabel );
                }
                // if no conditions, just add the default condition
                rows.push( [ ...firstCells, action.defaultCondition, nextElement ] );

                if( faultElement ) {
                    rows.push( [ ...continuationCells, 'fault', faultElement ] );
                }

            } else {
                // add row for each rule/branch
                for( const rule of action.rules ) {
                    // add expression for each condition within the rule
                    let elementCondition = rule.name + this.parenthesis( rule.label )
                                        + this.getFieldOperations( rule.conditions );
                    rows.push( [ ...firstCells, elementCondition, rule.connector?.targetReference ?? '' ] );
                    firstCells = continuationCells;
                }
            }
        }

        return rows;
    }

    getMDTableRows( tableRows ) {
        return tableRows
                    .map( cells => `|${ cells.join( '|' ) }|\n` )
                    .join( '' );
    }

    async parse( flowDefinition, subflowDefinitions, runStats ) {
        // surface any parsing failure instead of leaving the popup blank
        try {
            await this.parseAndRender( flowDefinition, subflowDefinitions, runStats );
        } catch( e ) {
            console.error( 'Flow parsing failed:', e );
            dom.error.textContent = 'Could not parse this flow: ' + e.message;
            dom.spinner.style.display = 'none';
        }
    }

    async parseAndRender( flowDefinition, subflowDefinitions, runStats ) {
        // console.log( flowDefinition );

        let flowName = 'Flow:  ' + flowDefinition.label;
        let flowDescription = flowDefinition.description;


        // build the element graph (start element, branch wiring) and decorate
        // it with the table presentation fields
        const { actionMap: graphMap, firstElement } = FlowParserShared.buildElementGraph( flowDefinition );
        let actionMap = graphMap;
        for( const [ , element ] of actionMap ) {
            if( element.type === CONFIG.FLOW.element_types.start ) {
                element.fullDescription = element.name;
            } else {
                element.fullDescription = element.name
                                        + this.parenthesis( element.label )
                                        + ( element.description ? ' / ' + element.description : '' );

                element.defaultCondition = ( element.type == 'variable'
                                            || element.type == 'formula'
                                            || element.type == 'textTemplate' ? '' :
                            ( element.type == 'decision' ? element.defaultConnectorLabel : 'success' ) );
            }
            element.parameters = this.getParameters( element );
        }

        // assign sequential index to elements, following all their branches recursively
        FlowParserShared.indexElements( actionMap, firstElement.name );

        // sort elements by index so that table will be ordered by execution
        actionMap = new Map( [ ...actionMap.entries() ].sort( ( a, b ) => a[ 1 ].index - b[ 1 ].index ) );

        // extract the facts and render them in the shared voice (same one the
        // start-node tooltip uses), then lint the graph for anti-patterns
        const facts = FlowParserShared.extractFacts( actionMap );
        const explanationLines = FlowParserShared.renderExplanation( facts );
        const lintIssues = FlowParserShared.lintFlow( flowDefinition, actionMap );

        // display default explanation (text nodes, so labels cannot inject HTML)
        dom.defaultExplainer.innerHTML = "";
        let explanationHeader = document.createElement( 'b' );
        explanationHeader.textContent = 'This flow:  ';
        dom.defaultExplainer.appendChild( explanationHeader );
        explanationLines.forEach( aLine => {
            dom.defaultExplainer.appendChild( document.createElement( 'br' ) );
            dom.defaultExplainer.appendChild( document.createTextNode( aLine ) );
        } );

        renderLintResults( lintIssues );

        // show how this flow has been doing in production lately
        renderRunStats( runStats );

        // generate itemized description of the flow:  markdown for download/GPT,
        // and the same rows rendered as a DOM table
        let tableRows = this.getTableRows( actionMap );
        let stepByStepMDTable = `${flowName}\nDescription: ${flowDescription}\nType: ${flowDefinition.processType}\n\n`
                            + '|Element name|Type|Parameters|Condition|Condition next element|\n'
                            + '|-|-|-|-|-|\n'
                            + this.getMDTableRows( tableRows );

        // include the lint findings in the markdown so the download documents
        // them and GPT can take them into account
        if( lintIssues.length > 0 ) {
            stepByStepMDTable += '\nPotential issues:\n'
                + lintIssues.map( anIssue => `- (${ anIssue.severity }) ${ anIssue.message }` ).join( '\n' )
                + '\n';
        }

        // include the run stats so the AI knows the flow is failing in practice
        if( runStats && ( runStats.errorCount > 0 || runStats.pausedCount > 0 ) ) {
            stepByStepMDTable += `\nRun stats: ${ runStats.errorCount } failed and `
                + `${ runStats.pausedCount } paused interviews in the last ${ runStats.days } days.\n`;
        }

        // describe each called subflow so the AI sees one level deeper than
        // just the subflow's name
        for( const [ subflowName, subflowDefinition ] of Object.entries( subflowDefinitions ?? {} ) ) {
            const { facts } = FlowParserShared.getFlowOverview( subflowDefinition );
            const subflowLines = FlowParserShared.renderExplanation( facts );
            stepByStepMDTable += `\nSubflow ${ subflowName }`
                + ( subflowDefinition.label ? ` (${ subflowDefinition.label })` : '' )
                + ' does the following:\n'
                + subflowLines.map( aLine => `- ${ aLine }` ).join( '\n' ) + '\n';
        }

        // diagram of the full graph, with the tooltip explanations per node
        const mermaidDiagram = FlowParserShared.generateMermaidDiagram(
                                    actionMap, flowDefinition.label );

        createFlowTable( { flowName, flowDescription
                        , processType: flowDefinition.processType
                        , tableRows, actionMap, stepByStepMDTable, mermaidDiagram } );

        // let csvFlow = getCSVFromMarkDown( stepByStepMDTable );
        // console.log( csvFlow );

        // prepare to call OpenAI
        dom.response.innerText = '';

        const provider = getSelectedProvider();
        const apiKey = await getStoredKey( provider );
        if( AIProviders.PROVIDERS[ provider ].requiresKey && ! apiKey ) {
            dom.spinner.style.display = "none";
            dom.response.innerText = '';
            dom.error.innerText = CONFIG.ERRORS.no_key;
            return;
        }

        // the selected provider is usable, show the ask-AI dialog
        dom.gptDialogContainer.style.display = 'block';
        dom.gptModelSelection.style.display = 'block';

        // make button call the selected AI provider
        // (handler property so the latest flow's data replaces any previous handler)
        dom.gptButton.onclick = async () => {
            dom.spinner.style.display = "inline-block";
            dom.error.innerText = '';

            // re-read the selection at click time, it may have changed
            const provider = getSelectedProvider();
            const model = getSelectedModel( provider );
            const apiKey = await getStoredKey( provider );
            if( AIProviders.PROVIDERS[ provider ].requiresKey && ! apiKey ) {
                dom.spinner.style.display = "none";
                dom.error.innerText = CONFIG.ERRORS.no_key;
                return;
            }

            dom.response.innerText = 'Asking ' + AIProviders.PROVIDERS[ provider ].label
                                    + ' to explain current flow...';

            // accept user question, otherwise use default prompt
            let prompt;
            if( dom.gptQuestion && dom.gptQuestion.value ) {
                prompt = dom.gptQuestion.value + '\\nFLOW: \\n';
            } else {
                prompt = `This flow: ${explanationLines.join( ' \\n ' )} ` + CONFIG.PROMPTS.default;
            }

            sendToAI( {
                currentURL: window.location.href
                , resultData: stepByStepMDTable
                , prompt: prompt
                , provider: provider
                , model: model
            }, apiKey );
        };
    }
}

// entry points:  set-key button and flow definition sent by the content script
dom.setKeyButton.addEventListener( 'click', function() { setKey(); } );

chrome.runtime.onMessage.addListener(
    function( request, sender, sendResponse ) {
        if( request.flowDefinition ) {
            // fresh parser per message so traversal state (index, forks) starts clean
            new FlowParser().parse( request.flowDefinition
                                    , request.subflowDefinitions, request.runStats );
        }
    }
);

// announce readiness to the embedding page so the content script can send the
// flow definition as soon as the listener above exists (no payload, so the
// wildcard target origin is safe)
if( window.parent !== window ) {
    window.parent.postMessage( "sfFlowExtensionPopupReady", "*" );
}

// function getCSVFromMarkDown( stepByStepMDTable ) {
//     let table = stepByStepMDTable
//                         .replaceAll( "|\n|-|-|-|-|-|-|\n|", "\"\n\"" )
//                         .replaceAll( "\n|", "\n\"" )
//                         .replaceAll( "|\n", "\"\n" )
//                         .replaceAll( "|", "\",\"" )
//                         .replaceAll( " / ", "\n" );
//     return table;
// }

const TABLE_HEADERS = [ 'Element name', 'Type', 'Parameters', 'Condition', 'Condition next element' ];

// appends text to a cell, rendering the " / " separators as line breaks;
// text nodes only, so flow labels/formulas cannot inject HTML
function appendMultilineText( container, text ) {
    String( text ).split( ' / ' ).forEach( ( line, index ) => {
        if( index > 0 ) {
            container.appendChild( document.createElement( 'br' ) );
        }
        container.appendChild( document.createTextNode( line ) );
    } );
}

// builds the flow table with DOM APIs from the structured rows;
// the markdown version is kept only for the download button and GPT
function createFlowTable( { flowName, flowDescription, processType, tableRows, actionMap, stepByStepMDTable, mermaidDiagram } ) {
    dom.flowTableContainer.style.display = 'block';
    dom.flowTableContainer.innerHTML = '';

    // heading with flow name, description and type
    let heading = document.createElement( 'div' );
    [ [ 'Flow:', flowName.replace( 'Flow:  ', '' ) ]
    , [ 'Description:', flowDescription ]
    , [ 'Type:', processType ] ].forEach( ( [ label, value ] ) => {
        let bold = document.createElement( 'span' );
        bold.style.fontWeight = 'bold';
        bold.innerText = label;
        heading.appendChild( bold );
        heading.appendChild( document.createTextNode( ' ' + ( value ?? '' ) ) );
        heading.appendChild( document.createElement( 'br' ) );
    } );
    dom.flowTableContainer.appendChild( heading );

    let table = document.createElement( 'table' );
    table.id = 'flowTable';

    // header row uses td cells to match the existing #flowTable TD styling
    let headerRow = table.createTHead().insertRow();
    TABLE_HEADERS.forEach( aHeader => {
        headerRow.insertCell().innerText = aHeader;
    } );

    let tbody = table.createTBody();
    tableRows.forEach( ( [ name, type, parameters, condition, nextName ] ) => {
        let row = tbody.insertRow();

        // first cell anchors the element so other rows can link to it
        let nameCell = row.insertCell();
        if( name ) {
            let spaceIndex = name.indexOf( ' ' );
            let anchorName = ( spaceIndex > 0 ? name.substring( 0, spaceIndex ) : name );
            let smallText = ( spaceIndex > 0 ? name.substring( spaceIndex ) : '' );
            let anchor = document.createElement( 'a' );
            anchor.id = anchorName;
            anchor.appendChild( document.createTextNode( anchorName ) );
            if( smallText ) {
                anchor.appendChild( document.createElement( 'br' ) );
                let small = document.createElement( 'span' );
                small.className = 'smallText';
                appendMultilineText( small, smallText );
                anchor.appendChild( small );
            }
            nameCell.appendChild( anchor );
        }

        appendMultilineText( row.insertCell(), type );
        appendMultilineText( row.insertCell(), parameters );
        appendMultilineText( row.insertCell(), condition );

        // last cell links to the target element's row when it exists
        let nextCell = row.insertCell();
        if( nextName && actionMap.has( nextName ) ) {
            let link = document.createElement( 'a' );
            link.href = '#' + nextName;
            link.innerText = nextName;
            nextCell.appendChild( link );
        } else if( nextName ) {
            appendMultilineText( nextCell, nextName );
        }
    } );

    dom.flowTableContainer.appendChild( table );

    // download buttons (handler properties so re-parsing replaces the
    // handlers instead of stacking duplicates)
    const plainFlowName = flowName.replace( 'Flow:  ', '' );

    // the markdown download embeds the diagram in a fenced block so GitHub
    // and VS Code render it; the AI input is not affected
    let downloadButton = document.getElementById( 'downloadButton' );
    downloadButton.style.display = 'block';
    downloadButton.onclick = () => {
        let markdown = stepByStepMDTable;
        if( mermaidDiagram ) {
            markdown += '\n```mermaid\n' + mermaidDiagram + '\n```\n';
        }
        downloadTextFile( plainFlowName + ' - flowDefinition.md', markdown, 'text/markdown' );
    };

    let downloadMermaidButton = document.getElementById( 'downloadMermaidButton' );
    downloadMermaidButton.style.display = 'block';
    downloadMermaidButton.onclick = () => {
        downloadTextFile( plainFlowName + ' - diagram.mmd', mermaidDiagram, 'text/plain' );
    };
}

function downloadTextFile( fileName, content, mimeType ) {
    const blob = new Blob( [ content ], { type: mimeType } );
    const url = URL.createObjectURL( blob );
    const anchor = document.createElement( 'a' );
    anchor.href = url;
    anchor.download = fileName;

    document.body.appendChild( anchor );
    anchor.click();
    document.body.removeChild( anchor );

    // release memory from file
    URL.revokeObjectURL( url );
}

// shows recent production failures/pauses of this flow under the explanation
function renderRunStats( runStats ) {
    let statsLine = document.getElementById( 'runStatsLine' );
    if( statsLine ) {
        statsLine.remove();
    }
    if( ! runStats || ( runStats.errorCount <= 0 && runStats.pausedCount <= 0 ) ) {
        return;
    }

    statsLine = document.createElement( 'div' );
    statsLine.id = 'runStatsLine';
    statsLine.style.color = 'darkred';
    statsLine.style.fontWeight = 'bold';
    const failedPart = ( runStats.errorCount > 0
        ? `failed ${ runStats.errorCount } time${ runStats.errorCount === 1 ? '' : 's' }` : '' );
    const pausedPart = ( runStats.pausedCount > 0
        ? `${ failedPart ? ' and ' : '' }has ${ runStats.pausedCount } paused interview${ runStats.pausedCount === 1 ? '' : 's' }` : '' );
    statsLine.textContent = `⚠ This flow ${ failedPart }${ pausedPart } in the last ${ runStats.days } days.`;
    dom.defaultExplainer.insertAdjacentElement( 'afterend', statsLine );
}

// shows the linter findings under the explanation; text nodes only
function renderLintResults( lintIssues ) {
    dom.lintResults.innerHTML = '';
    if( ! lintIssues || lintIssues.length === 0 ) {
        return;
    }

    let header = document.createElement( 'b' );
    header.textContent = 'Potential issues:';
    dom.lintResults.appendChild( header );

    lintIssues.forEach( anIssue => {
        let line = document.createElement( 'div' );
        line.style.color = ( anIssue.severity === 'warning' ? 'darkred' : 'dimgray' );
        line.textContent = ( anIssue.severity === 'warning' ? '⚠ ' : 'ℹ ' ) + anIssue.message;
        dom.lintResults.appendChild( line );
    } );
}

async function setKey() {
    dom.error.innerText = "";

    const provider = getSelectedProvider();
    const keys = await getProviderKeys();
    keys[ provider ] = dom.openAIKeyInput.value;
    await chrome.storage.local.set( { [ CONFIG.PROVIDER_KEYS_STORAGE ]: keys } );
    dom.error.innerText = AIProviders.PROVIDERS[ provider ].label
                        + " key saved locally (unencrypted, in this browser profile only). "
                        + "An AI explanation should appear here the next time you open this page.";
}

// keys are stored per provider:  { openai: '...', anthropic: '...', ... }
async function getProviderKeys() {
    let stored = await chrome.storage.local.get( CONFIG.PROVIDER_KEYS_STORAGE );
    let keys = stored[ CONFIG.PROVIDER_KEYS_STORAGE ] ?? {};

    // migrate the single OpenAI key saved by older versions
    if( ! keys.openai ) {
        const legacyKey = await getLegacyOpenAIKey();
        if( legacyKey ) {
            keys.openai = legacyKey;
            await chrome.storage.local.set( { [ CONFIG.PROVIDER_KEYS_STORAGE ]: keys } );
        }
    }
    return keys;
}

async function getStoredKey( provider ) {
    const keys = await getProviderKeys();
    return keys[ provider ] ?? null;
}

async function getLegacyOpenAIKey() {
    let stored = await chrome.storage.local.get( CONFIG.LEGACY_OPENAI_STORAGE_KEY );
    let key = stored[ CONFIG.LEGACY_OPENAI_STORAGE_KEY ];
    if( key ) {
        return key;
    }

    // even older versions kept the key in localStorage as TextEncoder bytes
    let legacyKey = localStorage.getItem( CONFIG.LEGACY_LOCALSTORAGE_KEY );
    if( ! legacyKey ) {
        return null;
    }
    let encodedKey = JSON.parse( legacyKey );
    let intArray = new Uint8Array( Object.values( encodedKey ) );
    key = new TextDecoder().decode( intArray );
    localStorage.removeItem( CONFIG.LEGACY_LOCALSTORAGE_KEY );
    return key;
}

function verySimpleHash( data ) {
    let hash = CONFIG.HASH.initial_value;
    for( let i = 0, len = data.length; i < len; i++ ) {
        let chr = data.charCodeAt( i );
        hash = ( hash << CONFIG.HASH.shift_amount ) - hash + chr;
        hash |= 0;
    }
    return hash;
}


// streams an explanation of the flow from the selected AI provider,
// updating the response area as text arrives
async function sendToAI( dataObject, apiKey ) {
    try {
        if( ! dataObject ) {
            dom.response.innerText = CONFIG.ERRORS.no_data_received;
            return;
        }

        let { currentURL, resultData, prompt, provider, model } = dataObject;

        if( ! resultData ) {
            dom.response.innerText = CONFIG.ERRORS.no_data_to_send;
            return;
        }

        // scan cache for clean up
        Object.keys( sessionStorage ).forEach( aKey => {
            let parsedCachedResponse = JSON.parse( sessionStorage.getItem( aKey ) );

            // if older than cache limit
            let cacheAgeMs = Math.abs( Date.now() - parsedCachedResponse?.cachedDate );
            if( cacheAgeMs >= CONFIG.CACHE_DURATION ) {
                sessionStorage.removeItem( aKey );
            }
        } );

        // attempt to retrieve previously stored response
        // (same key is used to store the response after the request below)
        const cacheKey = verySimpleHash( currentURL + provider + model + prompt
                    + resultData.substring( 0, CONFIG.DATA_LIMITS.cache_key_substring_length ) );
        const cachedResponse = sessionStorage.getItem( cacheKey );
        if( cachedResponse != null && cachedResponse != undefined ) {
            let parsedCachedResponse = JSON.parse( cachedResponse );

            // only use cached response if newer than cache limit
            let cacheAgeMs = Math.abs( Date.now() - parsedCachedResponse?.cachedDate );
            if( cacheAgeMs < CONFIG.CACHE_DURATION ) {
                dom.response.innerText = 'Cached response: ' + parsedCachedResponse.parsedResponse;
                convertResponseFromMarkdown();
                return;
            }
        }

        // normalize whitespace to save tokens; JSON.stringify in the provider
        // layer handles escaping
        let data = resultData.replaceAll( '\t', ' ' ).replaceAll( '   ', ' ' );

        // upgrade the smallest OpenAI model when the flow is large
        if( provider === 'openai' && model === 'gpt-5-nano'
                && data.length > CONFIG.DATA_LIMITS.model_upgrade_threshold ) {
            model = 'gpt-5-mini';
            console.log( `Data size (${ data.length } chars) requires upgrade to ${ model }` );
        }
        if( data.length > CONFIG.DATA_LIMITS.truncation_threshold ) {
            data = data.substring( 0, CONFIG.DATA_LIMITS.truncation_threshold );
            console.log( 'Data truncated to fit model context window' );
        }

        dom.response.innerText = `Using ${ model } (${ AIProviders.PROVIDERS[ provider ].label })...`;

        // stream the response, replacing the status message on the first delta
        let firstDelta = true;
        const fullText = await AIProviders.streamChat( {
            provider: provider
            , model: model
            , apiKey: apiKey
            , systemPrompt: CONFIG.PROMPTS.system
            , userText: `${ prompt } ${ data }`
            , temperature: CONFIG.GPT_PARAMS.temperature
            , onDelta: ( delta, textSoFar ) => {
                if( firstDelta ) {
                    firstDelta = false;
                    dom.spinner.style.display = "none";
                }
                dom.response.innerText = textSoFar;
            }
        } );

        if( ! fullText ) {
            dom.response.innerText = CONFIG.PROMPTS.no_response;
            return;
        }

        // store response in local cache under the same key used for the lookup above
        sessionStorage.setItem( cacheKey, JSON.stringify( {
                                        cachedDate: Date.now()
                                        , parsedResponse: fullText } )
                                );

        dom.response.innerText = fullText;
        convertResponseFromMarkdown();
    } catch( e ) {
        console.error( e );
        dom.response.innerText = e.message;
    } finally {
        dom.spinner.style.display = "none";
    }
}

function convertResponseFromMarkdown() {
    let response = dom.response.innerHTML;

    // Replace **text** with <b>text</b>
    response = response.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
    // Replace ### Heading with <h4>Heading</h4>
    response = response.replace(/### (.*?)(<br>|$)/gm, "<h4>$1</h4>$2");

    dom.response.innerHTML = response;
}