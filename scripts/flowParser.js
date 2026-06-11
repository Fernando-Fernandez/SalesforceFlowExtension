// Shared flow-parsing logic used by content.js (tooltips, start-node summary)
// and popup.js (table, explanation).
//
// Content scripts and the popup page cannot import extension files as ES
// modules, so this file is loaded as a classic script (first in the manifest's
// content_scripts js array, and via a script tag before popup.js in
// popup.html) and attaches a single global object.
globalThis.FlowParserShared = ( function() {

    // canonical list of the flow metadata collections holding flow elements,
    // in the order the popup table presents them
    const FLOW_ELEMENT_TYPES = [
        'recordLookups'
        , 'recordCreates'
        , 'recordUpdates'
        , 'recordDeletes'
        , 'recordRollbacks'
        , 'assignments'
        , 'decisions'
        , 'screens'
        , 'loops'
        , 'steps'
        , 'subflows'
        , 'actionCalls'
        , 'apexPluginCalls'
        , 'collectionProcessors'
        , 'transforms'
        , 'waits'
        , 'dynamicChoiceSets'
        , 'variables'
        , 'textTemplates'
        , 'formulas'
        , 'constants'
        , 'choices'
    ];

    // a flow metadata value object carries exactly one of these fields
    function getValue( aValue, defaultValue ) {
        return aValue?.apexValue ??
                aValue?.booleanValue ??
                aValue?.dateTimeValue ??
                aValue?.dateValue ??
                aValue?.elementReference ??
                aValue?.numberValue ??
                aValue?.sobjectValue ??
                aValue?.stringValue ?? defaultValue;
    }

    // indexes the flow element collections by type name; missing collections
    // become empty arrays so callers can iterate without guarding
    function buildDefinitionMap( flowDefinition ) {
        const definitionMap = new Map();
        FLOW_ELEMENT_TYPES.forEach( typeName => {
            definitionMap.set( typeName, flowDefinition[ typeName ] ?? [] );
        } );
        return definitionMap;
    }

    // finds a flow element by its label across all collections and tags it
    // with its type name
    function findElementByLabel( definitionMap, label ) {
        for( const [ typeName, elements ] of definitionMap ) {
            const element = elements.find( anElement => anElement.label === label );
            if( element ) {
                element.type = typeName;
                return element;
            }
        }
        return null;
    }

    function removeHTML( aValue ) {
        return aValue.replaceAll( /\<\/?.*?\>/g, '' );
    }

    // walks the flow from the start element following connectors (branching
    // through decision rules and loops) and returns plain-English descriptions
    // of the relevant operations, used for the start-node summary tooltip
    function describeFlow( flowDefinition, definitionMap ) {

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

        // find a record create/update/delete and trace back to a decision or screen
        let relevantTypesSet = new Set( [ 'recordCreates', 'recordUpdates', 'recordDeletes', 'actionCalls'
                                , 'subflows', 'recordLookups' ] );
        let descriptionArray = [];

        // follow the flow element sequence and create descriptions at relevant points
        let startingElement = flowDefinition.startElementReference ??
                                flowDefinition.start?.connector?.targetReference ??
                                flowDefinition.start?.scheduledPaths?.[ 0 ]?.connector?.targetReference;
        let currentNode = nodeMap.get( startingElement );
        if( ! currentNode ) {
            return descriptionArray;
        }
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
            nodesAlreadyDescribedSet.add( nextNode.name );

            // create a description from the pair of nodes
            let recordAction = ( nextNode.type === 'recordCreates' ? 'inserts ' : '' )
                                + ( nextNode.type === 'recordUpdates' ? 'updates ' : '' )
                                + ( nextNode.type === 'recordDeletes' ? 'deletes ' : '' );
            let targetOfAction = nextNode.object ?? nextNode.inputReference;
            let description = ( recordAction ? recordAction + targetOfAction + ' record ' : '' )
                            + ( nextNode.type === 'actionCalls' ? 'calls action '
                                            + nextNode.actionName + " (" + nextNode.actionType + ") " : '' )
                            + ( nextNode.type === 'subflows' ? 'calls flow '
                                            + nextNode.name + " (" + nextNode.flowName + ") " : '' );
            if( lastScreenNode ) {
                description = description + "after " + screenMap.get( lastScreenNode.name );
            }
            if( lastDecisionNode ) {
                let ruleIndex = visitedCountMap.get( lastDecisionNode.name );
                ruleIndex = ruleIndex ?? 0;
                ruleIndex = Math.min( ruleIndex, lastDecisionNode.rules.length - 1 );
                let ruleLabel = lastDecisionNode.rules[ ruleIndex ].label;
                description = description + ( lastScreenNode ? " and " : "" )
                                + "after checking " + lastDecisionNode.label + ': ' + ruleLabel;
            }

            descriptionArray.push( description );

            currentNode = nextNode;
            nextNode = nodeMap.get( nextNodeName );
        }

        return descriptionArray;
    }

    // assigns a sequential execution index to every element reachable from the
    // first element, following all branches recursively, and links each element
    // to the branch (decision/loop/fault) it flows from; used to order the
    // popup table and to phrase the explanation conditions
    function indexElements( actionMap, firstElementName ) {
        let counter = 0;

        const visit = ( currentElement, parentBranch, conditionLabel ) => {
            // assign order number to current element
            counter++;
            currentElement.index = counter;

            // link element to parent branch it inherited
            // so all elements will belong to a parent branch
            let currentParentBranch = parentBranch;
            let currentConditionLabel = conditionLabel;
            currentElement.parentBranch = currentParentBranch;
            currentElement.conditionLabel = currentConditionLabel;

            // check all branches flowing from the current element
            let nbrBranches = currentElement.branchArray.length;
            if( nbrBranches > 1 ) {
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

                // skip dangling references and elements already visited
                let branchNextElement = actionMap.get( aBranch );
                if( ! branchNextElement || branchNextElement.index ) {
                    continue;
                }

                // continue in this branch, assigning index to elements,
                // recursively until all elements have indexes
                visit( branchNextElement, currentParentBranch, currentConditionLabel );
            }
        };

        let firstElement = actionMap.get( firstElementName );
        if( firstElement ) {
            visit( firstElement, firstElement, 'start' );
        }
    }

    return {
        FLOW_ELEMENT_TYPES
        , getValue
        , buildDefinitionMap
        , findElementByLabel
        , removeHTML
        , describeFlow
        , indexElements
    };
} )();

// allow unit tests (Node/Jest) to load this file directly
if( typeof module !== 'undefined' && module.exports ) {
    module.exports = globalThis.FlowParserShared;
}
