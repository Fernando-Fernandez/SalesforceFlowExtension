// checks whether a Salesforce page is open
// then fetches session id from cookie
// then calls tooling API to get flow definition
// then creates mouse over event handlers on each of the flow elements
// the handlers will display a tooltip with information from the element found in the flow definition

const GETHOSTANDSESSION = "getHostSession";
const TOOLING_API_VERSION = 'v42.0';

let sfHost, sessionId, flowDefinition;

// only execute event setup if within a Salesforce page
let sfElement = document.querySelector( "body.sfdcBody, body.ApexCSIPage, #auraLoadingBox" );
if( sfElement ) {
    // get host and session from background script
    let getHostMessage = { message: GETHOSTANDSESSION
        , url: location.href 
    };
    chrome.runtime.sendMessage( getHostMessage, resultData => {
        console.log( resultData );
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
                        
                        addHoverEvents();
                    } );
}

let getNodesTimeout;
function addHoverEvents() {
    // attempt to get list of flow nodes repeatedly, in both auto-layout and free-form modes
    let flowShapes = document.querySelectorAll( "div.node-container, span.text-element-label,div.start-node-box" );
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

function getNode( elementName, array ) {
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

function createTooltip( elementName, currentTarget, offsetHorizontal, offsetVertical ) {
    // read flow element position and add offset
    let leftPos = offsetHorizontal + parseInt( currentTarget.style.left );
    leftPos = isNaN( leftPos ) ? offsetHorizontal : leftPos;
    let topPos = offsetVertical + parseInt( currentTarget.style.top );
    topPos = isNaN( topPos ) ? offsetVertical : topPos;
    tooltip = document.createElement( "div" );
    tooltip.setAttribute( "style", "border: solid 1px darkgray; background-color: lightyellow; width:30em; position: absolute; z-index: 999;"
                                    + " top: " + topPos + "px; left: " + leftPos + "px;" );
    let titleNode = document.createTextNode( elementName );
    let boldNode = document.createElement( "strong" );
    boldNode.appendChild( titleNode );
    appendNodeAndLine( boldNode );

    currentTarget.parentNode.appendChild( tooltip );
}

let tooltip;
function displayTooltip( event, displayFlag ) {
    if( ! flowDefinition ) {
        return;
    }
    // remove old tooltip
    if( tooltip ) {
        tooltip.remove();
    }

    // if flag = false, keep it without tooltip
    if( ! displayFlag ) {
        return;
    }

    // tooltip on the start flow element
    if( event.currentTarget.className === 'start-node-box' ) {
        createTooltip( 'START FLOW', event.currentTarget, 280, 25 );
        return;
    }

    // handle flows in auto-layout or free-form
    let elementName = event.currentTarget.dataset.flowElementName;

    // find element node in the flow metadata
    let array = [ flowDefinition.recordCreates, flowDefinition.recordLookups, flowDefinition.recordDeletes
            , flowDefinition.recordUpdates, flowDefinition.decisions, flowDefinition.subflows 
            , flowDefinition.screens, flowDefinition.actionCalls, flowDefinition.assignments ];
    let node;
    for( const item of array ) {
        node = getNode( elementName, item );
        if( node ) {
            break;
        }
    }
    if( ! node ) {
        return;
    }

    createTooltip( elementName, event.currentTarget, 150, 40 );

    // get subflow name if calling subflow
    try {
        let subflowName = node.flowName;
        if( subflowName ) {
            let subflowNode = document.createTextNode( `(${subflowName})` );
            appendNodeAndLine( subflowNode );
        }
    } catch( e ) {
    }

    // add field assignments if creating record
    node.inputAssignments?.forEach( aField => {
        let assignDescription = ( aField.field ?? aField.name ) + ' = ' + getValue( aField.value );
        let assignmentNode = document.createTextNode( assignDescription );
        appendNodeAndLine( assignmentNode );
    } );
    
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

    // add filters if lookup
    node.filters?.forEach( anItem => {
        let fieldsNode = document.createTextNode( anItem.field 
                                                + " " + ( anItem.operator == "EqualTo" ? "=" : anItem.operator ) + " "
                                                + getValue( anItem.value ) );
        appendNodeAndLine( fieldsNode );
    } );

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