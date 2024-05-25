const KEY = 'hashedKey';
const DEFAULT_PROMPT = `Your purpose is to help everyone quickly understand \
what this Salesforce flow does and how.\
Let us think step-by-step and briefly summarize the flow in the format: \
purpose of the flow, the main objects queried/inserted/updated, \
dependencies (labels, hard-coded ids, values, emails, names, etc) from outside the flow, \
the main conditions it evaluates, and any potential or evident issues.\
\\nFLOW: \\n`;
const ELEMENT_TYPE_START = 'start';

chrome.runtime.onMessage.addListener(
    function( request, sender, sendResponse ) {
        if( request.flowDefinition ) {
            parseFlow( request.flowDefinition );
        }
    }
);

document.getElementById( "setKey" ).addEventListener( 'click', function() { setKey(); } );

function parseValue( rightValue ) {
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

function convertOperator( operator ) {
    if( operator == undefined ) {
        return '=';
    }
    return ( operator.includes( 'Not' ) ? 'NOT ' : '' ) 
        + ( operator.includes( 'EqualTo' ) || operator.includes( 'Assign' ) ? '=' : operator );
}

function getFilters( action ) {
    let parameters = '';
    parameters += ( action.filters?.length > 0 ? ` / Filters: ` : '');
    parameters += getFieldOperations( action.filters );
    return parameters;
}

function addInputOutputParameters( action ) {
    let parameters = '';
    parameters += ( action.inputAssignments?.length > 0 ? ` / Input assignments: ` : '' );
    action.inputAssignments?.forEach(i => {
        parameters += ` / ${i.field} = ${parseValue(i.value)}`;
    });
    parameters += ( action.outputAssignments?.length > 0 ? ` / Output assignments: ` : '' );
    action.outputAssignments?.forEach(i => {
        parameters += ` / ${i.field} = ${parseValue(i.value)}`;
    });

    parameters += getFilters( action );
    
    parameters += ( action.inputParameters?.length > 0 ? ` / Input parameters: ` : '' );
    action.inputParameters?.forEach(i => {
        parameters += ` / ${i.name} = ${parseValue(i.value)}`;
    });
    parameters += ( action.outputParameters?.length > 0 ? ` / Output parameters: ` : '' );
    action.outputParameters?.forEach(o => {
        parameters += ` / ${o.name} = ${parseValue(o.value)}`;
    });
    return parameters;
}

function parenthesis( value ) {
    return ( value ? ' (' + value + ')' : '' );
}

function getFieldOperations( fieldOperations ) {
    let parameters = '';
    fieldOperations?.forEach( f => {
        let field = f.field ?? f.assignToReference ?? f.leftValueReference;
        let operator = convertOperator(f.operator);
        let value = f.value ?? f.rightValue;
        parameters += ` / ${field} ${operator} ${parseValue( value )}`;
    });
    return parameters;
}

function getStoreOutput( action ) {
    if( action.storeOutputAutomatically ) {
        return ` / Store output? = ${action.storeOutputAutomatically}`;
    }
    return '';
}

function getParameters( action ) {
    let parameters = '';
    let elementType = action.type;

    if( elementType == ELEMENT_TYPE_START ) {
        let type = action.triggerType + ' ' + action.recordTriggerType;
        parameters += `Type = ${type}`;
        parameters += ` / Object = ${action.object}`;
        parameters += ` / Requires Record Changed To Meet Criteria = ${action.doesRequireRecordChangedToMeetCriteria}`;
        parameters += getFilters( action );
        if( action.filterFormula ) {
            parameters += ` / Filter formula = ${action.filterFormula}`;
        }
        if( action.schedule ) {
            parameters += ` / Schedule = ${action.schedule.startDate} ${action.schedule.startTime} ${action.schedule.frequency}`;
        }
    }

    if( elementType == 'assignment' ) {
        parameters += getFieldOperations( action.assignmentItems );
    }

    if( elementType == 'variable' ) {
        let type = ( action.isCollection ? 'Collection of ' : '' ) + action.dataType;
        parameters += `Type = ${type}`;
        parameters += ` / Input = ${action.isInput}`;
        parameters += ` / Output = ${action.isOutput}`;
        parameters += ` / Value = ${parseValue( action.value )}`;
    }

    if( elementType == 'constant' ) {
        parameters += `Type = ${action.dataType}`;
        parameters += ` / Value = ${parseValue( action.value )}`;
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
        parameters += ` / Value = ${parseValue( action.value )}`;
    }

    if( elementType == 'collectionProcessor' ) {
        parameters += `Collection = ${action.collectionReference}`;
        parameters += ` / Processing type = ${action.collectionProcessorType}`;
        parameters += ` / Assign next value to = ${action.assignNextValueToReference}`;
        parameters += ` / Filter formula = ${action.formula}`;
        parameters += ` / Output object = ${action.outputSObjectType}`;
        parameters += getFieldOperations( action.conditions );
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
        parameters += getStoreOutput( action );
        parameters += addInputOutputParameters( action );
    }

    if( elementType == 'apexPluginCalls' ) {
        parameters += `Apex class = ${action.apexClass}`;
        parameters += addInputOutputParameters( action );
    }

    if( elementType == 'subflows' ) {
        parameters += `Flow = ${action.flowName}`;
        parameters += getStoreOutput( action );
        parameters += addInputOutputParameters( action );
    }

    if( elementType == 'recordLookup' ) {
        parameters += `Object = ${action.object}`;
        parameters += ` / Assign null if no records? = ${action.assignNullValuesIfNoRecordsFound}`;
        parameters += ` / First record only? = ${action.getFirstRecordOnly}`;
        parameters += getStoreOutput( action );
        parameters += getFieldOperations( action.filters );
    }

    if( elementType == 'recordCreate' ) {
        parameters += `Object = ${action.object}`;
        parameters += ` / Assign id? = ${action.assignRecordIdToReference}`;
        parameters += getStoreOutput( action );
        parameters += addInputOutputParameters( action );
    }

    if( elementType == 'recordUpdate' ) {
        parameters += `Reference = ${action.inputReference}`;
        if( action.object ) {
            parameters += ` / Object = ${action.object}`;
        }
        parameters += addInputOutputParameters( action );
        parameters += getFieldOperations( action.filters );
    }

    if( elementType == 'recordDelete' ) {
        parameters += `Reference = ${action.inputReference}`;
        if( action.object ) {
            parameters += ` / Object = ${action.object}`;
        }
        parameters += getFieldOperations( action.filters );
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

    if( parameters.indexOf( ' / ' ) == 0 ) {
        parameters = parameters.substring( 2 );
    }

    return parameters;
}

function getMDTableRows( actionMap ) {
    let stepByStepMDTable = '';
    for( const [ identifier, action ] of actionMap ) {
        let elementType = action.type;
        let faultElement = action.faultElement;
        let parameters = action.parameters;

        let nextElement = action.connector?.targetReference;
        if( nextElement == undefined ) {
            nextElement = action.defaultConnector?.targetReference;
        }
        if( nextElement == undefined ) {
            nextElement = '';
        }

        let prefix = `|${action.fullDescription}|${elementType}|${ parameters }|`;

        // handle elements with multiple rows
        if( elementType == ELEMENT_TYPE_START ) {
            stepByStepMDTable += `${prefix}Runs immediately|${ nextElement }|\n`;
            prefix = '||||';
            if( action.scheduledPaths ) {
                action.scheduledPaths.forEach( s => {
                    let nextElement = s.connector?.targetReference;

                    let condition = `${s.label} / ${s.offsetNumber} ${s.offsetUnit} `
                                + `${( s.timeSource == 'RecordField' ? s.recordField : 'RecordTriggerEvent' )}`;
                    stepByStepMDTable += `${prefix}${condition}|${nextElement}|\n`;
                } );
            }
            continue;
        }

        if( elementType == 'decision' ) {
            nextElement = action.defaultConnector?.targetReference;
            stepByStepMDTable += `${prefix}${action.defaultCondition}|${ nextElement }|\n`;
            prefix = '||||';
        }

        if( elementType == 'loop' ) {
            stepByStepMDTable += `${prefix}Next value|${ action.nextValueConnector?.targetReference }|\n`;
            prefix = '||||';
            stepByStepMDTable += `${prefix}No more values|${ action.noMoreValuesConnector?.targetReference }|\n`;

            continue;
        }

        if( elementType == 'wait' ) {
            let elementCondition = '';
            action.waitEvents?.forEach( w => {
                elementCondition += `${w.label}`;
                elementCondition += ` \ Type: ${w.eventType}`;
                elementCondition += getFieldOperations( w.conditions );
                nextElement = w.connector?.targetReference;
                stepByStepMDTable += `${prefix}${elementCondition}|${ nextElement }|\n`;
                prefix = '||||';
            } );
            continue;
        }

        // check for rule conditions
        if( action.rules == undefined || action.rules.length == 0 ) {
            if( nextElement && action.defaultConnectorLabel ) {
                nextElement += ' ' + parenthesis( action.defaultConnectorLabel );
            }
            // if no conditions, just add the default condition
            stepByStepMDTable += `${prefix}${action.defaultCondition}|${ nextElement }|\n`;

            if( faultElement ) {
                prefix = '||||';
                stepByStepMDTable += `${prefix}fault|${ faultElement }|\n`;
            }

        } else {
            // add row for each rule/branch
            for( let r = 0; r < action.rules.length; r++ ) {
                let rule = action.rules[ r ];
                let elementCondition = rule.name + parenthesis( rule.label );
                let conditionNextElement = rule.connector?.targetReference;
                // add expression for each condition within the rule
                elementCondition += getFieldOperations( rule.conditions );

                stepByStepMDTable += `${prefix}${ elementCondition }|${ conditionNextElement }|\n`;
                prefix = '||||';
            }
        }
    }

    return stepByStepMDTable;
}

function parseFlow( flowDefinition ) {
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
    firstElement.type = ELEMENT_TYPE_START;
    firstElement.branchArray = [];
    firstElement.parameters = getParameters( firstElement );

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
                                    + parenthesis( element.label ) 
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
            element.parameters = getParameters( element );

            actionMap.set( element.name, element );
        }
    }

    // assign sequential index to elements, following all their branches recursively
    index = 0;
    let currentElement = actionMap.get( firstElement.name );
    assignIndexToElements( actionMap, currentElement, currentElement, 'start' );

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

        // let parameters = action.parameters;
    }
    // console.log( explanation );

    // display default explanation
    let explainerDivElement = document.getElementById( 'defaultExplainer' );
    explainerDivElement.innerHTML = "";
    let explanationHTML = document.createElement( 'span' );
    explanationHTML.innerHTML = '<b>This flow:  </b>' + explanation.replaceAll( /\n/g, '<br />' );
    explainerDivElement.appendChild( explanationHTML );

    // generate itemized description of the flow
    let stepByStepMDTable = `${flowName}\nDescription: ${flowDescription}\nType: ${flowDefinition.processType}\n\n`
                        + '|Element name|Type|Parameters|Condition|Condition next element|\n'
                        + '|-|-|-|-|-|\n';
    stepByStepMDTable += getMDTableRows( actionMap );

    createTableFromMarkDown( flowName, actionMap, stepByStepMDTable );

    // let csvFlow = getCSVFromMarkDown( stepByStepMDTable );
    // console.log( csvFlow );

    // prepare to call OpenAI
    let responseSpan = document.getElementById( "response" );
    responseSpan.innerText = '';

    const errorSpan = document.getElementById( "error" );
    let storedKey = localStorage.getItem( KEY );
    if( ! storedKey ) {
        const spinner = document.getElementById( "spinner" );
        spinner.style.display = "none";
        responseSpan.innerText = '';
        errorSpan.innerText = "Please set an OpenAI key to get an AI explanation.";
        return;
    }

    // since we have OpenAI key, display button to call it
    let gptInputs = document.getElementById( 'gptInputs' );
    gptInputs.innerHTML = "";
    let gptQuestionLabel = document.createElement( 'label' );
    gptQuestionLabel.innerText = 'Ask your question or leave blank for default prompt:';
    gptQuestionLabel.setAttribute( 'for', 'gptQuestion' );
    let gptQuestion = document.createElement( 'input' );
    gptQuestion.setAttribute( 'id', 'gptQuestion' );
    let gptButton = document.createElement( 'button' );
    gptButton.innerHTML = 'Ask GPT';
    let gptSelection = document.createElement( 'div' );
    gptSelection.innerHTML += `<input type="radio" id="gptVersion" name="gpt-version" value="gpt-3.5-turbo" checked>
        <label for="gpt-3.5-turbo">gpt-3.5-turbo</label>
        <input type="radio" id="gpt-4o" name="gpt-version" value="gpt-4o">
        <label for="gpt-4o">gpt-4o</label>`;

    let gptDialogContainer = document.createElement( 'div' );
    gptDialogContainer.appendChild( gptQuestionLabel );
    gptDialogContainer.appendChild( gptQuestion );
    gptDialogContainer.appendChild( gptButton );
    gptDialogContainer.appendChild( gptSelection );
    gptInputs.appendChild( gptDialogContainer );
    
    // make button call GPT 
    gptButton.addEventListener( 'click', () => {
        const spinner = document.getElementById( "spinner" );
        spinner.style.display = "inline-block";

        // extract OpenAI key
        let encodedKey = JSON.parse( storedKey );
        let keyArray = [];
        Object.keys( encodedKey ).forEach( idx => keyArray.push( encodedKey[ idx ] ) );
        let intArray = new Uint8Array( keyArray );
        let dec = new TextDecoder();
        let openAIKey = dec.decode( intArray );

        if( ! openAIKey ) {
            return;
        }

        responseSpan.innerText = 'Asking GPT to explain current flow...';

        // accept user question, otherwise use default prompt
        let prompt;
        let gptQuestion = document.getElementById( 'gptQuestion' );
        if( gptQuestion && gptQuestion.value ) {
            prompt = gptQuestion.value + '\\nFLOW: \\n';
        } else {
            prompt = `This flow: ${explanation.replaceAll( /\n/g, '\\n' )} ` + DEFAULT_PROMPT;
        }

        let gptModel = document.querySelector( 'input[name="gpt-version"]:checked' ).value;

        let dataObject = { 
            currentURL: window.location.href, 
            resultData: stepByStepMDTable, 
            // resultData: csvFlow,
            prompt: prompt,
            gptModel: gptModel
        };
        sendToGPT( dataObject, openAIKey );
    } );
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

function createTableFromMarkDown( flowName, actionMap, stepByStepMDTable ) {
    let addAnchorFunction = function ( entireMatch, capturedStr ) {
        let spaceIndex = capturedStr.indexOf(' ');
        let name = ( spaceIndex > 0 ? capturedStr.substring( 0, spaceIndex ) : capturedStr );
        let smallText = ( spaceIndex > 0 ? capturedStr.substring( spaceIndex ) : '' );
        return `<tr><td><a id="${name}" >${name}<br /><span class="smallText">${smallText}</span></a></td>`;
    }
    let addLinkFunction = function ( entireMatch, capturedStr ) {
        let nextAction = actionMap.get( capturedStr );
        if( nextAction == undefined ) {
            return `||\n`;
        }
        return `|<a href="#${capturedStr}" >${capturedStr}</a>|\n`;
    }

    let flowTableContainer = document.getElementById( 'flowTableContainer');
    if( flowTableContainer ) {
        flowTableContainer.remove();
    }
    flowTableContainer = document.createElement( "DIV" );
    flowTableContainer.setAttribute( "id", "flowTableContainer" );

    let table = '<br /><table id="flowTable"><thead>' + stepByStepMDTable
                .replaceAll( "|\n|-|-|-|-|-|\n|", "</td></tr></head><tbody><tr><td>" )
                .replaceAll( /(?:\|)([^|]+?)(?:\|\n)/gi, addLinkFunction )
                .replaceAll( "|\n", "</td></tr>" )
                .replaceAll( "</td></tr>|", "</td></tr>\n<tr><td>" )
                .replaceAll( "\n|", "<tr><td>" )
                .replaceAll( "|", "</td><td>" )
                .replaceAll( /(?:<tr><td>)(.+?)(?:<\/td>)/gi, addAnchorFunction )
                .replaceAll( " / ", "<br />" )
                .replaceAll( "<td> <br /> ", "<td>" )
                .replaceAll( 'Flow:', '<span style="font-weight: bold;">Flow:</span>' )
                .replaceAll( '\nDescription:', '\n<br /><span style="font-weight: bold;">Description:</span>' )
                    + '</tbody></table><br />';
    flowTableContainer.innerHTML = table;

    // create download MarkDown link
    let downloadButton = document.createElement( 'button' );
    downloadButton.innerHTML = 'Download Flow Definition in MarkDown Format';
    // downloadButton.style = 'background-color: blueviolet!important; color: white!important; ';
    downloadButton.addEventListener( 'click', () => {
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
    } );

    // add table to the document
    let flowDivElement = document.getElementById( 'flow' );
    flowDivElement.appendChild( downloadButton );
    flowDivElement.appendChild( flowTableContainer );
}

let index = 0;
let forksArray = [];
function assignIndexToElements( actionMap, currentElement, parentBranch, conditionLabel ) {
    // assign order number to current element
    index++;
    currentElement.index = index;
    // console.log( index, currentElement.name );

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
        forksArray.push( currentElement );

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
        assignIndexToElements( actionMap, branchNextElement 
                            , currentParentBranch, currentConditionLabel );
    }
}

function setKey() {
    const errorSpan = document.querySelector( "#error" );
    errorSpan.innerText = "";

    const openAIKeyInput = document.querySelector( "input#openAIKey" );

    let enc = new TextEncoder();
    let encrypted = enc.encode( openAIKeyInput.value );

    localStorage.setItem( KEY, JSON.stringify( encrypted ) );
    errorSpan.innerText = "An AI explanation should appear here the next time you open this page.";
}

function verySimpleHash( data ) {
    let hash = 0;
    for( let i = 0, len = data.length; i < len; i++ ) {
        let chr = data.charCodeAt( i );
        hash = ( hash << 5 ) - hash + chr;
        hash |= 0;
    }
    return hash;
}

const CACHE_DURATION = 300000; // 5 min
function sendToGPT( dataObject, openAIKey ) {
    const spinner = document.getElementById( "spinner" );
    const responseSpan = document.getElementById( "response" );
    // const errorSpan = document.getElementById( "error" );
    try {
        if( ! dataObject ) {
            responseSpan.innerText = 'No data received from current page.';
            spinner.style.display = "none";
            return;
        }

        let { currentURL, resultData, prompt, gptModel } = dataObject;

        if( ! resultData ) {
            responseSpan.innerText = 'No data to send.';
            spinner.style.display = "none";
            return;
        }

        // scan cache for clean up
        Object.keys( sessionStorage ).forEach( aKey => {
            let parsedCachedResponse = JSON.parse( sessionStorage.getItem( aKey ) );

            // if older than cache limit
            let cacheAgeMs = Math.abs( Date.now() - parsedCachedResponse?.cachedDate );
            if( cacheAgeMs >= CACHE_DURATION ) {
                sessionStorage.removeItem( aKey );
            }
        } );

        // attempt to retrieve previously stored response
        const cacheKey = verySimpleHash( currentURL + prompt + resultData.substring( 0, 20 ) ); // JSON.stringify( { currentURL, resultData, prompt } );
        const cachedResponse = sessionStorage.getItem( cacheKey );
        if( cachedResponse != null && cachedResponse != undefined ) {
            let parsedCachedResponse = JSON.parse( cachedResponse );

            // only use cached response if newer than cache limit
            let cacheAgeMs = Math.abs( Date.now() - parsedCachedResponse?.cachedDate );
            if( cacheAgeMs < CACHE_DURATION ) {
                // display response 
                responseSpan.innerText = 'OpenAI (cached response): ' + parsedCachedResponse.parsedResponse;
                spinner.style.display = "none";
                return;
            }
        }

        // use parameters recommended for Code Comment Generation
        let temperature = 0.3;  // was 1;
        let top_p = 0.2; // was 1;
        let max_tokens = 2000; // was 256 then 900
        let frequency_penalty = 0;
        let presence_penalty = 0;
        let model = ( gptModel ? gptModel : 'gpt-3.5-turbo' );
        let systemPrompt = 'You are an expert at troubleshooting and explaining Salesforce flows.';
        // was 'You are a helpful assistant.';

        // replace characters that would invalidate the JSON payload‘
        let data = //`Current page URL ${currentURL}\\n` +
                    resultData.replaceAll( '\n', '\\n ' ).replaceAll( '"', '“' )
                                .replaceAll( '\'', '‘' ).replaceAll( '\\', '\\\\' )
                                .replaceAll( '\t', ' ' ).replaceAll( '   ', ' ' );

        // check size of data and select a bigger model as needed
        if( data.length > 16200 ) {

            model = 'gpt-4o'; // 'gpt-3.5-turbo-16k';
            // truncate data as needed
            if( data.length > 130872 ) {
                data = data.substring( 0, 130872 );
            }
        }

        // build prompt with current page data in a request
        // let payload = `{ "model":"${model}","messages":[{"role":"system","content":"${systemPrompt}"},{"role":"user","content":"${prompt} ${data}"}],"temperature": ${temperature},"max_tokens":${max_tokens},"top_p":${top_p},"frequency_penalty":${frequency_penalty},"presence_penalty":${presence_penalty} }`;
        let sysMessage = `{"role":"system","content":[{"type":"text","text":"${systemPrompt}"}]}`;
        let userMessage = `{"role":"user","content":[{"type":"text","text":"${prompt} ${data}"}]}`;
        let payload = `{ "model":"${model}","messages":[${sysMessage},${userMessage}],"temperature": ${temperature},"max_tokens":${max_tokens},"top_p":${top_p},"frequency_penalty":${frequency_penalty},"presence_penalty":${presence_penalty} }`;

        // prepare request
        let url = "https://api.openai.com/v1/chat/completions";
        let xhr = new XMLHttpRequest();
        xhr.open( "POST", url );
        xhr.setRequestHeader( "Content-Type", "application/json" );
        xhr.setRequestHeader( "Authorization", "Bearer " + openAIKey );

        // submit request and receive response
        responseSpan.innerText = 'Waiting for OpenAI response...';
        xhr.onreadystatechange = function () {
            if( xhr.readyState === 4 ) {
                // console.log( xhr.status );
                // console.log( xhr.responseText );
                let open_ai_response = xhr.responseText;
                // console.log( open_ai_response );

                let parsedResponse = JSON.parse( open_ai_response );

                console.log( parsedResponse.usage );

                if( parsedResponse.error ) {
                    parsedResponse = parsedResponse.error.message + ` (${parsedResponse.error.type})`;

                } else {
                    let finishReason = parsedResponse.choices[ 0 ].finish_reason;
                    parsedResponse = parsedResponse.choices[ 0 ].message.content;
                    // The token count of prompt + max_tokens will not exceed the model's context length. 
                    if( finishReason == 'length' ) {
                        parsedResponse = parsedResponse + ' (RESPONSE TRUNCATED DUE TO LIMIT)';
                    }
                }

                // store response in local cache
                const cacheKey = JSON.stringify( { currentURL, resultData, prompt } );
                sessionStorage.setItem( cacheKey, JSON.stringify( { 
                                                cachedDate: Date.now() 
                                                , parsedResponse } ) 
                                        );

                // display response 
                responseSpan.innerText = 'OpenAI: ' + parsedResponse;
                spinner.style.display = "none";
            }
        };

        xhr.send( payload );
    } catch( e ) {
        responseSpan.innerText = e.message;
        spinner.style.display = "none";
    }
}