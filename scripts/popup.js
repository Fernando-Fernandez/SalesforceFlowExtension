// Configuration Constants
const CONFIG = {
    // Storage and caching
    // the OpenAI key is stored locally and unencrypted (an extension has no way
    // to keep a real secret client-side); the name says exactly that
    STORAGE_KEY: 'openAIKey',
    // older versions kept the key in localStorage as TextEncoder bytes
    LEGACY_STORAGE_KEY: 'hashedKey',
    CACHE_DURATION: 300000, // 5 minutes in milliseconds
    
    // GPT API Configuration
    GPT_PARAMS: {
        temperature: 0.3,
        top_p: 0.2,
        max_tokens: 2000,
        gpt5_max_tokens: 5000,
        frequency_penalty: 0,
        presence_penalty: 0,
        default_model: 'gpt-5-nano'
    },
    
    // Data size limits for model selection
    DATA_LIMITS: {
        model_upgrade_threshold: 16200,    // chars - upgrade from gpt-5-nano to gpt-4o
        truncation_threshold: 130872,      // chars - hard limit for any model
        cache_key_substring_length: 20     // chars - for cache key generation
    },
    
    // API endpoints
    ENDPOINTS: {
        gpt5: "https://api.openai.com/v1/responses",
        standard: "https://api.openai.com/v1/chat/completions"
    },
    
    // System prompts and messages
    PROMPTS: {
        default: `Your purpose is to help everyone quickly understand what this Salesforce flow does and how. Let us think step-by-step and briefly summarize the flow in the format: \\npurpose of the flow, the main objects queried/inserted/updated, dependencies (labels, hard-coded ids, values, emails, names, etc) from outside the flow, the main conditions it evaluates, and any potential or evident issues.\\nFLOW: \\n`,
        system: 'You are an expert at troubleshooting and explaining Salesforce flows.',
        no_response: 'No response content received from GPT-5 model',
        response_truncated: ' (RESPONSE TRUNCATED DUE TO LIMIT)'
    },
    
    // Error messages
    ERRORS: {
        no_key: "Please set an OpenAI key to get an AI explanation.",
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
    
    // Model configurations
    MODELS: {
        supported: ['gpt-4o', 'gpt-4.1', 'gpt-5-nano', 'gpt-5-mini'],
        gpt5_temperature: 1  // GPT-5 models only support temperature = 1
    },
    
    // Hash function constants
    HASH: {
        shift_amount: 5,
        initial_value: 0
    },
    
    // DOM and formatting
    UI: {
        gpt5_response_path: {
            output_index: 1,
            content_index: 0
        },
        gpt4_response_path: {
            choice_index: 0
        }
    }
};

// All constants are now centralized in CONFIG object above

const dom = {
    setKeyButton: document.getElementById('setKey'),
    defaultExplainer: document.getElementById('defaultExplainer'),
    response: document.getElementById('response'),
    error: document.getElementById('error'),
    spinner: document.getElementById('spinner'),
    gptDialogContainer: document.getElementById('gptDialogContainer'),
    gptButton: document.getElementById('gptButton'),
    gptModelSelection: document.getElementById('gptModelSelection'),
    customModelName: document.getElementById('custom-model-name'),
    customModelInput: document.querySelector('.custom-model-input'),
    gptQuestion: document.getElementById('gptQuestion'),
    flowTableContainer: document.getElementById('flowTableContainer'),
    downloadButton: document.getElementById('downloadButton'),
    openAIKeyInput: document.querySelector('input#openAIKey')
};

class FlowParser {
    constructor() {
        this.index = CONFIG.HASH.initial_value;
        this.forksArray = [];
    }

    parseValue( rightValue ) {
        let theValue = rightValue?.apexValue ??
                        rightValue?.booleanValue ??
                        rightValue?.dateTimeValue ??
                        rightValue?.dateValue ??
                        rightValue?.elementReference ??
                        rightValue?.numberValue ??
                        rightValue?.sobjectValue ??
                        rightValue?.stringValue ?? 'null';
        return theValue;
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

    assignIndexToElements( actionMap, currentElement, parentBranch, conditionLabel ) {
        // assign order number to current element
        this.index++;
        currentElement.index = this.index;
        // console.log( this.index, currentElement.name );

        // link element to parent branch it inherited
        // so all elements will belong to a parent branch
        let currentParentBranch = parentBranch;
        let currentConditionLabel = conditionLabel;
        currentElement.parentBranch = currentParentBranch;
        currentElement.conditionLabel = currentConditionLabel;

        // check all branches flowing from the current element
        let nbrBranches = currentElement.branchArray.length;
        if( nbrBranches > 1 ) {
            // store current element if 2+ branches flow out of it
            this.forksArray.push( currentElement );

            // if current element is a branch, it will be
            // the parent branch of the next elements
            currentParentBranch = currentElement;
        }
        for( let i = 0; i < nbrBranches; i++ ) {
            if( nbrBranches > 1 ) {
                currentConditionLabel = currentElement.branchLabelArray[ i ];
            }

            // check next element in each branch
            let aBranch = currentElement.branchArray[ i ];
            if( aBranch == null || aBranch == undefined ) {
                continue;
            }

            // if element has index, then it has already been visited so skip it
            let branchNextElement = actionMap.get( aBranch );
            if( branchNextElement.index ) {
                continue;
            }

            // continue in this branch, assigning index to elements,
            // recursively until all elements have indexes
            this.assignIndexToElements( actionMap, branchNextElement
                                , currentParentBranch, currentConditionLabel );
        }
    }

    async parse( flowDefinition ) {
        // console.log( flowDefinition );

        let flowName = 'Flow:  ' + flowDefinition.label;
        let flowDescription = flowDefinition.description;


        // identify initial step
        let startElement = flowDefinition.startElementReference ?? flowDefinition.start?.connector?.targetReference;

        let firstElement = flowDefinition.start;
        if( ! firstElement ) {
            firstElement = { connector: { targetReference: startElement } };
        }
        firstElement.name = 'Start';
        firstElement.fullDescription = firstElement.name;
        firstElement.type = CONFIG.FLOW.element_types.start;
        firstElement.branchArray = [];
        firstElement.parameters = this.getParameters( firstElement );

        if( firstElement.connector?.targetReference ) {
            firstElement.branchArray.push( firstElement.connector?.targetReference );
        }

        firstElement.scheduledPaths?.forEach( s => {
            firstElement.branchArray.push( s.connector?.targetReference );
        } );

        // start map of actions indexed by name with the starting element
        let actionMap = new Map();
        actionMap.set( firstElement.name, firstElement );

        // collect nodes in the flow metadata and index them in a map
        const definitionMap = new Map( [
            [ 'recordLookups', flowDefinition.recordLookups ]
            , [ 'recordCreates', flowDefinition.recordCreates ]
            , [ 'recordUpdates', flowDefinition.recordUpdates ]
            , [ 'recordDeletes', flowDefinition.recordDeletes ]
            , [ 'recordRollbacks', flowDefinition.recordRollbacks ]
            , [ 'assignments', flowDefinition.assignments ]
            , [ 'decisions', flowDefinition.decisions ]
            , [ 'screens', flowDefinition.screens ]
            , [ 'loops', flowDefinition.loops ]
            , [ 'steps', flowDefinition.steps ]
            , [ 'subflows', flowDefinition.subflows ]
            , [ 'actionCalls', flowDefinition.actionCalls ]
            , [ 'apexPluginCalls', flowDefinition.apexPluginCalls ]
            , [ 'collectionProcessors', flowDefinition.collectionProcessors ]
            , [ 'transforms', flowDefinition.transforms ]
            , [ 'waits', flowDefinition.waits ]
            , [ 'dynamicChoiceSets', flowDefinition.dynamicChoiceSets ]
            , [ 'variables', flowDefinition.variables ]
            , [ 'textTemplates', flowDefinition.textTemplates ]
            , [ 'formulas', flowDefinition.formulas ]
            , [ 'constants', flowDefinition.constants ]
            , [ 'choices', flowDefinition.choices ]
        ] );

        // reorganize flow elements into a single map indexed by name
        for( const [ typeName, array ] of definitionMap ) {
            if( ! array || array.length <= 0 ) {
                continue;
            }
            for( let i = 0; i < array.length; i++ ) {
                let element = array[ i ];
                element.type = typeName.substring( 0, typeName.length - 1 );

                element.fullDescription = element.name
                                        + this.parenthesis( element.label )
                                        + ( element.description ? ' / ' + element.description : '' );

                element.defaultCondition = ( element.type == 'variable'
                                            || element.type == 'formula'
                                            || element.type == 'textTemplate' ? '' :
                            ( element.type == 'decision' ? element.defaultConnectorLabel : 'success' ) );

                element.nextElement = ( element.connector?.targetReference != undefined ?
                                            element.connector?.targetReference :
                                            element.defaultConnector?.targetReference );

                // list the branches of execution
                element.branchArray = [];
                element.branchLabelArray = [];
                if( element.nextElement != undefined ) {
                    element.branchArray.push( element.nextElement );
                    element.branchLabelArray.push( `${element.label} is true` );
                }

                if( element.faultConnector?.targetReference ) {
                    element.faultElement = element.faultConnector?.targetReference;
                    element.branchArray.push( element.faultElement );
                    element.branchLabelArray.push( `fails on ${element.label}` );
                }

                if( element.type == 'loop' ) {
                    element.branchArray.push( element.nextValueConnector?.targetReference );
                    element.branchLabelArray.push( `next value on ${element.label}` );
                    element.branchArray.push( element.noMoreValuesConnector?.targetReference );
                    element.branchLabelArray.push( `no more values on ${element.label}` );
                }

                if( element.type == 'wait' ) {
                    element.waitEvents?.forEach( w => {
                        element.branchArray.push( w.connector?.targetReference );
                        element.branchLabelArray.push( `wait event ${w.label}` );
                    } );
                }

                if( element.rules != undefined && element.rules.length > 0 ) {
                    element.rules?.forEach( r => {
                        element.branchArray.push( r.connector?.targetReference );
                        element.branchLabelArray.push( `condition ${r.label} on ${element.label}` );
                    } );
                }

                // create explanation containing parameters of the element
                element.parameters = this.getParameters( element );

                actionMap.set( element.name, element );
            }
        }

        // assign sequential index to elements, following all their branches recursively
        this.index = 0;
        let currentElement = actionMap.get( firstElement.name );
        this.assignIndexToElements( actionMap, currentElement, currentElement, 'start' );

        // sort elements by index so that table will be ordered by execution
        actionMap = new Map( [ ...actionMap.entries() ].sort( ( a, b ) => a[ 1 ].index - b[ 1 ].index ) );

        // TODO:  generate explanation by associating outcomes with decisions/branches
        let explanation = '';
        for( const [ identifier, action ] of actionMap ) {
            let elementType = action.type;
            let parentBranch = action.parentBranch;
            let parentBranchAction = '';
            if( parentBranch != undefined ) {
                parentBranchAction = ( parentBranch.type == 'decision' ? 'after checking' : '' )
                                    + ( parentBranch.type == 'start' ? 'at the' : '' )
                                    + ( parentBranch.type == 'loop' ? 'when loop has' : '' )
                                    + ( parentBranch.type == 'actionCall' ? 'after calling action' : '' )
                                    + ( parentBranch.type == 'wait' ? 'after event' : '' );
            }
            let conditionExplained = `${parentBranchAction ?? ''} ${action.conditionLabel ?? ''}`;

            if( elementType === 'recordCreate'
                    || elementType === 'recordUpdate'
                    || elementType === 'recordDelete'
                    || elementType === 'recordRollback' ) {
                let recordAction = elementType.replace( 'record', '' ).toLowerCase() + 's';
                explanation += ` \n ${recordAction} ${action.object ?? action.inputReference} ${conditionExplained}`;
            }
            if( elementType === 'recordLookup' ) {
                explanation += ` \n queries ${action.object} ${conditionExplained}`;
            }
            // if( elementType === 'assignment' ) {
            //     explanation += ` \n assigns ${action.label} ${conditionExplained}`;
            // }
            if( elementType === 'actionCall' ) {
                explanation += ` \n calls action ${action.label} ${conditionExplained}`;
            }
            if( elementType === 'screen' ) {
                explanation += ` \n prompts screen ${action.label} ${conditionExplained}`;
            }

            if( elementType == 'transform' ) {
                explanation += ` \n transforms ${ action.objectType ?? action.dataType }`;
            }

            // let parameters = action.parameters;
        }
        // console.log( explanation );

        // display default explanation
        dom.defaultExplainer.innerHTML = "";
        let explanationHTML = document.createElement( 'span' );
        explanationHTML.innerHTML = '<b>This flow:  </b>' + explanation.replaceAll( /\n/g, '<br />' );
        dom.defaultExplainer.appendChild( explanationHTML );

        // generate itemized description of the flow:  markdown for download/GPT,
        // and the same rows rendered as a DOM table
        let tableRows = this.getTableRows( actionMap );
        let stepByStepMDTable = `${flowName}\nDescription: ${flowDescription}\nType: ${flowDefinition.processType}\n\n`
                            + '|Element name|Type|Parameters|Condition|Condition next element|\n'
                            + '|-|-|-|-|-|\n'
                            + this.getMDTableRows( tableRows );

        createFlowTable( { flowName, flowDescription
                        , processType: flowDefinition.processType
                        , tableRows, actionMap, stepByStepMDTable } );

        // let csvFlow = getCSVFromMarkDown( stepByStepMDTable );
        // console.log( csvFlow );

        // prepare to call OpenAI
        dom.response.innerText = '';

        let storedKey = await getStoredKey();
        if( ! storedKey ) {
            dom.spinner.style.display = "none";
            dom.response.innerText = '';
            dom.error.innerText = CONFIG.ERRORS.no_key;
            return;
        }

    // since we have OpenAI key, show the dialog container
    let gptDialogContainer = document.getElementById( 'gptDialogContainer' );
    gptDialogContainer.style.display = 'block';
    let gptButton = document.getElementById( 'gptButton' );
    // Load saved model preference or default to gpt-4o
    let savedModel = localStorage.getItem('selectedGPTModel') || CONFIG.MODELS.supported[0];
    
    let gptSelection = document.getElementById( 'gptModelSelection' );
    gptSelection.style.display = 'block';
    
    // Update radio button selection based on saved model
    let radioButtons = gptSelection.querySelectorAll('input[name="gpt-version"]');
    let customInput = document.getElementById('custom-model-name');
    let customModelInput = gptSelection.querySelector('.custom-model-input');
    
    radioButtons.forEach(radio => {
        if (radio.value === savedModel) {
            radio.checked = true;
        } else if (radio.value === 'custom' && savedModel && !CONFIG.MODELS.supported.includes(savedModel)) {
            radio.checked = true;
            customModelInput.style.display = 'block';
            customInput.value = savedModel;
        }
    });
    
    // Add event handlers to save model preference and handle custom input
    // (assigned as properties, not addEventListener, so that re-running parseFlow
    // replaces the handlers instead of stacking duplicates)
    gptSelection.onchange = (e) => {
        if (e.target.name === 'gpt-version') {
            const customModelInput = gptSelection.querySelector('.custom-model-input');
            const customModelName = gptSelection.querySelector('#custom-model-name');
            
            if (e.target.value === 'custom') {
                customModelInput.style.display = 'block';
                customModelName.focus();
            } else {
                customModelInput.style.display = 'none';
                localStorage.setItem('selectedGPTModel', e.target.value);
            }
        }
    };

    // Handle custom model name input
    gptSelection.oninput = (e) => {
        if (e.target.id === 'custom-model-name') {
            const customRadios = gptSelection.querySelectorAll('input[value="custom"]');
            const customRadio = customRadios[0];
            if (customRadio && customRadio.checked && e.target.value.trim()) {
                localStorage.setItem('selectedGPTModel', e.target.value.trim());
            }
        }
    };

    // Model selection is already in the HTML, no need to append

    // make button call GPT
    // (handler property so the latest flow's data replaces any previous handler)
    gptButton.onclick = () => {

            dom.spinner.style.display = "inline-block";

            let openAIKey = storedKey;
            if( ! openAIKey ) {
                return;
            }

            dom.response.innerText = 'Asking GPT to explain current flow...';

            // accept user question, otherwise use default prompt
            let prompt;
            if( dom.gptQuestion && dom.gptQuestion.value ) {
                prompt = dom.gptQuestion.value + '\\nFLOW: \\n';
            } else {
                prompt = `This flow: ${explanation.replaceAll( /\n/g, '\\n' )} ` + CONFIG.PROMPTS.default;
            }

            let gptModelSelection = document.querySelector( 'input[name="gpt-version"]:checked' ).value;
            let gptModel = gptModelSelection;

            // If custom model is selected, get the actual model name from the input field
            if (gptModelSelection === 'custom') {
                const customModelName = dom.customModelName.value.trim();
                gptModel = customModelName || 'gpt-4o'; // fallback to gpt-4o if empty
            }

        let dataObject = { 
            currentURL: window.location.href, 
            resultData: stepByStepMDTable, 
            // resultData: csvFlow,
            prompt: prompt,
            gptModel: gptModel
        };
        sendToGPT( dataObject, openAIKey );
    };
    }
}

// entry points:  set-key button and flow definition sent by the content script
dom.setKeyButton.addEventListener( 'click', function() { setKey(); } );

chrome.runtime.onMessage.addListener(
    function( request, sender, sendResponse ) {
        if( request.flowDefinition ) {
            // fresh parser per message so traversal state (index, forks) starts clean
            new FlowParser().parse( request.flowDefinition );
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
function createFlowTable( { flowName, flowDescription, processType, tableRows, actionMap, stepByStepMDTable } ) {
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

    // use existing download button
    // (handler property so re-parsing replaces the handler instead of stacking duplicates)
    let downloadButton = document.getElementById( 'downloadButton' );
    downloadButton.style.display = 'block';
    downloadButton.onclick = () => {
        // create blob with markdown for download
        let markDownDescription = new Blob( [stepByStepMDTable], { type: 'text/markdown' } );
        const url = URL.createObjectURL( markDownDescription );
        const anchor = document.createElement( 'a' );
        anchor.href = url;
        anchor.download = flowName.replace( 'Flow:  ', '' ) + ' - flowDefinition.md';
    
        // Append to the DOM
        document.body.appendChild( anchor );
    
        // Trigger `click` event
        anchor.click();
    
        // Remove element from DOM
        document.body.removeChild( anchor );

        // release memory from file
        URL.revokeObjectURL( url );
    };

    // table and button are already in the document, no need to append
}

async function setKey() {
    dom.error.innerText = "";

    await chrome.storage.local.set( { [ CONFIG.STORAGE_KEY ]: dom.openAIKeyInput.value } );
    dom.error.innerText = "Key saved locally (unencrypted, in this browser profile only). "
                        + "An AI explanation should appear here the next time you open this page.";
}

async function getStoredKey() {
    let stored = await chrome.storage.local.get( CONFIG.STORAGE_KEY );
    let key = stored[ CONFIG.STORAGE_KEY ];
    if( key ) {
        return key;
    }

    // migrate a key saved by older versions in localStorage as encoded bytes
    let legacyKey = localStorage.getItem( CONFIG.LEGACY_STORAGE_KEY );
    if( ! legacyKey ) {
        return null;
    }
    let encodedKey = JSON.parse( legacyKey );
    let intArray = new Uint8Array( Object.values( encodedKey ) );
    key = new TextDecoder().decode( intArray );
    await chrome.storage.local.set( { [ CONFIG.STORAGE_KEY ]: key } );
    localStorage.removeItem( CONFIG.LEGACY_STORAGE_KEY );
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

function sendToGPT( dataObject, openAIKey ) {
    // const errorSpan = document.getElementById( "error" );
    try {
        if( ! dataObject ) {
            dom.response.innerText = CONFIG.ERRORS.no_data_received;
            dom.spinner.style.display = "none";
            return;
        }

        let { currentURL, resultData, prompt, gptModel } = dataObject;

        if( ! resultData ) {
            dom.response.innerText = CONFIG.ERRORS.no_data_to_send;
            dom.spinner.style.display = "none";
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
        // (same key is used to store the response after the fetch below)
        const cacheKey = verySimpleHash( currentURL + prompt + resultData.substring( 0, CONFIG.DATA_LIMITS.cache_key_substring_length ) );
        const cachedResponse = sessionStorage.getItem( cacheKey );
        if( cachedResponse != null && cachedResponse != undefined ) {
            let parsedCachedResponse = JSON.parse( cachedResponse );

            // only use cached response if newer than cache limit
            let cacheAgeMs = Math.abs( Date.now() - parsedCachedResponse?.cachedDate );
            if( cacheAgeMs < CONFIG.CACHE_DURATION ) {
                // display response 
                dom.response.innerText = 'OpenAI (cached response): ' + parsedCachedResponse.parsedResponse;
                dom.spinner.style.display = "none";
                return;
            }
        }

        // use parameters recommended for Code Comment Generation
        let temperature = CONFIG.GPT_PARAMS.temperature;
        let top_p = CONFIG.GPT_PARAMS.top_p;
        let max_tokens = CONFIG.GPT_PARAMS.max_tokens;
        let frequency_penalty = CONFIG.GPT_PARAMS.frequency_penalty;
        let presence_penalty = CONFIG.GPT_PARAMS.presence_penalty;
        let model = ( gptModel ? gptModel : CONFIG.GPT_PARAMS.default_model );
        let systemPrompt = CONFIG.PROMPTS.system;

        // normalize whitespace to save tokens; JSON.stringify below handles escaping,
        // so quotes/backslashes/newlines in the flow data are passed through intact
        let data = resultData.replaceAll( '\t', ' ' ).replaceAll( '   ', ' ' );

        // check size of data and select a bigger model as needed
        let originalModel = model;
        let modelUpgraded = false;
        
        if( data.length > CONFIG.DATA_LIMITS.model_upgrade_threshold ) {
            // Only upgrade to gpt-4o if user selected gpt-5-nano but data is too large
            if( model === 'gpt-5-nano' ) {
                model = 'gpt-4o';
                modelUpgraded = true;
                console.log(`Data size (${data.length} chars) requires upgrade from ${originalModel} to ${model}`);
            }
            
            // truncate data as needed for any model
            if( data.length > CONFIG.DATA_LIMITS.truncation_threshold ) {
                data = data.substring( 0, CONFIG.DATA_LIMITS.truncation_threshold );
                console.log('Data truncated to fit model context window');
            }
        }
        
        // Update status message to show model being used
        let statusMessage = modelUpgraded ? 
            `Using ${model} (auto-upgraded from ${originalModel} due to data size)...` :
            `Using ${model}...`;
        dom.response.innerText = statusMessage;

        // Determine if model is GPT-5 and adjust parameters accordingly
        let isMoreRecentModel = model.toLowerCase().startsWith('gpt-5')
                    || model.toLowerCase().includes('o4-mini');
        let tokenLimitParam = isMoreRecentModel ? 'max_output_tokens' : 'max_tokens';
        let modelTemperature = isMoreRecentModel ? CONFIG.MODELS.gpt5_temperature : temperature; // GPT-5 models only support temperature = 1
        
        // Build different payload structures for GPT-5 vs other models
        let payloadParams;
        let url;
        
        if (isMoreRecentModel) {
            // GPT-5 uses different endpoint and payload structure
            url = CONFIG.ENDPOINTS.gpt5;
            max_tokens = CONFIG.GPT_PARAMS.gpt5_max_tokens;
            let fullInput = `${systemPrompt}\n\n${prompt} ${data}`;
            payloadParams = {
                model: model,
                input: fullInput,
                temperature: modelTemperature,
                [tokenLimitParam]: max_tokens
            };
        } else {
            // Standard chat completions for other models
            url = CONFIG.ENDPOINTS.standard;
            payloadParams = {
                model: model,
                messages: [
                    { role: "system", content: [ { type: "text", text: systemPrompt } ] },
                    { role: "user", content: [ { type: "text", text: `${prompt} ${data}` } ] }
                ],
                temperature: modelTemperature,
                [tokenLimitParam]: max_tokens,
                top_p: top_p,
                frequency_penalty: frequency_penalty,
                presence_penalty: presence_penalty
            };
        }
        
        let payload = JSON.stringify(payloadParams);

        console.log( payload );

        // prepare and send request
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + openAIKey
            },
            body: payload
        })
        .then(response => response.text())
        .then(open_ai_response => {

            let parsedResponse = JSON.parse( open_ai_response );
            console.log( parsedResponse );

            if( parsedResponse.error ) {
                parsedResponse = parsedResponse.error.message + ` (${parsedResponse.error.type})`;
            } else if (isMoreRecentModel) {
                // Check finish reason for GPT-5 with proper guard clauses
                let responseText = null;
                
                // Safely navigate the response structure
                if (parsedResponse.output && 
                    Array.isArray(parsedResponse.output) && 
                    parsedResponse.output[CONFIG.UI.gpt5_response_path.output_index] && 
                    parsedResponse.output[CONFIG.UI.gpt5_response_path.output_index].content && 
                    Array.isArray(parsedResponse.output[CONFIG.UI.gpt5_response_path.output_index].content) && 
                    parsedResponse.output[CONFIG.UI.gpt5_response_path.output_index].content[CONFIG.UI.gpt5_response_path.content_index] && 
                    parsedResponse.output[CONFIG.UI.gpt5_response_path.output_index].content[CONFIG.UI.gpt5_response_path.content_index].text) {
                    responseText = parsedResponse.output[CONFIG.UI.gpt5_response_path.output_index].content[CONFIG.UI.gpt5_response_path.content_index].text;
                }
                
                console.log(responseText);
                
                if (!responseText) {
                    responseText = CONFIG.PROMPTS.no_response;
                } else {
                    // Check for truncation only if we have valid response text
                    if (parsedResponse.status === 'incomplete' && parsedResponse.incomplete_details?.reason === 'max_output_tokens') {
                        responseText += CONFIG.PROMPTS.response_truncated;
                    }
                }
                
                parsedResponse = responseText;
            } else {
                // Standard GPT-4 and earlier response structure
                let finishReason = parsedResponse.choices[ CONFIG.UI.gpt4_response_path.choice_index ].finish_reason;
                parsedResponse = parsedResponse.choices[ CONFIG.UI.gpt4_response_path.choice_index ].message.content;
                // The token count of prompt + max_tokens will not exceed the model's context length. 
                if( finishReason == 'length' ) {
                    parsedResponse = parsedResponse + CONFIG.PROMPTS.response_truncated;
                }
            }

            // store response in local cache under the same key used for the lookup above
            sessionStorage.setItem( cacheKey, JSON.stringify( {
                                            cachedDate: Date.now() 
                                            , parsedResponse } ) 
                                    );

            // display response 
            dom.response.innerText = parsedResponse;
            convertResponseFromMarkdown();
            dom.spinner.style.display = "none";
        })
        .catch(error => {
            console.error('Fetch error:', error);
            dom.response.innerText = error.message;
            dom.spinner.style.display = "none";
        });
    } catch( e ) {
        console.error(e);
        dom.response.innerText = e.message;
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