// Integration test: loads the real scripts/popup.js + scripts/flowParser.js in
// jsdom, delivers a flow definition through the message listener, and asserts
// the page renders. Guards against parse() exceptions leaving a blank popup.

describe('popup parse integration', () => {
  let messageListener;

  beforeAll(() => {
    // the element ids popup.js caches at load (mirrors popup.html)
    document.body.innerHTML = `
      <div id="flowTitle"></div>
      <div id="flowMeta"></div>
      <div id="defaultExplainer"></div>
      <div id="errorBar"><span id="error"></span></div>
      <div id="lintResults"></div>
      <button id="aiSettingsToggle"></button>
      <section id="aiSettingsPanel" class="panel" style="display:none;">
        <div id="providerSelection">
          <input type="radio" name="ai-provider" value="openai" checked>
          <input type="radio" name="ai-provider" value="anthropic">
          <input type="radio" name="ai-provider" value="gemini">
          <input type="radio" name="ai-provider" value="ollama">
        </div>
        <div id="apiKeyRow">
          <label id="apiKeyLabel" for="openAIKey"></label>
          <input id="openAIKey" type="password" />
          <button id="setKey"></button>
        </div>
        <div id="ollamaHint" style="display:none;"></div>
        <div id="gptModelSelection">
          <select id="modelSelect"></select>
          <input type="text" id="custom-model-name" style="display:none;" />
        </div>
      </section>
      <section id="explainPanel" class="panel">
        <div id="gptDialogContainer">
          <input id="gptQuestion" type="text" />
          <button id="gptButton"></button>
        </div>
        <div id="spinner"></div>
        <span id="response"></span>
      </section>
      <button id="downloadButton" style="display:none;"></button>
      <button id="downloadMermaidButton" style="display:none;"></button>
      <div id="flowTableContainer" style="display:none;"></div>
    `;

    global.chrome = {
      runtime: {
        onMessage: {
          addListener: (fn) => { messageListener = fn; }
        }
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {}
        }
      }
    };

    require('../scripts/flowParser.js');
    require('../scripts/aiProviders.js');
    require('../scripts/popup.js');
  });

  test('should render explanation, lint results and table from a definition', async () => {
    expect(messageListener).toBeDefined();

    const flowDefinition = {
      label: 'Test Flow',
      description: '',
      processType: 'AutoLaunchedFlow',
      processMetadataValues: [
        { name: 'BuilderType', value: { stringValue: 'LightningFlowBuilder' } },
        { name: 'CanvasMode', value: { stringValue: 'AUTO_LAYOUT_CANVAS' } }
      ],
      start: {
        connector: { targetReference: 'Get_Accounts' },
        triggerType: 'RecordAfterSave',
        recordTriggerType: 'CreateAndUpdate',
        object: 'Account'
      },
      recordLookups: [{
        name: 'Get_Accounts', label: 'Get Accounts', object: 'Account',
        getFirstRecordOnly: false, storeOutputAutomatically: true,
        filters: [{ field: 'OwnerId', operator: 'EqualTo', value: { stringValue: '0053000000abcDE' } }],
        connector: { targetReference: 'Check_Status' }
      }],
      decisions: [{
        name: 'Check_Status', label: 'Check Status',
        defaultConnectorLabel: 'Otherwise',
        rules: [{
          name: 'Active', label: 'Is Active',
          conditions: [{ leftValueReference: 'Get_Accounts.Active__c', operator: 'EqualTo', rightValue: { booleanValue: true } }],
          connector: { targetReference: 'Loop_Accounts' }
        }]
      }],
      loops: [{
        name: 'Loop_Accounts', label: 'Loop Accounts', collectionReference: 'Get_Accounts',
        iterationOrder: 'Asc',
        nextValueConnector: { targetReference: 'Update_Acct' }
      }],
      recordUpdates: [{
        name: 'Update_Acct', label: 'Update Acct', inputReference: 'Loop_Accounts',
        inputAssignments: [{ field: 'Status__c', value: { stringValue: 'Reviewed' } }],
        connector: { targetReference: 'Loop_Accounts' }
      }],
      screens: [{
        name: 'Orphan_Screen', label: 'Orphan Screen',
        fields: [{ fieldType: 'DisplayText', fieldText: '<b>Hello</b>' }]
      }],
      variables: [{ name: 'varCount', dataType: 'Number', isCollection: false, isInput: true, isOutput: false }],
      formulas: [{ name: 'fxDate', dataType: 'Date', expression: 'TODAY()' }],
      textTemplates: [{ name: 'tt', text: '<p>hi</p>', isViewedAsPlainText: false }],
      constants: [{ name: 'cMax', dataType: 'Number', value: { numberValue: 5 } }]
    };

    const subflowDefinitions = {
      Send_Alert: {
        label: 'Send Alert',
        startElementReference: 'Notify',
        actionCalls: [{ name: 'Notify', label: 'Notify', actionName: 'emailSimple', actionType: 'emailAlert' }]
      }
    };
    const runStats = { errorCount: 14, pausedCount: 2, days: 7 };

    await messageListener({ flowDefinition, subflowDefinitions, runStats }, {}, () => {});
    // parse() is async fire-and-forget from the listener; let it settle
    await new Promise(resolve => setTimeout(resolve, 0));

    // the header region carries the flow name and type badge
    expect(document.getElementById('flowTitle').textContent).toBe('Test Flow');
    expect(document.getElementById('flowMeta').textContent).toContain('AutoLaunchedFlow');

    const explainer = document.getElementById('defaultExplainer');
    expect(explainer.textContent).toContain('This flow:');
    expect(explainer.textContent).toContain('queries Account records');
    expect(explainer.textContent).toContain('updates Loop_Accounts record for each item in Loop Accounts');

    // openai requires a key and none is stored, so the AI Settings dialog
    // pops out to surface the key input
    expect(document.getElementById('aiSettingsPanel').style.display).toBe('block');

    const lint = document.getElementById('lintResults');
    expect(lint.textContent).toContain('Potential issues:');
    expect(lint.textContent).toContain('Update_Acct');

    const table = document.getElementById('flowTableContainer');
    expect(table.style.display).toBe('block');
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);

    // run-stats overlay rendered from the enrichment data
    const statsLine = document.getElementById('runStatsLine');
    expect(statsLine.textContent).toContain('failed 14 times');
    expect(statsLine.textContent).toContain('2 paused interviews');
    expect(statsLine.textContent).toContain('last 7 days');

    // both download buttons are available
    expect(document.getElementById('downloadButton').style.display).toBe('block');
    expect(document.getElementById('downloadMermaidButton').style.display).toBe('block');
  });

  test('should re-render without enrichment data and drop the stats line', async () => {
    const flowDefinition = {
      label: 'Bare Flow',
      description: 'documented',
      processType: 'Flow',
      processMetadataValues: [
        { name: 'BuilderType', value: { stringValue: 'LightningFlowBuilder' } },
        { name: 'CanvasMode', value: { stringValue: 'AUTO_LAYOUT_CANVAS' } }
      ],
      startElementReference: 'Get_It',
      recordLookups: [{
        name: 'Get_It', label: 'Get It', object: 'Contact', description: 'd', getFirstRecordOnly: true
      }]
    };

    await messageListener({ flowDefinition }, {}, () => {});
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.getElementById('defaultExplainer').textContent).toContain('queries Contact records');
    // the stale stats line from the previous message must be gone
    expect(document.getElementById('runStatsLine')).toBeNull();
  });
});
