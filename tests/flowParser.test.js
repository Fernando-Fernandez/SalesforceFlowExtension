// Tests for the shared flow parser (scripts/flowParser.js).
// Unlike the other suites, these load the real production file.

const FlowParserShared = require('../scripts/flowParser.js');

describe('FlowParserShared', () => {

  describe('getValue', () => {
    test('should extract whichever value field is present', () => {
      expect(FlowParserShared.getValue({ stringValue: 'abc' })).toBe('abc');
      expect(FlowParserShared.getValue({ numberValue: 42 })).toBe(42);
      expect(FlowParserShared.getValue({ booleanValue: false })).toBe(false);
      expect(FlowParserShared.getValue({ elementReference: 'varName' })).toBe('varName');
      expect(FlowParserShared.getValue({ apexValue: 'apex' })).toBe('apex');
      expect(FlowParserShared.getValue({ sobjectValue: 'Account' })).toBe('Account');
    });

    test('should return the default for empty or missing values', () => {
      expect(FlowParserShared.getValue({}, 'null')).toBe('null');
      expect(FlowParserShared.getValue(null, 'null')).toBe('null');
      expect(FlowParserShared.getValue(undefined)).toBeUndefined();
    });
  });

  describe('buildDefinitionMap', () => {
    test('should index present collections and default missing ones to empty arrays', () => {
      const flowDefinition = {
        decisions: [{ name: 'Check' }],
        recordCreates: [{ name: 'Create' }]
      };

      const definitionMap = FlowParserShared.buildDefinitionMap(flowDefinition);

      expect(definitionMap.get('decisions')).toHaveLength(1);
      expect(definitionMap.get('recordCreates')).toHaveLength(1);
      // missing collections are safe to iterate
      expect(definitionMap.get('loops')).toEqual([]);
      expect(definitionMap.get('transforms')).toEqual([]);
      expect(definitionMap.size).toBe(FlowParserShared.FLOW_ELEMENT_TYPES.length);
    });
  });

  describe('findElementByLabel', () => {
    test('should find an element across collections and tag its type', () => {
      const definitionMap = FlowParserShared.buildDefinitionMap({
        screens: [{ name: 'S1', label: 'My Screen' }],
        recordLookups: [{ name: 'L1', label: 'Get Records' }]
      });

      const found = FlowParserShared.findElementByLabel(definitionMap, 'Get Records');

      expect(found.name).toBe('L1');
      expect(found.type).toBe('recordLookups');
    });

    test('should return null when no element matches', () => {
      const definitionMap = FlowParserShared.buildDefinitionMap({});
      expect(FlowParserShared.findElementByLabel(definitionMap, 'Nope')).toBeNull();
    });

    test('should return the first match even when the label is ambiguous', () => {
      const definitionMap = FlowParserShared.buildDefinitionMap({
        recordUpdates: [
          { name: 'Update_Record', label: 'Update Record' },
          { name: 'Update_Record0', label: 'Update Record' }
        ]
      });
      expect(FlowParserShared.findElementByLabel(definitionMap, 'Update Record').name)
        .toBe('Update_Record');
    });
  });

  describe('findElementsByLabel', () => {
    test('should return every element sharing a label, each tagged with its type', () => {
      const definitionMap = FlowParserShared.buildDefinitionMap({
        recordUpdates: [
          { name: 'Update_Record', label: 'Update Record' },
          { name: 'Update_Record0', label: 'Update Record' }
        ],
        screens: [{ name: 'S1', label: 'Update Record' }]
      });

      const matches = FlowParserShared.findElementsByLabel(definitionMap, 'Update Record');

      expect(matches.map(aMatch => aMatch.name))
        .toEqual(['Update_Record', 'Update_Record0', 'S1']);
      expect(matches.map(aMatch => aMatch.type))
        .toEqual(['recordUpdates', 'recordUpdates', 'screens']);
    });

    test('should return a single-element array for a unique label', () => {
      const definitionMap = FlowParserShared.buildDefinitionMap({
        recordLookups: [{ name: 'L1', label: 'Get Records' }]
      });
      expect(FlowParserShared.findElementsByLabel(definitionMap, 'Get Records'))
        .toHaveLength(1);
    });

    test('should return an empty array when nothing matches', () => {
      const definitionMap = FlowParserShared.buildDefinitionMap({});
      expect(FlowParserShared.findElementsByLabel(definitionMap, 'Nope')).toEqual([]);
    });
  });

  describe('resolveAmbiguousElement', () => {
    // two record updates share the label "Update Record"; one is followed by
    // End, the other by a screen
    function ambiguousFlow() {
      return {
        startElementReference: 'Start_Decision',
        decisions: [{
          name: 'Start_Decision', label: 'Start',
          defaultConnectorLabel: 'Else',
          defaultConnector: { targetReference: 'Update_Record0' },
          rules: [{ name: 'R', label: 'Yes',
            connector: { targetReference: 'Update_Record' } }]
        }],
        recordUpdates: [
          { name: 'Update_Record', label: 'Update Record', object: 'Account' },
          { name: 'Update_Record0', label: 'Update Record', object: 'Account',
            connector: { targetReference: 'Notify' } }
        ],
        screens: [{ name: 'Notify', label: 'Notify', fields: [] }]
      };
    }

    function matchesFor(flowDefinition, label) {
      return FlowParserShared.findElementsByLabel(
        FlowParserShared.buildDefinitionMap(flowDefinition), label);
    }

    test('should pick the element whose successor matches the assistive text', () => {
      const flow = ambiguousFlow();
      const matches = matchesFor(flow, 'Update Record');

      // "followed by Notify" identifies Update_Record0; "followed by End"
      // identifies Update_Record
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'On outcome (Else), followed by Notify, 1 incoming connector').name)
        .toBe('Update_Record0');
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'On outcome (Yes), followed by End, 1 incoming connector').name)
        .toBe('Update_Record');
    });

    test('should break a successor tie on the incoming-connector count', () => {
      // both share the label and both terminate (followed by End), so the
      // successor cannot tell them apart; A has one incoming connector, B two
      const flow = {
        startElementReference: 'Feed_A',
        recordLookups: [
          { name: 'Feed_A', label: 'Feed A', object: 'Account',
            connector: { targetReference: 'A' } },
          { name: 'Feed_B1', label: 'Feed B1', object: 'Account',
            connector: { targetReference: 'B' } },
          { name: 'Feed_B2', label: 'Feed B2', object: 'Account',
            connector: { targetReference: 'B' } }
        ],
        recordUpdates: [
          { name: 'A', label: 'Touch', object: 'Account' },
          { name: 'B', label: 'Touch', object: 'Account' }
        ]
      };
      const matches = FlowParserShared.findElementsByLabel(
        FlowParserShared.buildDefinitionMap(flow), 'Touch');

      // both are "followed by End"; B is reached by Feed_B1 and Feed_B2
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'followed by End, 2 incoming connectors').name).toBe('B');
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'followed by End, 1 incoming connector').name).toBe('A');
    });

    test('should return null when the text cannot single one out', () => {
      const flow = ambiguousFlow();
      const matches = matchesFor(flow, 'Update Record');
      // a successor that matches neither candidate -> no assumption
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'followed by Nowhere')).toBeNull();
      // no usable assistive text at all
      expect(FlowParserShared.resolveAmbiguousElement(flow, matches, '')).toBeNull();
      expect(FlowParserShared.resolveAmbiguousElement(flow, matches, undefined)).toBeNull();
    });

    test('should return null when there is nothing to disambiguate', () => {
      const flow = ambiguousFlow();
      const single = matchesFor(flow, 'Notify');
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, single, 'followed by End')).toBeNull();
    });

    test('should tell apart two terminal screens by fault path vs decision outcome', () => {
      // the real-world case: two "Error" screens that both end, one reached by
      // a fault path, the other by a decision outcome
      const flow = {
        startElementReference: 'Do_Work',
        recordCreates: [{
          name: 'Do_Work', label: 'Do Work', object: 'Account',
          connector: { targetReference: 'Check' },
          faultConnector: { targetReference: 'Error_Fault' }
        }],
        decisions: [{
          name: 'Check', label: 'Check', defaultConnectorLabel: 'No',
          defaultConnector: { targetReference: 'Error_Outcome' },
          rules: [{ name: 'Yes', label: 'Yes', connector: { targetReference: 'Done' } }]
        }],
        screens: [
          { name: 'Error_Fault', label: 'Error', fields: [] },
          { name: 'Error_Outcome', label: 'Error', fields: [] },
          { name: 'Done', label: 'Done', fields: [] }
        ]
      };
      const matches = matchesFor(flow, 'Error');
      expect(matches).toHaveLength(2);

      // the fault card's assistive text resolves to the fault-reached screen
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'On path (fault), followed by End, 1 incoming connector').name)
        .toBe('Error_Fault');
      // the outcome card (with the unsubstituted {0}) resolves to the other
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'On outcome ({0}), followed by End').name)
        .toBe('Error_Outcome');
    });

    test('should tell apart two elements on different named decision outcomes', () => {
      const flow = {
        startElementReference: 'Check',
        decisions: [{
          name: 'Check', label: 'Check', defaultConnectorLabel: 'Else',
          defaultConnector: { targetReference: 'Note_Else' },
          rules: [{ name: 'Hot', label: 'Hot', connector: { targetReference: 'Note_Hot' } }]
        }],
        screens: [
          { name: 'Note_Hot', label: 'Note', fields: [] },
          { name: 'Note_Else', label: 'Note', fields: [] }
        ]
      };
      const matches = matchesFor(flow, 'Note');
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'On outcome (Hot), followed by End').name).toBe('Note_Hot');
      expect(FlowParserShared.resolveAmbiguousElement(
        flow, matches, 'On outcome (Else), followed by End').name).toBe('Note_Else');
    });
  });

  describe('buildElementGraph', () => {
    test('should synthesize the Start element and label decision branches', () => {
      const flowDefinition = {
        startElementReference: 'Check',
        decisions: [{
          name: 'Check',
          label: 'Check Status',
          defaultConnectorLabel: 'Otherwise',
          rules: [{ label: 'Is Active', connector: { targetReference: 'Create_Task' } }]
        }],
        recordCreates: [{ name: 'Create_Task', label: 'Create Task', object: 'Task' }]
      };

      const { actionMap, firstElement } = FlowParserShared.buildElementGraph(flowDefinition);

      expect(firstElement.name).toBe('Start');
      expect(actionMap.get('Start').branchArray).toEqual(['Check']);
      // decisions always fork: default outcome first, then each rule
      const decision = actionMap.get('Check');
      expect(decision.branchArray).toEqual([undefined, 'Create_Task']);
      expect(decision.branchLabelArray[0]).toBe('after checking Check Status: Otherwise');
      expect(decision.branchLabelArray[1]).toBe('after checking Check Status: Is Active');
    });
  });

  describe('getFlowOverview / renderExplanation', () => {
    test('should narrate a record create behind a decision in the shared voice', () => {
      const flowDefinition = {
        startElementReference: 'Check',
        decisions: [{
          name: 'Check',
          label: 'Check Status',
          rules: [{ label: 'Is Active', connector: { targetReference: 'Create_Task' } }]
        }],
        recordCreates: [{ name: 'Create_Task', label: 'Create Task', object: 'Task' }]
      };

      const { facts } = FlowParserShared.getFlowOverview(flowDefinition);
      const lines = FlowParserShared.renderExplanation(facts);

      expect(lines).toEqual(['inserts Task record after checking Check Status: Is Active']);
    });

    test('should mark loop-body operations and narrate the loop context', () => {
      const flowDefinition = {
        startElementReference: 'Loop_Items',
        loops: [{
          name: 'Loop_Items',
          label: 'Loop Items',
          nextValueConnector: { targetReference: 'Update_Item' }
        }],
        recordUpdates: [{ name: 'Update_Item', label: 'Update Item', object: 'Contact' }]
      };

      const { facts } = FlowParserShared.getFlowOverview(flowDefinition);

      expect(facts).toHaveLength(1);
      expect(facts[0].insideLoop).toBe(true);
      expect(FlowParserShared.renderExplanation(facts))
        .toEqual(['updates Contact record for each item in Loop Items']);
    });

    test('should narrate assignments that touch input/output variables', () => {
      const flowDefinition = {
        startElementReference: 'Set_Result',
        variables: [
          { name: 'varResult', dataType: 'String', isInput: false, isOutput: true },
          { name: 'varInput', dataType: 'String', isInput: true, isOutput: false },
          { name: 'varScratch', dataType: 'String', isInput: false, isOutput: false }
        ],
        assignments: [{
          name: 'Set_Result', label: 'Set Result',
          assignmentItems: [
            // writes an output variable from an input variable's field
            { assignToReference: 'varResult', operator: 'Assign', value: { elementReference: 'varInput.Name' } }
          ],
          connector: { targetReference: 'Set_Scratch' }
        }, {
          name: 'Set_Scratch', label: 'Set Scratch',
          assignmentItems: [
            // internal bookkeeping only, must stay silent
            { assignToReference: 'varScratch', operator: 'Assign', value: { stringValue: 'x' } }
          ]
        }]
      };

      const { facts } = FlowParserShared.getFlowOverview(flowDefinition);
      const lines = FlowParserShared.renderExplanation(facts);

      expect(lines).toEqual(['assigns varResult, varInput']);
    });

    test('should not throw on flows with sparse element collections', () => {
      const flowDefinition = {
        startElementReference: 'Update_It',
        recordUpdates: [{ name: 'Update_It', label: 'Update It', inputReference: 'record' }]
      };
      expect(() => FlowParserShared.getFlowOverview(flowDefinition)).not.toThrow();
    });

    test('should return empty facts when the start element is unresolvable', () => {
      const { facts } = FlowParserShared.getFlowOverview({});
      expect(facts).toEqual([]);
    });

    test('should not mutate the flow definition (it must stay serializable)', () => {
      // content.js sends flowDefinition through chrome.runtime.sendMessage after
      // the start-node tooltip may have built the graph; parentBranch cycles on
      // the original objects made it unserializable (reported as
      // "Could not serialize message")
      const flowDefinition = {
        startElementReference: 'Check',
        decisions: [{
          name: 'Check',
          label: 'Check Status',
          rules: [{ label: 'Is Active', connector: { targetReference: 'Create_Task' } }]
        }],
        recordCreates: [{ name: 'Create_Task', label: 'Create Task', object: 'Task' }]
      };

      FlowParserShared.getFlowOverview(flowDefinition);

      expect(() => JSON.stringify(flowDefinition)).not.toThrow();
      expect(flowDefinition.recordCreates[0].branchArray).toBeUndefined();
      expect(flowDefinition.recordCreates[0].parentBranch).toBeUndefined();
      expect(flowDefinition.start).toBeUndefined();
    });
  });

  describe('generateMermaidDiagram', () => {
    function makeOverview(flowDefinition) {
      const { actionMap } = FlowParserShared.getFlowOverview(flowDefinition);
      return actionMap;
    }

    test('should render shaped nodes with tooltip explanations and labeled edges', () => {
      const actionMap = makeOverview({
        startElementReference: 'Check',
        decisions: [{
          name: 'Check',
          label: 'Check Status',
          rules: [{ label: 'Is Active', connector: { targetReference: 'Create_Task' } }]
        }],
        recordCreates: [{
          name: 'Create_Task', label: 'Create Task', object: 'Task',
          faultConnector: { targetReference: 'Check' }
        }]
      });

      const diagram = FlowParserShared.generateMermaidDiagram(actionMap, 'My Flow');

      expect(diagram).toContain('title: "My Flow"');
      expect(diagram).toContain('flowchart TD');
      // start is a stadium, the decision a diamond, the create a rectangle
      expect(diagram).toContain('Start(["Start"])');
      expect(diagram).toContain('Check{"Check Status<br/>(decision)"}');
      expect(diagram).toContain('Create_Task["Create Task<br/>(recordCreate)<br/>inserts Task record"]');
      // edges carry the branch labels; the fault path is dotted
      expect(diagram).toContain('Start --> Check');
      expect(diagram).toContain('Check -->|"after checking Check Status: Is Active"| Create_Task');
      expect(diagram).toContain('Create_Task -.->|"if Create Task fails"| Check');
    });

    test('should escape quotes and pipes in labels', () => {
      const actionMap = makeOverview({
        startElementReference: 'Get_It',
        recordLookups: [{ name: 'Get_It', label: 'Get "A|B" Records', object: 'Account' }]
      });

      const diagram = FlowParserShared.generateMermaidDiagram(actionMap);

      expect(diagram).toContain('Get_It["Get #quot;A/B#quot; Records');
      expect(diagram).not.toContain('"A|B"');
    });

    test('should skip edges to dangling targets and non-canvas elements', () => {
      const actionMap = makeOverview({
        startElementReference: 'Assign_It',
        assignments: [{
          name: 'Assign_It', label: 'Assign It',
          assignmentItems: [],
          connector: { targetReference: 'Gone' }
        }],
        variables: [{ name: 'varX', dataType: 'String' }]
      });

      const diagram = FlowParserShared.generateMermaidDiagram(actionMap);

      expect(diagram).not.toContain('Gone');
      expect(diagram).not.toContain('varX');
    });
  });

  describe('lintFlow', () => {
    function lint(flowDefinition) {
      const { actionMap } = FlowParserShared.getFlowOverview(flowDefinition);
      return FlowParserShared.lintFlow(flowDefinition, actionMap);
    }

    test('should warn about DML inside a loop', () => {
      const issues = lint({
        description: 'documented',
        startElementReference: 'Loop_Items',
        loops: [{
          name: 'Loop_Items', label: 'Loop Items', description: 'd',
          nextValueConnector: { targetReference: 'Update_Item' }
        }],
        recordUpdates: [{
          name: 'Update_Item', label: 'Update Item', object: 'Contact', description: 'd',
          faultConnector: { targetReference: 'Loop_Items' }
        }]
      });

      expect(issues.some(i => i.severity === 'warning'
        && i.message.includes('Update_Item')
        && i.message.includes('inside a loop'))).toBe(true);
    });

    test('should flag DML without a fault path', () => {
      const issues = lint({
        description: 'documented',
        startElementReference: 'Create_Task',
        recordCreates: [{ name: 'Create_Task', label: 'Create Task', object: 'Task', description: 'd' }]
      });

      expect(issues.some(i => i.severity === 'info'
        && i.message.includes('Create_Task')
        && i.message.includes('no fault path'))).toBe(true);
    });

    test('should flag hardcoded record ids in filters', () => {
      const issues = lint({
        description: 'documented',
        startElementReference: 'Get_Account',
        recordLookups: [{
          name: 'Get_Account', label: 'Get Account', object: 'Account', description: 'd',
          filters: [{ field: 'Id', value: { stringValue: '0013000000abcDE' } }]
        }]
      });

      expect(issues.some(i => i.severity === 'warning'
        && i.message.includes('hardcoded record id "0013000000abcDE"'))).toBe(true);
    });

    test('should not mistake ordinary strings for record ids', () => {
      const issues = lint({
        description: 'documented',
        startElementReference: 'Get_Account',
        recordLookups: [{
          name: 'Get_Account', label: 'Get Account', object: 'Account', description: 'd',
          filters: [{ field: 'Name', value: { stringValue: 'AcmeCorporation' } }]
        }]
      });

      expect(issues.some(i => i.message.includes('hardcoded record id'))).toBe(false);
    });

    test('should flag unreachable elements and missing descriptions', () => {
      const issues = lint({
        startElementReference: 'Get_Account',
        recordLookups: [{ name: 'Get_Account', label: 'Get Account', object: 'Account' }],
        assignments: [{ name: 'Orphan', label: 'Orphan' }]
      });

      expect(issues.some(i => i.severity === 'warning'
        && i.message.includes('Orphan')
        && i.message.includes('unreachable'))).toBe(true);
      expect(issues.some(i => i.message === 'The flow has no description.')).toBe(true);
      expect(issues.some(i => i.message.includes('have no description'))).toBe(true);
    });

    test('should flag canvas elements that share the same label', () => {
      const issues = lint({
        description: 'documented',
        startElementReference: 'Update_Record',
        recordUpdates: [
          { name: 'Update_Record', label: 'Update Record', object: 'Account', description: 'd',
            connector: { targetReference: 'Update_Record0' } },
          { name: 'Update_Record0', label: 'Update Record', object: 'Account', description: 'd' }
        ]
      });

      expect(issues.some(i => i.severity === 'warning'
        && i.message.includes('share the label "Update Record"')
        && i.message.includes('Update_Record, Update_Record0'))).toBe(true);
    });

    test('should not flag a label that is unique', () => {
      const issues = lint({
        description: 'documented',
        startElementReference: 'Get_Account',
        recordLookups: [{ name: 'Get_Account', label: 'Get Account', object: 'Account', description: 'd' }]
      });

      expect(issues.some(i => i.message.includes('share the label'))).toBe(false);
    });
  });

  describe('indexElements', () => {
    function makeActionMap() {
      const elements = [
        { name: 'Start', branchArray: ['A'], branchLabelArray: ['from start'] },
        { name: 'A', branchArray: ['B', 'C', 'Missing'], branchLabelArray: ['rule 1', 'rule 2', 'rule 3'] },
        { name: 'B', branchArray: [], branchLabelArray: [] },
        { name: 'C', branchArray: ['B'], branchLabelArray: [] }
      ];
      return new Map(elements.map(e => [e.name, e]));
    }

    test('should assign sequential indexes following all branches', () => {
      const actionMap = makeActionMap();

      FlowParserShared.indexElements(actionMap, 'Start');

      expect(actionMap.get('Start').index).toBe(1);
      expect(actionMap.get('A').index).toBe(2);
      expect(actionMap.get('B').index).toBe(3);
      expect(actionMap.get('C').index).toBe(4);
    });

    test('should link elements to their parent branch and condition', () => {
      const actionMap = makeActionMap();

      FlowParserShared.indexElements(actionMap, 'Start');

      expect(actionMap.get('Start').conditionLabel).toBe('start');
      // A is the fork, so B and C belong to it with their branch labels
      expect(actionMap.get('B').parentBranch).toBe(actionMap.get('A'));
      expect(actionMap.get('B').conditionLabel).toBe('rule 1');
      expect(actionMap.get('C').conditionLabel).toBe('rule 2');
    });

    test('should skip dangling branch references without throwing', () => {
      // branch 'Missing' has no element in the map
      const actionMap = makeActionMap();
      expect(() => FlowParserShared.indexElements(actionMap, 'Start')).not.toThrow();
    });

    test('should do nothing when the first element is missing', () => {
      expect(() => FlowParserShared.indexElements(new Map(), 'Nope')).not.toThrow();
    });
  });
});
