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

    // finds every flow element matching a label across all collections,
    // tagging each with its type name; more than one means the label is
    // ambiguous (different API names, same label), which the DOM hover
    // cannot tell apart since Salesforce does not expose the API name
    function findElementsByLabel( definitionMap, label ) {
        const matches = [];
        for( const [ typeName, elements ] of definitionMap ) {
            elements.forEach( anElement => {
                if( anElement.label === label ) {
                    anElement.type = typeName;
                    matches.push( anElement );
                }
            } );
        }
        return matches;
    }

    // convenience for callers that only need the first match
    function findElementByLabel( definitionMap, label ) {
        return findElementsByLabel( definitionMap, label )[ 0 ] ?? null;
    }

    // parses the auto-layout card's assistive text into a topology signature.
    // Examples:
    //   "On path (fault), followed by End, 1 incoming connector"
    //   "On outcome ({0}), followed by End"
    // Recognized fields: the connector kind it is reached by (fault path vs
    // decision outcome), the specific outcome label when Salesforce renders a
    // real one (not the "{0}" placeholder), the element it is followed by, and
    // the incoming-connector count.  Returns null when nothing usable is
    // present so callers make no assumptions.
    function parseAutoLayoutTopology( assistiveText ) {
        if( ! assistiveText ) {
            return null;
        }
        const signature = {};

        // "On path (fault)" -> reached by a fault connector;
        // "On outcome (Yes)" -> reached by a decision outcome connector
        const reachedBy = /On (path|outcome) \(([^)]*)\)/i.exec( assistiveText );
        if( reachedBy ) {
            const kind = reachedBy[ 1 ].toLowerCase();
            const name = reachedBy[ 2 ].trim();
            if( kind === 'outcome' ) {
                signature.incomingType = 'outcome';
                // ignore the unsubstituted placeholder Salesforce sometimes leaves
                if( name && name !== '{0}' ) {
                    signature.outcomeLabel = name;
                }
            } else if( /fault/i.test( name ) ) {
                signature.incomingType = 'fault';
            }
        }

        const followedBy = /followed by (.+?)\s*(?:,|$)/i.exec( assistiveText );
        if( followedBy ) {
            signature.followedBy = followedBy[ 1 ].trim();
        }
        const incoming = /(\d+)\s+incoming connector/i.exec( assistiveText );
        if( incoming ) {
            signature.inDegree = Number( incoming[ 1 ] );
        }

        return Object.keys( signature ).length > 0 ? signature : null;
    }

    // the label of the element this one flows into via its primary (success
    // or default) connector; "End" when there is no onward connector, or
    // null when the target is not a known element (so we never guess)
    function primarySuccessorLabel( element, definitionMap ) {
        const target = element.connector?.targetReference
                    ?? element.defaultConnector?.targetReference;
        if( ! target ) {
            return 'End';
        }
        for( const elements of definitionMap.values() ) {
            const found = elements.find( anElement => anElement.name === target );
            if( found ) {
                return found.label ?? null;
            }
        }
        return null;
    }

    // counts incoming connectors per element name across the whole graph
    function computeInDegrees( actionMap ) {
        const inDegree = new Map();
        for( const element of actionMap.values() ) {
            ( element.branchArray ?? [] ).forEach( target => {
                if( target ) {
                    inDegree.set( target, ( inDegree.get( target ) ?? 0 ) + 1 );
                }
            } );
        }
        return inDegree;
    }

    // classifies, per element name, the kinds of connectors that lead INTO it
    // ('fault' from a fault path, 'outcome' from a decision rule/default, and
    // 'normal' otherwise) plus the decision outcome labels — this mirrors the
    // "On path (fault)" / "On outcome (Yes)" prefix in the auto-layout card
    function classifyIncomingConnectors( definitionMap ) {
        const byName = new Map();
        const record = ( target, type, outcomeLabel ) => {
            if( ! target ) {
                return;
            }
            let entry = byName.get( target );
            if( ! entry ) {
                entry = { types: new Set(), outcomes: new Set() };
                byName.set( target, entry );
            }
            entry.types.add( type );
            if( outcomeLabel ) {
                entry.outcomes.add( outcomeLabel );
            }
        };

        for( const elements of definitionMap.values() ) {
            elements.forEach( element => {
                record( element.faultConnector?.targetReference, 'fault' );

                // decision outcomes:  each rule and the default outcome
                ( element.rules ?? [] ).forEach( aRule =>
                    record( aRule.connector?.targetReference, 'outcome', aRule.label ) );
                if( element.rules && element.defaultConnector?.targetReference ) {
                    record( element.defaultConnector.targetReference, 'outcome'
                        , element.defaultConnectorLabel );
                }

                // ordinary forward paths
                record( element.connector?.targetReference, 'normal' );
                record( element.nextValueConnector?.targetReference, 'normal' );
                record( element.noMoreValuesConnector?.targetReference, 'normal' );
                ( element.waitEvents ?? [] ).forEach( aWait =>
                    record( aWait.connector?.targetReference, 'normal' ) );
                ( element.scheduledPaths ?? [] ).forEach( aPath =>
                    record( aPath.connector?.targetReference, 'normal' ) );
            } );
        }
        return byName;
    }

    // best-effort disambiguation of several same-label elements (auto-layout
    // only) using the card's assistive topology text.  Applies each available
    // signal as a successive filter — the element it is followed by, the kind
    // of connector it is reached by, the specific decision outcome, then the
    // incoming-connector count — and returns a match only when exactly one
    // candidate remains.  If any signal agrees with no candidate (our reading
    // disagrees with the metadata) it bails to null, so the caller keeps the
    // first match and shows the duplicate warning rather than guessing.
    function resolveAmbiguousElement( flowDefinition, matches, assistiveText ) {
        const observed = parseAutoLayoutTopology( assistiveText );
        if( ! observed || ! Array.isArray( matches ) || matches.length < 2 ) {
            return null;
        }

        const definitionMap = buildDefinitionMap( flowDefinition );
        const incomingByName = classifyIncomingConnectors( definitionMap );
        let inDegree = null;

        const filters = [];
        if( observed.followedBy !== undefined ) {
            filters.push( aCandidate =>
                primarySuccessorLabel( aCandidate, definitionMap ) === observed.followedBy );
        }
        if( observed.incomingType ) {
            filters.push( aCandidate =>
                !! incomingByName.get( aCandidate.name )?.types.has( observed.incomingType ) );
        }
        if( observed.outcomeLabel ) {
            filters.push( aCandidate =>
                !! incomingByName.get( aCandidate.name )?.outcomes.has( observed.outcomeLabel ) );
        }
        if( observed.inDegree !== undefined ) {
            filters.push( aCandidate => {
                if( ! inDegree ) {
                    inDegree = computeInDegrees( buildElementGraph( flowDefinition ).actionMap );
                }
                return ( inDegree.get( aCandidate.name ) ?? 0 ) === observed.inDegree;
            } );
        }

        let candidates = matches;
        for( const aFilter of filters ) {
            const narrowed = candidates.filter( aFilter );
            // a signal that matches nothing means our reading is off; make no
            // assumption rather than risk surfacing the wrong element
            if( narrowed.length === 0 ) {
                return null;
            }
            candidates = narrowed;
            if( candidates.length === 1 ) {
                return candidates[ 0 ];
            }
        }

        return null;
    }

    function removeHTML( aValue ) {
        return aValue.replaceAll( /\<\/?.*?\>/g, '' );
    }

    // describes what a screen element displays and prompts for
    function describeScreen( aScreen ) {
        const fields = aScreen.fields ?? [];
        const inputFields = fields.filter( aField => aField.fieldType !== "DisplayText" )
                                    .map( aField => aField.fieldText ??
                                                        aField.name ?? aField.extensionName )
                                    .join( ", " );
        const displayFields = fields.filter( aField => ( aField.fieldType == "ComponentInstance"
                                                            || aField.fieldType == "DisplayText" )
                                                        && aField.fieldText )
                                    .map( aField => aField.fieldText ??
                                                        aField.name ?? aField.extensionName )
                                    .join( ", " );
        return ( displayFields ? "displaying:  " + removeHTML( displayFields ) : "" )
                + ( inputFields && displayFields ? " and " : "" )
                + ( inputFields ? "prompting the user for these fields:  " + inputFields : "" );
    }

    // builds a graph of all flow elements indexed by name, with a synthesized
    // Start element and the branches flowing out of each element labeled in
    // plain English; indexElements propagates the labels to downstream
    // elements as their condition context.
    // the graph holds shallow COPIES of the definition's elements:  the graph
    // gains object cross-references (parentBranch cycles), and mutating the
    // definition would make it unserializable for chrome.runtime.sendMessage
    function buildElementGraph( flowDefinition ) {
        const definitionMap = buildDefinitionMap( flowDefinition );

        // synthesize the start element
        let startTarget = flowDefinition.startElementReference
                        ?? flowDefinition.start?.connector?.targetReference;
        let firstElement = { ...( flowDefinition.start ?? { connector: { targetReference: startTarget } } ) };
        firstElement.name = 'Start';
        firstElement.type = 'start';
        firstElement.branchArray = [];
        firstElement.branchLabelArray = [];
        if( firstElement.connector?.targetReference ) {
            firstElement.branchArray.push( firstElement.connector.targetReference );
            firstElement.branchLabelArray.push( firstElement.scheduledPaths?.length ?
                                                'when triggered immediately' : '' );
        }
        firstElement.scheduledPaths?.forEach( s => {
            firstElement.branchArray.push( s.connector?.targetReference );
            firstElement.branchLabelArray.push( `on scheduled path ${ s.label }` );
        } );

        const actionMap = new Map();
        actionMap.set( firstElement.name, firstElement );

        for( const [ typeName, array ] of definitionMap ) {
            for( const sourceElement of array ) {
                const element = { ...sourceElement };

                // singular type name, e.g. recordCreates -> recordCreate
                element.type = typeName.substring( 0, typeName.length - 1 );

                element.nextElement = element.connector?.targetReference
                                    ?? element.defaultConnector?.targetReference;

                // list the branches of execution
                element.branchArray = [];
                element.branchLabelArray = [];

                if( element.type === 'decision' ) {
                    // the default outcome exists even without a connector, so
                    // downstream elements always inherit the decision context
                    element.branchArray.push( element.defaultConnector?.targetReference );
                    element.branchLabelArray.push( `after checking ${ element.label }: `
                                        + ( element.defaultConnectorLabel ?? 'default outcome' ) );
                } else if( element.nextElement != undefined ) {
                    element.branchArray.push( element.nextElement );
                    element.branchLabelArray.push( `after ${ element.label } succeeds` );
                }

                if( element.faultConnector?.targetReference ) {
                    element.faultElement = element.faultConnector.targetReference;
                    element.branchArray.push( element.faultElement );
                    element.branchLabelArray.push( `if ${ element.label } fails` );
                }

                if( element.type === 'loop' ) {
                    element.branchArray.push( element.nextValueConnector?.targetReference );
                    element.branchLabelArray.push( `for each item in ${ element.label }` );
                    element.branchArray.push( element.noMoreValuesConnector?.targetReference );
                    element.branchLabelArray.push( `after ${ element.label } finishes iterating` );
                }

                if( element.type === 'wait' ) {
                    element.waitEvents?.forEach( w => {
                        element.branchArray.push( w.connector?.targetReference );
                        element.branchLabelArray.push( `after event ${ w.label }` );
                    } );
                }

                element.rules?.forEach( r => {
                    element.branchArray.push( r.connector?.targetReference );
                    element.branchLabelArray.push( `after checking ${ element.label }: ${ r.label }` );
                } );

                actionMap.set( element.name, element );
            }
        }

        return { actionMap, firstElement };
    }

    // phrase describing what an element does, or null for elements that have
    // no observable behavior worth narrating; interfaceVariables holds the
    // names of the flow's input/output variables
    function getActionText( element, interfaceVariables = new Set() ) {
        switch( element.type ) {
            case 'recordCreate':   return `inserts ${ element.object ?? element.inputReference } record`;
            case 'recordUpdate':   return `updates ${ element.object ?? element.inputReference } record`;
            case 'recordDelete':   return `deletes ${ element.object ?? element.inputReference } record`;
            case 'recordRollback': return 'rolls back the pending record changes';
            case 'recordLookup':   return `queries ${ element.object } records`;
            case 'actionCall':     return `calls action ${ element.actionName } (${ element.actionType })`;
            case 'subflow':        return `calls flow ${ element.flowName ?? element.name }`;
            case 'transform':      return `transforms ${ element.objectType ?? element.dataType }`;
            case 'screen': {
                const screenDescription = describeScreen( element );
                return `prompts screen ${ element.label }`
                        + ( screenDescription ? ', ' + screenDescription : '' );
            }
            case 'assignment': {
                // only assignments touching the flow's input/output variables
                // are part of its contract; internal bookkeeping stays silent
                const interfaceVarsTouched = getReferencedInterfaceVariables(
                                                element, interfaceVariables );
                if( interfaceVarsTouched.length === 0 ) {
                    return null;
                }
                return `assigns ${ interfaceVarsTouched.join( ', ' ) }`;
            }
        }
        return null;
    }

    // the input/output variables an assignment writes to or reads from;
    // references may be dotted (varName.field), the root is what matters
    function getReferencedInterfaceVariables( element, interfaceVariables ) {
        const referenced = new Set();
        element.assignmentItems?.forEach( anItem => {
            const target = anItem.assignToReference?.split( '.' )[ 0 ];
            if( interfaceVariables.has( target ) ) {
                referenced.add( target );
            }
            const source = anItem.value?.elementReference?.split( '.' )[ 0 ];
            if( interfaceVariables.has( source ) ) {
                referenced.add( source );
            }
        } );
        return [ ...referenced ];
    }

    // walks up the chain of branches an element inherited to detect whether
    // it executes inside a loop body
    function isInsideLoop( element ) {
        const seen = new Set();
        let current = element;
        while( current && ! seen.has( current ) ) {
            seen.add( current );
            if( current.conditionLabel?.startsWith( 'for each item in' ) ) {
                return true;
            }
            current = current.parentBranch;
        }
        return false;
    }

    // extracts structured facts (what the flow does and under which branch)
    // from a graph already indexed by indexElements, in execution order;
    // consumed by the explanation renderer and available to the linter
    // the flow's contract:  variables marked as input or output
    function collectInterfaceVariables( actionMap ) {
        const interfaceVariables = new Set();
        for( const [ name, element ] of actionMap ) {
            if( element.type === 'variable' && ( element.isInput || element.isOutput ) ) {
                interfaceVariables.add( name );
            }
        }
        return interfaceVariables;
    }

    function extractFacts( actionMap ) {
        const facts = [];

        const interfaceVariables = collectInterfaceVariables( actionMap );

        const orderedElements = [ ...actionMap.values() ]
                                    .filter( anElement => anElement.index )
                                    .sort( ( a, b ) => a.index - b.index );
        for( const element of orderedElements ) {
            const actionText = getActionText( element, interfaceVariables );
            if( ! actionText ) {
                continue;
            }
            facts.push( {
                name: element.name
                , label: element.label
                , type: element.type
                , actionText: actionText
                , conditionLabel: ( ! element.conditionLabel || element.conditionLabel === 'start'
                                        ? '' : element.conditionLabel )
                , insideLoop: isInsideLoop( element )
                , hasFaultPath: !! element.faultConnector?.targetReference
            } );
        }
        return facts;
    }

    // renders the facts as plain-English sentences:  the single voice used by
    // the start-node tooltip, the popup explanation and the GPT prompt
    function renderExplanation( facts ) {
        return facts.map( aFact => aFact.actionText
                            + ( aFact.conditionLabel ? ' ' + aFact.conditionLabel : '' ) );
    }

    // convenience:  graph + execution order + facts in one call
    function getFlowOverview( flowDefinition ) {
        const { actionMap, firstElement } = buildElementGraph( flowDefinition );
        indexElements( actionMap, firstElement.name );
        const facts = extractFacts( actionMap );
        return { actionMap, firstElement, facts };
    }

    const DML_TYPES = new Set( [ 'recordCreate', 'recordUpdate', 'recordDelete' ] );
    // canvas element types that participate in the connector graph
    const CONNECTABLE_TYPES = new Set( [ 'recordLookup', 'recordCreate', 'recordUpdate'
        , 'recordDelete', 'recordRollback', 'assignment', 'decision', 'screen', 'loop'
        , 'step', 'subflow', 'actionCall', 'apexPluginCall', 'collectionProcessor'
        , 'transform', 'wait' ] );
    // 15 or 18 alphanumeric characters; combined with a digit check on the
    // 3-character key prefix to limit false positives on ordinary words
    const RECORD_ID_REGEX = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

    function looksLikeRecordId( aString ) {
        return RECORD_ID_REGEX.test( aString ) && /[0-9]/.test( aString.substring( 0, 3 ) );
    }

    // string literals an element compares against or assigns
    function collectStringValues( element ) {
        const strings = [];
        const pushString = ( aValue ) => {
            if( aValue?.stringValue ) {
                strings.push( aValue.stringValue );
            }
        };
        pushString( element.value );
        element.filters?.forEach( aFilter => pushString( aFilter.value ) );
        element.inputAssignments?.forEach( anAssignment => pushString( anAssignment.value ) );
        element.assignmentItems?.forEach( anItem => pushString( anItem.value ) );
        element.inputParameters?.forEach( aParameter => pushString( aParameter.value ) );
        element.rules?.forEach( aRule =>
            aRule.conditions?.forEach( aCondition => pushString( aCondition.rightValue ) ) );
        return strings;
    }

    // inspects the indexed graph for common flow anti-patterns
    function lintFlow( flowDefinition, actionMap ) {
        const issues = [];

        if( ! flowDefinition.description ) {
            issues.push( { severity: 'info'
                , message: 'The flow has no description.' } );
        }

        let undescribedCount = 0;
        // collect canvas-element labels to catch duplicates (same label,
        // different API names), which the hover and metadata lookups cannot
        // tell apart since Salesforce does not expose the API name
        const namesByLabel = new Map();
        for( const [ name, element ] of actionMap ) {
            if( element.type === 'start' ) {
                continue;
            }

            if( element.label && CONNECTABLE_TYPES.has( element.type ) ) {
                const sharing = namesByLabel.get( element.label ) ?? [];
                sharing.push( name );
                namesByLabel.set( element.label, sharing );
            }

            const isDML = DML_TYPES.has( element.type );
            const isDataOperation = isDML || element.type === 'recordLookup'
                                    || element.type === 'actionCall';

            // DML, queries and callouts inside loops hit governor limits
            if( isDataOperation && isInsideLoop( element ) ) {
                issues.push( { severity: 'warning'
                    , message: `${ name }: ${ element.type } runs inside a loop`
                        + ' — consider collecting records and operating on them after the loop.' } );
            }

            // DML and actions without a fault path abort the flow on error
            if( ( isDML || element.type === 'actionCall' )
                    && ! element.faultConnector?.targetReference ) {
                issues.push( { severity: 'info'
                    , message: `${ name }: no fault path — an error here stops the flow with an unhandled fault.` } );
            }

            // canvas elements no path reaches
            if( ! element.index && CONNECTABLE_TYPES.has( element.type ) ) {
                issues.push( { severity: 'warning'
                    , message: `${ name }: unreachable — no path from Start leads to this element.` } );
            }

            // hardcoded record ids break across orgs and sandboxes
            collectStringValues( element ).forEach( aString => {
                if( looksLikeRecordId( aString ) ) {
                    issues.push( { severity: 'warning'
                        , message: `${ name }: hardcoded record id "${ aString }" — ids differ between orgs and sandboxes.` } );
                }
            } );

            if( ! element.description && CONNECTABLE_TYPES.has( element.type ) ) {
                undescribedCount++;
            }
        }

        if( undescribedCount > 0 ) {
            issues.push( { severity: 'info'
                , message: `${ undescribedCount } element(s) have no description.` } );
        }

        for( const [ label, names ] of namesByLabel ) {
            if( names.length > 1 ) {
                issues.push( { severity: 'warning'
                    , message: `${ names.length } elements share the label "${ label }"`
                        + ` (${ names.join( ', ' ) }) — the hover and metadata lookups cannot tell them apart.` } );
            }
        }

        return issues;
    }

    // mermaid labels: quotes and pipes would terminate the quoted string or
    // the edge label, everything else is legal inside double quotes
    function escapeMermaid( text ) {
        return String( text ).replaceAll( '"', '#quot;' ).replaceAll( '|', '/' );
    }

    // renders the full element graph as a mermaid flowchart:  one shaped node
    // per canvas element carrying the same explanation the tooltips show, and
    // one labeled edge per branch (fault paths dotted)
    function generateMermaidDiagram( actionMap, title ) {
        const interfaceVariables = collectInterfaceVariables( actionMap );
        const lines = [];
        if( title ) {
            lines.push( '---' );
            lines.push( `title: "${ escapeMermaid( title ) }"` );
            lines.push( '---' );
        }
        lines.push( 'flowchart TD' );

        const isDiagramNode = ( element ) =>
            element.type === 'start' || CONNECTABLE_TYPES.has( element.type );

        // nodes
        for( const [ name, element ] of actionMap ) {
            if( ! isDiagramNode( element ) ) {
                continue;
            }
            const textLines = [ element.label ?? element.name ];
            if( element.type !== 'start' ) {
                textLines.push( `(${ element.type })` );
            }
            const actionText = getActionText( element, interfaceVariables );
            if( actionText ) {
                textLines.push( actionText );
            }
            const text = escapeMermaid( textLines.join( '<br/>' ) );

            let nodeDefinition;
            if( element.type === 'start' ) {
                nodeDefinition = `${ name }(["${ text }"])`;
            } else if( element.type === 'decision' ) {
                nodeDefinition = `${ name }{"${ text }"}`;
            } else if( element.type === 'loop' ) {
                nodeDefinition = `${ name }{{"${ text }"}}`;
            } else {
                nodeDefinition = `${ name }["${ text }"]`;
            }
            lines.push( '    ' + nodeDefinition );
        }

        // edges, labeled with the same branch phrases the explanations use
        for( const [ name, element ] of actionMap ) {
            if( ! isDiagramNode( element ) ) {
                continue;
            }
            element.branchArray?.forEach( ( target, branchIndex ) => {
                if( ! target || ! actionMap.has( target ) ) {
                    return;
                }
                const label = element.branchLabelArray?.[ branchIndex ];
                const isFaultBranch = ( target === element.faultElement
                                        && label?.startsWith( 'if ' ) );
                const arrow = ( isFaultBranch ? '-.->' : '-->' );
                const labelPart = ( label ? `|"${ escapeMermaid( label ) }"|` : '' );
                lines.push( `    ${ name } ${ arrow }${ labelPart } ${ target }` );
            } );
        }

        return lines.join( '\n' );
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
        , findElementsByLabel
        , resolveAmbiguousElement
        , removeHTML
        , describeScreen
        , buildElementGraph
        , extractFacts
        , renderExplanation
        , getFlowOverview
        , lintFlow
        , generateMermaidDiagram
        , indexElements
    };
} )();

// allow unit tests (Node/Jest) to load this file directly
if( typeof module !== 'undefined' && module.exports ) {
    module.exports = globalThis.FlowParserShared;
}
