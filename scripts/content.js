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
    let flowShapes = document.querySelectorAll( "div.node-container, span.text-element-label" );
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

    // read flow element position and add offset
    let leftPos = 150 + parseInt( event.currentTarget.style.left );
    leftPos = isNaN( leftPos ) ? 150 : leftPos;
    let topPos = 25 + parseInt( event.currentTarget.style.top );
    topPos = isNaN( topPos ) ? 25 : topPos;

    // create new tooltip with flow element name at the top
    tooltip = document.createElement( "div" );
    tooltip.setAttribute( "style", "border: solid 1px darkgray; background-color: lightyellow; width:30em; position: absolute; z-index: 999;"
                                    + " top: " + topPos + "px; left: " + leftPos + "px;" );
    let titleNode = document.createTextNode( elementName );
    let boldNode = document.createElement( "strong" );
    boldNode.appendChild( titleNode );
    tooltip.appendChild( boldNode );
    tooltip.appendChild( document.createElement( "br" ) );

    // add field assignments if creating record
    node.inputAssignments?.forEach( aField => {
        let assignmentNode = document.createTextNode( aField.field + ' = ' + aField.value.elementReference );
        tooltip.appendChild( assignmentNode );
        tooltip.appendChild( document.createElement( "br" ) );
    } );
    
    // add fields if screen element
    node.fields?.forEach( aField => {
        let fieldText = aField.fieldText;
        if( ! fieldText ) {
            fieldText = aField.outputParameters?.reduce( ( accumulator, currentValue ) => 
                                        accumulator + " / " + currentValue.assignToReference + " = " + currentValue.name
                                        , "" );
        }
        fieldText = fieldText.substring( 2 );
        let fieldsNode = document.createTextNode( fieldText );
        tooltip.appendChild( fieldsNode );
        tooltip.appendChild( document.createElement( "br" ) );
    } );
    
    // add fields if action
    if( node.actionName ) {
        let fieldsNode = document.createTextNode( node.actionName + " (" + node.actionType + ")" );
        tooltip.appendChild( fieldsNode );
    };

    // add rules if decision
    node.rules?.forEach( anItem => {
        let ruleLabelNode = document.createTextNode( anItem.label );
        tooltip.appendChild( ruleLabelNode );
        tooltip.appendChild( document.createElement( "br" ) );

        anItem.conditions?.forEach( condition => {
            let fieldsNode = document.createTextNode( condition.leftValueReference 
                + " " + ( condition.operator == "EqualTo" ? "=" : condition.operator ) + " "
                + ( condition.rightValue?.stringValue ?? condition.rightValue?.numberValue ?? condition.rightValue?.dateValue
                ?? condition.rightValue?.booleanValue ?? condition.rightValue?.dateTimeValue ?? condition.rightValue?.elementReference ) );
        
            tooltip.appendChild( fieldsNode );
            tooltip.appendChild( document.createElement( "br" ) );
        } );
    } );

    // add filters if lookup
    node.filters?.forEach( anItem => {
        let fieldsNode = document.createTextNode( anItem.field 
                                                + " " + ( anItem.operator == "EqualTo" ? "=" : anItem.operator ) + " "
                                                + ( anItem.value?.stringValue ?? anItem.value?.numberValue ?? anItem.value?.dateValue
                                                ?? anItem.value?.booleanValue ?? anItem.value?.dateTimeValue ?? anItem.value?.elementReference ) );
        tooltip.appendChild( fieldsNode );
        tooltip.appendChild( document.createElement( "br" ) );
    } );

    // add fields if assignment
    node.assignmentItems?.forEach( anItem => {
        let fieldsNode = document.createTextNode( anItem.assignToReference 
                                                + " " + ( anItem.operator == "Assign" ? "=" : "" )
                                                + ( anItem.operator == "Add" ? "appended with" : "" ) + " "
                                                + ( anItem.value?.stringValue ?? anItem.value?.numberValue ?? anItem.value?.dateValue
                                                ?? anItem.value?.booleanValue ?? anItem.value?.dateTimeValue ?? anItem.value?.elementReference ) );
        tooltip.appendChild( fieldsNode );
        tooltip.appendChild( document.createElement( "br" ) );
    } );
    
    // add tooltip to the parent of the current flow element
    event.currentTarget.parentNode.appendChild( tooltip );
}