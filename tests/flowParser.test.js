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
  });

  describe('describeFlow', () => {
    test('should describe a record create behind a decision', () => {
      const flowDefinition = {
        startElementReference: 'Check',
        decisions: [{
          name: 'Check',
          label: 'Check Status',
          rules: [{
            label: 'Is Active',
            connector: { targetReference: 'Create_Task' },
            conditions: []
          }]
        }],
        recordCreates: [{
          name: 'Create_Task',
          label: 'Create Task',
          object: 'Task'
        }]
      };
      const definitionMap = FlowParserShared.buildDefinitionMap(flowDefinition);

      const descriptions = FlowParserShared.describeFlow(flowDefinition, definitionMap);

      expect(descriptions).toHaveLength(1);
      expect(descriptions[0]).toContain('inserts Task record');
      expect(descriptions[0]).toContain('after checking Check Status: Is Active');
    });

    test('should not throw on flows with sparse element collections', () => {
      // older content.js crashed when any collection was undefined
      const flowDefinition = {
        startElementReference: 'Update_It',
        recordUpdates: [{ name: 'Update_It', label: 'Update It', inputReference: 'record' }]
      };
      const definitionMap = FlowParserShared.buildDefinitionMap(flowDefinition);

      expect(() => FlowParserShared.describeFlow(flowDefinition, definitionMap)).not.toThrow();
    });

    test('should return empty array when the start element is unresolvable', () => {
      const definitionMap = FlowParserShared.buildDefinitionMap({});
      expect(FlowParserShared.describeFlow({}, definitionMap)).toEqual([]);
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
