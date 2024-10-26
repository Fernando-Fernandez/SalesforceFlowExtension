// checks whether a Salesforce page is open
// then fetches session id from cookie
// then calls tooling API to get flow definition
// then creates mouse over event handlers on each of the flow elements
// the handlers will display a tooltip with information from the element found in the flow definition

const GETHOSTANDSESSION = "getHostSession";
const TOOLING_API_VERSION = 'v57.0';
const BUTTON_STYLE = "background-color: blueviolet!important; color: white!important; \
margin-right: 30px; ";

let sfHost, sessionId, flowDefinition;

// only execute event setup if within a Salesforce page
let sfElement = document.querySelector( "body.sfdcBody, body.ApexCSIPage, #auraLoadingBox" );
if( sfElement ) {
    // get host and session from background script
    let getHostMessage = { message: GETHOSTANDSESSION
        , url: location.href 
    };
    chrome.runtime.sendMessage( getHostMessage, resultData => {
        //console.log( resultData );
        sfHost = resultData.domain;
        sessionId = resultData.session;

        // now that host and session are available, get flow definition
        let response = setFlowDefinitionFromToolingAPI( sfHost, sessionId );
    } );

}

function setFlowDefinitionFromToolingAPI( baseUrl, sessionId ) {
    let params = location.search; // ?flowId=3013m000000XIygAAG
    let flowIdArray = params.match( /(?:flowId\=)(.*?)(?=&|$)/ );
    if( ! flowIdArray ) {
        return;
    }
    let flowId = flowIdArray[ 1 ];

    // Tooling API endpoint:  /services/data/v35.0/tooling/sobjects/Flow/301...AAG
    let endpoint = "https://" + baseUrl +  "/services/data/" + TOOLING_API_VERSION + "/tooling/sobjects/Flow/" + flowId;
    let request = {
        method: "GET"
        , headers: {
          "Content-Type": "application/json"
          , "Authorization": "Bearer " + sessionId
        }
    };
    let response = fetch( endpoint, request )
                    .then( ( response ) => response.json() )
                    .then( ( data ) => {
                        flowDefinition = data.Metadata;
                        waitForFlowUI();
                    } );
}

let getNodesTimeout;
function waitForFlowUI() {
    // attempt to get list of flow nodes repeatedly, in both auto-layout and free-form modes
    let flowShapes = document.querySelectorAll( 
                        "div.node-container, span.text-element-label,div.start-node-box" );
    if( flowShapes.length <= 0 ) {
        // nodes not created, try again in 2 secs
        getNodesTimeout = setTimeout( () => {
            waitForFlowUI();
        }, 2000 );
        return;
    }

    clearTimeout( getNodesTimeout );

    addHoverEvents();

    addShowDefinitionButton();
}

function addShowDefinitionButton() {
    // insert button before the combobox
    let flowComboBox = document.querySelector( "lightning-combobox.slds-form-element" );
    let showDefinitionButton = document.createElement( "button" );
    showDefinitionButton.setAttribute( "class", "slds-button slds-button_neutral" );
    showDefinitionButton.setAttribute( "style", BUTTON_STYLE );
    showDefinitionButton.innerText = "View Definition (Flow Extension)";
    flowComboBox.parentElement.insertBefore( showDefinitionButton, flowComboBox );

    showDefinitionButton.addEventListener( "click", function() { 
        showDefinition( showDefinitionButton ); 
    } );
}

let instantiationTimer;
function showDefinition( showDefinitionButton ) {

    let flowIframe = document.getElementById( "flowIframe" );

    if( ! flowIframe ) {
        let flowContainer = document.querySelector( 
                            "div.slds-col.slds-grow.slds-grid.slds-is-relative.slds-scrollable_none" );
        // append iframe
        let popupSrc = chrome.runtime.getURL( "popup.html" );
        flowIframe = document.createElement( "iframe" );
        flowIframe.setAttribute( "id", "flowIframe" );
        flowIframe.style.position = "absolute";
        flowIframe.style.top = "5px";
        flowIframe.style.left = "5px";
        flowIframe.style.zIndex = "999";
        flowIframe.setAttribute( "width", flowContainer.offsetWidth - 10 );
        flowIframe.setAttribute( "height", flowContainer.offsetHeight - 10 );
        // flowIframe.style.marginLeft = "5rem";
        flowIframe.src = popupSrc;
        flowContainer.appendChild( flowIframe );

        flowIframe.style.display = "block";
        showDefinitionButton.innerText = "Hide Definition";

    } else {
        if( flowIframe.style.display == "none" ) {
            flowIframe.style.display = "block";
            showDefinitionButton.innerText = "Hide Definition";

        } else {
            // hide flow iframe if visible
            flowIframe.style.display = "none";
            showDefinitionButton.innerText = "View Definition";
            return;
        }
    }

    // wait for the iframe to load and then send the flow definition to it
    instantiationTimer = setTimeout( () => {
        clearTimeout( instantiationTimer );
        chrome.runtime.sendMessage( { flowDefinition } );
    }, 1000 );
}

function addHoverEvents() {
    // attempt to get list of flow nodes repeatedly, in both auto-layout and free-form modes
    let flowShapes = document.querySelectorAll( 
                        "div.node-container, span.text-element-label,div.start-node-box" );
    if( flowShapes.length <= 0 ) {
        // nodes not created, try again in 2 secs
        getNodesTimeout = setTimeout( () => {
            addHoverEvents();
        }, 2000 );
        return;
    }

    clearTimeout( getNodesTimeout );

    // add mouse over/out events to each of the flow nodes
    for( let i = 0; i < flowShapes.length; i++ ) {
        let flowShape = flowShapes[ i ];
        let flowElementName = flowShape.title;

        // if flow in free-form mode, get element name from text
        if( flowShape.nodeName == 'SPAN' ) {
            flowElementName = flowShape.textContent;
            flowShape = flowShape.parentNode.parentElement.parentElement.parentElement;
        } else {
            // if flow is in auto-layout mode, extract element name from within double quotes
            if( flowElementName && flowElementName.indexOf( '"' ) > -1 ) {
                flowElementName = flowElementName.match( /"(.*?)"/ )[ 1 ];
            }
        }

        // copy title from original node into data structure
        flowShape.dataset.flowElementName = flowElementName;
        flowShape.addEventListener( "mouseover", ( event ) => {
            displayTooltip( event, true );
        } );

        flowShape.addEventListener( "mouseout", ( event ) => {
            // remove tooltip
            displayTooltip( event, false );
        } );
    }
}

function findNodeByNameInArray( elementName, array ) {
    if( array && array.length < 0 ) {
        return null;
    }
    return array.find( aNode => aNode.label === elementName );
}

function appendNodeAndLine( aNode ) {
    tooltip.appendChild( aNode );
    tooltip.appendChild( document.createElement( "br" ) );
}

function getValue( aValue ) {
    return aValue.elementReference ?? aValue.stringValue ?? aValue.numberValue
                ?? aValue.booleanValue?? aValue.dateTimeValue?? aValue.dateValue;
}

function indexElementsAndReturnDescription( definitionMap ) {

    // populate node map indexed by name
    const nodeMap = new Map();
    const screenMap = new Map();
    const decisionMap = new Map();
    definitionMap.forEach( ( value, key ) => {
        value.forEach( aNode => { 
            // get the node that the current node is pointing to
            let targetName = aNode.connector?.targetReference;

            // handle next node pointers in decisions
            // TODO:  implement for loops too
            if( ! targetName && aNode.rules && aNode.rules.length > 0 ) {
                // branch to the first rule
                targetName = aNode.rules[ 0 ].connector?.targetReference;
            }
            if( ! targetName ) {
                targetName = aNode.defaultConnector?.targetReference;
            }
            const faultTargetName = aNode.faultConnector?.targetReference;
            const newNode = { 
                ...aNode 
                , type:  key
                , targetName:  targetName
                , faultTargetName:  faultTargetName
                , visitCount: 0
            };
            nodeMap.set( aNode.name, newNode );

            // create text for screen describing the inputs/outputs
            if( key === 'screens' ) {
                const inputFields = aNode.fields.filter( aField => aField.fieldType !== "DisplayText" )
                                            .map( aField => aField.fieldText ?? 
                                                                aField.name ?? aField.extensionName )
                                            .join( ", " );
                const displayFields = aNode.fields.filter( aField => ( aField.fieldType == "ComponentInstance" 
                                                                        || aField.fieldType == "DisplayText" ) 
                                                                    && aField.fieldText )
                                            .map( aField => aField.fieldText ?? 
                                                                aField.name ?? aField.extensionName )
                                            .join( ", " );
                const description = ( displayFields ? "displaying:  " + removeHTML( displayFields ) : "" )
                                + ( inputFields && displayFields ? " and " : "" )
                                + ( inputFields ? "prompting the user for these fields:  " + inputFields : "" );
                screenMap.set( aNode.name, description );
            }

            if( key === 'decisions' ) {
                // TODO:  describe individual branches
                const description = "checking these conditions:  " 
                                + aNode.label + ' - ' + aNode.rules.map( aRule => aRule.label ).join( ", " );
                decisionMap.set( aNode.name, description );
            }
        } );
    } );
    // console.log( nodeMap );

    // find a record create/update/delete and trace back to a decision or screen
    let relevantTypesSet = new Set( [ 'recordCreates', 'recordUpdates', 'recordDeletes', 'actionCalls'
                            , 'subflows', 'recordLookups' ] );
    let descriptionArray = [];

    // follow the flow element sequence and create descriptions at relevant points
    let startingElement = flowDefinition.startElementReference ?? 
                            flowDefinition.start?.connector?.targetReference ?? 
                            flowDefinition.start?.scheduledPaths[ 0 ].connector?.targetReference;
    let currentNode = nodeMap.get( startingElement );
    let lastDecisionNode, lastDecisionNodeWithPendingBranches;
    let lastScreenNode;
    let nextNode = nodeMap.get( currentNode.targetName );
    let visitedCountMap = new Map();
    let nodesAlreadyDescribedSet = new Set();
    while( nextNode || lastDecisionNodeWithPendingBranches ) {
        // if there are no nodes left to visit, revisit the last decision that wasn't fully explored
        if( ! nextNode ) {
            nextNode = lastDecisionNodeWithPendingBranches;
            // reset last screen that was from different context
            lastScreenNode = null;
        }

        // check if non-decision node has already been visited
        if( nextNode && nextNode.visitCount > 0 
                && nextNode.type !== 'decisions' && nextNode.type !== 'loops' ) {
            // node has already been visited, so we're in a loop and can exit
            break;
        }

        nextNode.visitCount ++;

        // what will be the subsequent node to visit
        let nextNodeName = nextNode.targetName;

        // count how many times this decision node has been visited
        // TODO:  implement for loops too
        if( nextNode.type === 'decisions' ) {
            // increase count to determine which of this decision's rule branch to visit next
            let visitedCount = 0;
            if( visitedCountMap.has( nextNode.name ) ) {
                visitedCount = visitedCountMap.get( nextNode.name ) + 1;
            }
            visitedCountMap.set( nextNode.name, visitedCount );

            // get the next node from the rule that hasn't been visited yet
            if( visitedCount === nextNode.rules.length ) {
                // all rules have been visited, proceed to the default branch
                nextNodeName = nextNode.defaultConnector?.targetReference;
                lastDecisionNodeWithPendingBranches = null;
            } else {
                nextNodeName = nextNode.rules[ visitedCount ].connector?.targetReference;
                lastDecisionNodeWithPendingBranches = nextNode;
            }
        }

        // count how many times this loop node has been visited
        if( nextNode.type === 'loops' ) {
            // increase count to determine which of this loop's branch to visit next
            let visitedCount = 0;
            if( visitedCountMap.has( nextNode.name ) ) {
                visitedCount = visitedCountMap.get( nextNode.name ) + 1;
            }
            visitedCountMap.set( nextNode.name, visitedCount );

            // get the next node from the loop that hasn't been visited yet
            if( visitedCount === 1 ) {
                // now that the main loop elements have been visited, proceed to the exit branch
                nextNodeName = nextNode.noMoreValuesConnector?.targetReference;
                lastDecisionNodeWithPendingBranches = null;
            } else {
                nextNodeName = nextNode.nextValueConnector?.targetReference;
                lastDecisionNodeWithPendingBranches = nextNode;
            }
        }

        if( currentNode.type === 'screens' ) {
            lastScreenNode = currentNode;
        }
        if( currentNode.type === 'decisions' ) {
            lastDecisionNode = currentNode;
        }

        // skip if node not relevant
        if( ! relevantTypesSet.has( nextNode.type ) ) {
            currentNode = nextNode;
            nextNode = nodeMap.get( nextNodeName );
            continue;
        }

        // avoid duplicate descriptions
        if( nodesAlreadyDescribedSet.has( nextNode.name ) ) {
            currentNode = nextNode;
            nextNode = nodeMap.get( nextNodeName );
            continue;
        }
        nodesAlreadyDescribedSet.add( nextNode.name )

        // create a description from the pair of nodes
        let recordAction = ( nextNode.type === 'recordCreates' ? 'inserts ' : '' )
                            + ( nextNode.type === 'recordUpdates' ? 'updates ' : '' )
                            + ( nextNode.type === 'recordDeletes' ? 'deletes ' : '' );
        let targetOfAction = nextNode.object ?? nextNode.inputReference;
        let description = ( recordAction ? recordAction + targetOfAction + ' record ' : '' )
                        + ( nextNode.type === 'actionCalls' ? 'calls action ' 
                                        + nextNode.actionName + " (" + nextNode.actionType + ") " : '' )
                        + ( nextNode.type === 'subflows' ? 'calls flow ' 
                                        + nextNode.name + " (" + nextNode.flowName + ") " : '' );;
        if( lastScreenNode ) {
            description = description + "after " + screenMap.get( lastScreenNode.name );
        }
        if( lastDecisionNode ) {
            let ruleIndex = visitedCountMap.get( lastDecisionNode.name );
            ruleIndex = ruleIndex ?? 0;
            ruleIndex = Math.min( ruleIndex, lastDecisionNode.rules.length - 1 );
            let ruleLabel = lastDecisionNode.rules[ ruleIndex ].label
            description = description + ( lastScreenNode ? " and " : "" )
                            + "after checking " + lastDecisionNode.label + ': ' + ruleLabel; //decisionMap.get( lastDecisionNode.name );
        }

        descriptionArray.push( description );

        currentNode = nextNode;
        nextNode = nodeMap.get( nextNodeName );
    }

    return descriptionArray;
}

function removeHTML( aValue ) {
    return aValue.replaceAll( /\<\/?.*?\>/g, '' );
}

// destructured parameters with defaults
function createTooltip( { 
            elementName = 'This flow: '
            , currentTarget = ''
            , offsetHorizontal = 350
            , offsetVertical = 0
            , arrowYDistance = 65
        } = {} ) {
    // read flow element position and add offset
    let leftPos = offsetHorizontal + parseInt( currentTarget.style.left );
    leftPos = isNaN( leftPos ) ? offsetHorizontal : leftPos;
    let topPos = offsetVertical + parseInt( currentTarget.style.top );
    topPos = isNaN( topPos ) ? offsetVertical : topPos;
    tooltip = document.createElement( "div" );
    tooltip.setAttribute( "style", "border: solid 1px darkgray; word-wrap: break-word; white-space: normal; " 
                                    + "background-color: lightyellow; width:30em; " 
                                    + "position: absolute; z-index: 999; "
                                    + "top: " + topPos + "px; left: " + leftPos + "px;" );
    let titleNode = document.createTextNode( elementName );
    let boldNode = document.createElement( "strong" );
    boldNode.appendChild( titleNode );
    appendNodeAndLine( boldNode );

    currentTarget.parentNode.appendChild( tooltip );

    arrow = document.createElement( "div" );
    const distanceX = 200, distanceY = 10; // auto-layout should result in top -65, left 50 (with width 350)
    arrow.setAttribute( "style", "width: " + distanceX + "px; height: 25px; \
background-color: darkgray; z-index: 998; position: relative; \
clip-path: polygon(0% 50%, 15px 0%, 15px 47%, 100% 47%, 100% 53%, 15px 53%, 15px 100% ); \
top: " + ( topPos - arrowYDistance ) + "px; left: " + ( leftPos - distanceX ) + "px;" );
    currentTarget.parentNode.appendChild( arrow );
}

let tooltip, arrow;
function displayTooltip( event, displayFlag ) {
    if( ! flowDefinition ) {
        return;
    }
    // remove old tooltip
    if( tooltip ) {
        tooltip.remove();
        arrow.remove();
    }

    // if flag = false, keep it without tooltip
    if( ! displayFlag ) {
        return;
    }

    // determine layout of canvas
    const layout = flowDefinition.processMetadataValues[ 1 ].value.stringValue;
    const autoLayout = ( layout == 'AUTO_LAYOUT_CANVAS' );

    // collect nodes in the flow metadata and index them in a map
    const definitionMap = new Map( [
        [ 'recordCreates', flowDefinition.recordCreates ]
        , [ 'recordUpdates', flowDefinition.recordUpdates ]
        , [ 'recordDeletes', flowDefinition.recordDeletes ]
        , [ 'recordLookups', flowDefinition.recordLookups ]
        , [ 'transforms', flowDefinition.transforms ]
        , [ 'decisions', flowDefinition.decisions ]
        , [ 'subflows', flowDefinition.subflows ]
        , [ 'screens', flowDefinition.screens ]
        , [ 'actionCalls', flowDefinition.actionCalls ]
        , [ 'assignments', flowDefinition.assignments ]
        , [ 'loops', flowDefinition.loops ]
        , [ 'collectionProcessors', flowDefinition.collectionProcessors ]
    ] );

    // tooltip on the start flow element
    const isStartElement = event.currentTarget.className === 'start-node-box'
            || ( autoLayout 
                && event.currentTarget.children[ 0 ].children[ 1 ].children[ 1 ]
                && event.currentTarget.children[ 0 ].children[ 1 ].children[ 1 ].innerText == 'Start' );

    if( isStartElement ) {
        let descriptionArray = indexElementsAndReturnDescription( definitionMap );

        if( descriptionArray.length > 0 ) {
            if( autoLayout ) {
                createTooltip( { 
                    elementName: 'This flow: '
                    , currentTarget: event.currentTarget
                    , offsetHorizontal: 350
                    , offsetVertical: 0
                    , arrowYDistance: 65
                } );

            } else {
                createTooltip( { 
                    elementName: 'This flow: '
                    , currentTarget: event.currentTarget
                    , offsetHorizontal: 400
                    , offsetVertical: 0
                    , arrowYDistance: 98 //121
                } );
            }

            descriptionArray.forEach( aDescription => {
                let descriptionNode = document.createTextNode( ' - ' + aDescription );
                appendNodeAndLine( descriptionNode );
            } );
        }
        return;
    }

    // handle flows in auto-layout or free-form
    let elementName = event.currentTarget.dataset.flowElementName;

    // find element node in the flow metadata
    let node;
    for( const [key, value] of definitionMap ) {
        node = findNodeByNameInArray( elementName, value );
        if( node ) {
            node.type = key;
            break;
        }
    }

    if( ! node ) {
        return;
    }

    if( autoLayout ) {
        createTooltip( { 
            elementName: elementName
            , currentTarget: event.currentTarget
            , offsetHorizontal: 270
            , offsetVertical: 0
            , arrowYDistance: 60
        } );

    } else {
        createTooltip( { 
            elementName: elementName
            , currentTarget: event.currentTarget
            , offsetHorizontal: 270
            , offsetVertical: 0
            , arrowYDistance: 1
        } );
    }

    // get subflow name if calling subflow
    try {
        let subflowName = node.flowName;
        if( subflowName ) {
            let subflowNode = document.createTextNode( `(${subflowName})` );
            appendNodeAndLine( subflowNode );
        }
    } catch( e ) {
    }

    // handle elementSubtype
    try {
        let elementSubtype = node.elementSubtype;
        if( elementSubtype ) {
            let subTypeNode = document.createTextNode( `(${elementSubtype})` );
            appendNodeAndLine( subTypeNode );
        }
    } catch( e ) {
    }

    // handle transforms
    if( node.type == 'transforms' ) {
        let dataType = node.dataType;
        let objectType = node.objectType;
        let dataTypeNode = document.createTextNode( `(${ objectType ?? dataType })` );
        appendNodeAndLine( dataTypeNode );

        node.transformValues?.forEach( aTransformValue => {
            aTransformValue?.transformValueActions.forEach( aTransformAction => {
                let aValue = getValue( aTransformAction.value );
                let transformDescription = aTransformAction.transformType + ': ' 
                            + ( aValue ? aValue : 'formula' )
                            + ( aTransformAction.outputFieldApiName ? ' to ' + aTransformAction.outputFieldApiName : '' );
                let transformNode = document.createTextNode( transformDescription );
                appendNodeAndLine( transformNode );
            } );
        } );
    }

    // add field assignments if creating record
    if( node.inputAssignments && node.inputAssignments.length > 0 ) {
        let inputHeader = document.createTextNode( "Input Assignments:  " );
        appendNodeAndLine( inputHeader );
        node.inputAssignments?.forEach( aField => {
            let assignDescription = ( aField.field ?? aField.name ) + ' = ' + getValue( aField.value );
            let assignmentNode = document.createTextNode( assignDescription );
            appendNodeAndLine( assignmentNode );
        } );
    }

    if( node.outputAssignments && node.outputAssignments.length > 0 ) {
        let outputHeader = document.createTextNode( "Output Assignments:  " );
        appendNodeAndLine( outputHeader );
        node.outputAssignments?.forEach( aField => {
            let assignDescription = ( aField.field ?? aField.name ) + ' = ' + getValue( aField.value );
            let assignmentNode = document.createTextNode( assignDescription );
            appendNodeAndLine( assignmentNode );
        } );
    }
    
    // add fields if screen element
    node.fields?.forEach( aField => {
        let fieldText = aField.fieldText;

        if( aField.fieldType === "DisplayText" ) {
            // remove HTML
            fieldText = fieldText.replaceAll( /\<\/?.*?\>/g, '' );
        }

        if( aField.fieldType === "ComponentInstance" ) {
            fieldText = aField.inputParameters?.reduce( ( accumulator, currentValue ) => 
                                            accumulator + getValue( currentValue.value ) + ", "
                                            , "" );
            fieldText = ( fieldText !== "" ? fieldText : aField.name ?? aField.extensionName );
        }

        if( ! fieldText ) {
            fieldText = aField.outputParameters?.reduce( ( accumulator, currentValue ) => 
                            accumulator + " / " + getValue( currentValue ) + " = " + currentValue.name
                            , "" );
            if( fieldText.length > 2 ) {
                fieldText = fieldText.substring( 2 );
            }
        }
        let fieldsNode = document.createTextNode( `${aField.fieldType}: ${fieldText}` );
        appendNodeAndLine( fieldsNode );
    } );
    
    // add fields if action
    if( node.actionName ) {
        let fieldsNode = document.createTextNode( node.actionName + " (" + node.actionType + ")" );
        appendNodeAndLine( fieldsNode );
        
        node.inputParameters?.forEach( aField => {
            let paramDescription = ( aField.field ?? aField.name ) + ' = ' + getValue( aField.value );
            let paramNode = document.createTextNode( paramDescription );
            appendNodeAndLine( paramNode );
        } );
    };

    // describe collection processors
    if( node.collectionProcessorType ) {
        let type = ( node.collectionProcessorType == 'SortCollectionProcessor' ? 'Sort'
            : node.collectionProcessorType == 'FilterCollectionProcessor' ? 'Filter'
            : node.collectionProcessorType == 'RecommendationMapCollectionProcessor' ? 'Recommendation Map' 
            : '' );
        let typeNode = document.createTextNode( `Type:  ${type}` );
        appendNodeAndLine( typeNode );
        let sortOptions = node.sortOptions?.reduce( ( accumulator, currentValue ) => 
                    accumulator + currentValue.sortField + " " + currentValue.sortOrder + ", "
                    , "Sort Order:  " );
        appendNodeAndLine( document.createTextNode( sortOptions ) );
    }

    // describe loops and collection processors
    if( node.collectionReference ) {
        let loopNode = document.createTextNode( `Loop collection:  ${node.collectionReference}` );
        appendNodeAndLine( loopNode );
    }
    // add rules if decision
    node.rules?.forEach( anItem => {
        let ruleLabelNode = document.createTextNode( anItem.label );
        appendNodeAndLine( ruleLabelNode );

        anItem.conditions?.forEach( condition => {
            let fieldsNode = document.createTextNode( condition.leftValueReference 
                + " " + ( condition.operator == "EqualTo" ? "=" : condition.operator ) + " "
                + getValue( condition.rightValue ) );
        
            appendNodeAndLine( fieldsNode );
        } );
    } );

    // if record action
    if( node.object ) {
        let targetOfAction = document.createTextNode( 'Object:  ' + node.object );
        appendNodeAndLine( targetOfAction );
    }
    if( node.assignNullValuesIfNoRecordsFound ) {
        let assignNull = document.createTextNode( 'Assign null if no records:  ' + node.assignNullValuesIfNoRecordsFound );
        appendNodeAndLine( assignNull );
    }
    if( node.getFirstRecordOnly ) {
        let only1Record = document.createTextNode( 'Only first record:  ' + node.getFirstRecordOnly );
        appendNodeAndLine( only1Record );
    }
    if( node.assignRecordIdToReference ) {
        let assignId = document.createTextNode( 'Assign record id to:  ' + node.assignRecordIdToReference );
        appendNodeAndLine( assignId );
    }
    if( node.inputReference ) {
        let theInput = document.createTextNode( 'Input:  ' + node.inputReference );
        appendNodeAndLine( theInput );
    }
    let recordOperationType = ( node.type == 'recordCreates' ? 'Creation' :
                                node.type == 'recordUpdates' ? 'Update' :
                                node.type == 'recordLookups' ? 'Lookup' : 
                                node.type == 'recordDeletes' ? 'Delete' : 
                                null );
    if( recordOperationType ) {
        let theAction = document.createTextNode( `Action:  Record ${recordOperationType}` );
        appendNodeAndLine( theAction );
    }

    // add filters if lookup
    if( node.filters && node.filters.length > 0 ) {
        let filterHeader = document.createTextNode( `Filters: ` );
        appendNodeAndLine( filterHeader );
        node.filters?.forEach( anItem => {
            let fieldsNode = document.createTextNode( anItem.field 
                                            + " " + ( anItem.operator == "EqualTo" ? "=" : anItem.operator ) + " "
                                            + getValue( anItem.value ) );
            appendNodeAndLine( fieldsNode );
        } );
    }

    // add fields if assignment
    node.assignmentItems?.forEach( anItem => {
        let fieldsNode = document.createTextNode( anItem.assignToReference 
                                        + " " + ( anItem.operator == "Assign" ? "=" : "" )
                                        + ( anItem.operator == "Add" ? "appended with" : "" ) + " "
                                        + getValue( anItem.value ) );
        appendNodeAndLine( fieldsNode );
    } );

    // add parameters if subflow
    node.subflows?.forEach( anItem => { 
        console.log( anItem );
    } );
    
    // add tooltip to the parent of the current flow element
    event.currentTarget.parentNode.appendChild( tooltip );
}