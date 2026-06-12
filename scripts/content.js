// checks whether a Salesforce page is open
// then fetches session id from cookie
// then calls tooling API to get flow definition
// then creates mouse over event handlers on each of the flow elements
// the handlers will display a tooltip with information from the element found in the flow definition

const GETHOSTANDSESSION = "getHostSession";
const POPUP_READY_MESSAGE = "sfFlowExtensionPopupReady";
// fallback when the org's latest API version cannot be fetched
const DEFAULT_API_VERSION = 'v57.0';
const BUTTON_STYLE = "background-color: blueviolet!important; color: white!important; \
margin-right: 30px; ";
const SHOW_DEFINITION_BUTTON_ID = "sfFlowExtensionViewDefinition";

// every Salesforce DOM dependency in one place:  when a Salesforce release
// breaks element discovery, this block is what needs updating
const SELECTORS = {
    // identifies a Salesforce page
    salesforcePage: "body.sfdcBody, body.ApexCSIPage, #auraLoadingBox"
    // flow nodes in auto-layout mode, free-form mode, and the start node
    , flowNodes: "div.node-container, span.text-element-label, div.start-node-box"
    // class of the start node in free-form mode
    , startNodeClass: "start-node-box"
    // visible label of the start node in auto-layout mode
    , startNodeLabel: "Start"
    // toolbar combobox the View Definition button is inserted before
    , flowComboBox: "lightning-combobox.slds-form-element"
    // canvas container that hosts the definition iframe
    , flowContainer: "div.slds-col.slds-grow.slds-grid.slds-is-relative.slds-scrollable_none"
};

// shared parsing helpers from flowParser.js, which the manifest loads first
const { getValue, removeHTML, buildDefinitionMap, findElementByLabel
        , getFlowOverview, renderExplanation } = FlowParserShared;

// the start-node tooltip shows at most this many summary lines
const MAX_TOOLTIP_LINES = 15;

let sfHost, sessionId, flowDefinition;

// only execute event setup if within a Salesforce page
let sfElement = document.querySelector( SELECTORS.salesforcePage );
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
        setFlowDefinitionFromToolingAPI( sfHost, sessionId );
    } );

}

async function getLatestAPIVersion( baseUrl ) {
    // /services/data/ lists the API versions the org supports (no auth needed),
    // sorted ascending, e.g. [ ..., { "version": "63.0", ... } ]
    try {
        let response = await fetch( "https://" + baseUrl + "/services/data/" );
        let versions = await response.json();
        if( Array.isArray( versions ) && versions.length > 0 ) {
            return "v" + versions[ versions.length - 1 ].version;
        }
    } catch( e ) {
        // unreachable or unexpected response, use the pinned fallback below
    }
    return DEFAULT_API_VERSION;
}

async function setFlowDefinitionFromToolingAPI( baseUrl, sessionId ) {
    let params = location.search; // ?flowId=3013m000000XIygAAG
    let flowIdArray = params.match( /(?:flowId\=)(.*?)(?=&|$)/ );
    if( ! flowIdArray ) {
        return;
    }
    let flowId = flowIdArray[ 1 ];

    let apiVersion = await getLatestAPIVersion( baseUrl );

    // Tooling API endpoint:  /services/data/v63.0/tooling/sobjects/Flow/301...AAG
    let endpoint = "https://" + baseUrl +  "/services/data/" + apiVersion + "/tooling/sobjects/Flow/" + flowId;
    let request = {
        method: "GET"
        , headers: {
          "Content-Type": "application/json"
          , "Authorization": "Bearer " + sessionId
        }
    };
    let response = await fetch( endpoint, request );
    let data = await response.json();
    flowDefinition = data.Metadata;
    waitForFlowUI();
}

const REATTACH_DEBOUNCE_MS = 500;
let reattachTimer;
function waitForFlowUI() {
    // attach to whatever is already rendered, then keep watching the page:
    // the canvas builds asynchronously and re-renders nodes on pan/zoom/edit,
    // which replaces the elements holding the hover handlers
    setupFlowUI();

    const observer = new MutationObserver( () => {
        clearTimeout( reattachTimer );
        reattachTimer = setTimeout( setupFlowUI, REATTACH_DEBOUNCE_MS );
    } );
    observer.observe( document.body, { childList: true, subtree: true } );
}

// idempotent:  hover handlers are assigned as properties and the button is
// only inserted when missing, so the observer can call this repeatedly
function setupFlowUI() {
    let flowShapes = document.querySelectorAll( SELECTORS.flowNodes );
    if( flowShapes.length <= 0 ) {
        return;
    }

    addHoverEvents( flowShapes );

    addShowDefinitionButton();
}

function addShowDefinitionButton() {
    if( document.getElementById( SHOW_DEFINITION_BUTTON_ID ) ) {
        return;
    }
    // insert button before the combobox
    let flowComboBox = document.querySelector( SELECTORS.flowComboBox );
    if( ! flowComboBox ) {
        // toolbar not rendered yet, the observer will call again
        return;
    }
    let showDefinitionButton = document.createElement( "button" );
    showDefinitionButton.setAttribute( "id", SHOW_DEFINITION_BUTTON_ID );
    showDefinitionButton.setAttribute( "class", "slds-button slds-button_neutral" );
    showDefinitionButton.setAttribute( "style", BUTTON_STYLE );
    showDefinitionButton.innerText = "View Definition (Flow Extension)";
    flowComboBox.parentElement.insertBefore( showDefinitionButton, flowComboBox );

    showDefinitionButton.addEventListener( "click", function() {
        showDefinition( showDefinitionButton );
    } );
}

function showDefinition( showDefinitionButton ) {

    let flowIframe = document.getElementById( "flowIframe" );

    if( ! flowIframe ) {
        let flowContainer = document.querySelector( SELECTORS.flowContainer );
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

        // send the definition once the iframe can receive it:  the primary signal
        // is the "ready" message popup.js posts right after registering its
        // message listener, with the iframe load event as fallback;
        // whichever fires first wins, the other is ignored
        let definitionSent = false;
        let sendDefinitionOnce = () => {
            if( definitionSent ) {
                return;
            }
            definitionSent = true;
            chrome.runtime.sendMessage( { flowDefinition } );
        };
        window.addEventListener( "message", ( event ) => {
            if( event.source === flowIframe.contentWindow
                    && event.data === POPUP_READY_MESSAGE ) {
                sendDefinitionOnce();
            }
        } );
        flowIframe.addEventListener( "load", sendDefinitionOnce );

        flowIframe.src = popupSrc;
        flowContainer.appendChild( flowIframe );

        flowIframe.style.display = "block";
        showDefinitionButton.innerText = "Hide Definition";
        return;
    }

    if( flowIframe.style.display == "none" ) {
        flowIframe.style.display = "block";
        showDefinitionButton.innerText = "Hide Definition";

        // iframe is already loaded, so refresh its contents right away
        chrome.runtime.sendMessage( { flowDefinition } );

    } else {
        // hide flow iframe if visible
        flowIframe.style.display = "none";
        showDefinitionButton.innerText = "View Definition";
    }
}

function addHoverEvents( flowShapes ) {
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

        // handler properties instead of addEventListener so repeated
        // observer-triggered setupFlowUI passes replace instead of stacking
        flowShape.onmouseover = ( event ) => {
            displayTooltip( event, true );
        };

        flowShape.onmouseout = ( event ) => {
            // remove tooltip (after a short delay)
            displayTooltip( event, false );
        };
    }
}

function appendNodeAndLine( aNode ) {
    tooltip.appendChild( aNode );
    tooltip.appendChild( document.createElement( "br" ) );
}

// arrow geometry:  the shaft spans the gap between the element and the
// tooltip, with the tip slightly overlapping the element's right edge
const ARROW_SHAFT_LENGTH = 150;
const ARROW_TIP_OVERLAP = 10;
const ARROW_HEIGHT = 25;
const ARROW_VERTICAL_OFFSET = 5;

// destructured parameters with defaults
function createTooltip( {
            elementName = 'This flow: '
            , currentTarget = ''
        } = {} ) {
    // anchor on the hovered element's box:  free-form elements carry their
    // canvas position in style.left/top, auto-layout ones are positioned by
    // their container (so both default to 0)
    let elementLeft = parseInt( currentTarget.style.left );
    elementLeft = isNaN( elementLeft ) ? 0 : elementLeft;
    let topPos = parseInt( currentTarget.style.top );
    topPos = isNaN( topPos ) ? 0 : topPos;

    // place the tooltip past the element's rendered width (squares in
    // free-form, wide rectangles in auto-layout) plus the arrow shaft,
    // so neither the arrow nor the tooltip covers the element
    let leftPos = elementLeft + currentTarget.offsetWidth + ARROW_SHAFT_LENGTH;

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
    // positioned absolutely in the same coordinate system as the tooltip so it
    // sits at the tooltip's height in both layouts; the arrowhead points left,
    // its tip just touching the element, and the shaft ends at the tooltip
    let arrowWidth = ARROW_SHAFT_LENGTH + ARROW_TIP_OVERLAP;
    arrow.setAttribute( "style", "width: " + arrowWidth + "px; height: " + ARROW_HEIGHT + "px; \
background-color: darkgray; z-index: 998; position: absolute; \
clip-path: polygon(0% 50%, 15px 0%, 15px 47%, 100% 47%, 100% 53%, 15px 53%, 15px 100% ); \
top: " + ( topPos + ARROW_VERTICAL_OFFSET ) + "px; left: " + ( leftPos - arrowWidth ) + "px;" );
    currentTarget.parentNode.appendChild( arrow );

    // keep the tooltip open while the mouse is over it (long tooltips
    // would otherwise vanish before they can be read)
    tooltip.onmouseover = () => clearTimeout( hideTooltipTimer );
    tooltip.onmouseout = scheduleTooltipRemoval;
}

let tooltip, arrow, hideTooltipTimer;
const TOOLTIP_HIDE_DELAY_MS = 300;

function removeTooltip() {
    tooltip?.remove();
    arrow?.remove();
    tooltip = null;
    arrow = null;
}

function scheduleTooltipRemoval() {
    clearTimeout( hideTooltipTimer );
    hideTooltipTimer = setTimeout( removeTooltip, TOOLTIP_HIDE_DELAY_MS );
}

function isStartNode( target, autoLayout ) {
    // free-form mode marks the start node with a dedicated class
    if( target.classList.contains( SELECTORS.startNodeClass ) ) {
        return true;
    }
    // in auto-layout mode the start node shows a "Start" label; match it as a
    // text line at any depth instead of relying on a fixed child structure
    return autoLayout && ( target.innerText ?? '' ).split( '\n' )
                            .some( line => line.trim() === SELECTORS.startNodeLabel );
}

function displayTooltip( event, displayFlag ) {
    if( ! flowDefinition ) {
        return;
    }

    // if flag = false, remove the tooltip after a short delay so it
    // survives brief mouse-outs and can be hovered to keep it open
    if( ! displayFlag ) {
        scheduleTooltipRemoval();
        return;
    }

    // remove old tooltip right away before showing the new one
    clearTimeout( hideTooltipTimer );
    removeTooltip();

    // determine layout of canvas
    const layout = flowDefinition.processMetadataValues[ 1 ].value.stringValue;
    const autoLayout = ( layout == 'AUTO_LAYOUT_CANVAS' );

    // collect nodes in the flow metadata and index them in a map
    const definitionMap = buildDefinitionMap( flowDefinition );

    // tooltip on the start flow element
    if( isStartNode( event.currentTarget, autoLayout ) ) {
        const { facts } = getFlowOverview( flowDefinition );
        let descriptionArray = renderExplanation( facts );
        if( descriptionArray.length > MAX_TOOLTIP_LINES ) {
            const hiddenCount = descriptionArray.length - MAX_TOOLTIP_LINES;
            descriptionArray = descriptionArray.slice( 0, MAX_TOOLTIP_LINES );
            descriptionArray.push( `…and ${ hiddenCount } more` );
        }

        if( descriptionArray.length > 0 ) {
            createTooltip( {
                elementName: 'This flow: '
                , currentTarget: event.currentTarget
            } );

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
    let node = findElementByLabel( definitionMap, elementName );
    if( ! node ) {
        return;
    }

    createTooltip( {
        elementName: elementName
        , currentTarget: event.currentTarget
    } );

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
            fieldText = removeHTML( fieldText );
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