(() => {
    const isoRoot = document.getElementById('isometricFlow');
    const statusEl = document.getElementById('demoStatus');
    const sampleButton = document.getElementById('loadSampleFlow');
    const fileInput = document.getElementById('flowFileInput');

    if (!isoRoot || typeof FlowIsometricRenderer === 'undefined') {
        console.warn('Isometric demo could not initialize.');
        return;
    }

    const renderer = new FlowIsometricRenderer(isoRoot);

    const setStatus = (message, isError = false) => {
        if (!statusEl) {
            return;
        }
        statusEl.textContent = message;
        statusEl.classList.toggle('error', isError);
    };

    const definitionGroups = [
        'recordLookups', 'recordCreates', 'recordUpdates', 'recordDeletes', 'recordRollbacks',
        'assignments', 'decisions', 'screens', 'loops', 'steps', 'subflows', 'actionCalls',
        'apexPluginCalls', 'collectionProcessors', 'transforms', 'waits',
        'dynamicChoiceSets', 'variables', 'textTemplates', 'formulas', 'constants', 'choices'
    ];

    const normalizeElement = (element, typeName) => {
        const normalized = { ...element };
        normalized.type = typeName.slice(0, -1);
        normalized.branchArray = [];
        normalized.branchLabelArray = [];
        normalized.nextElement = normalized.connector?.targetReference
            ?? normalized.defaultConnector?.targetReference;

        if (normalized.nextElement) {
            normalized.branchArray.push(normalized.nextElement);
            normalized.branchLabelArray.push(`${normalized.label ?? normalized.name} is true`);
        }

        if (normalized.faultConnector?.targetReference) {
            normalized.branchArray.push(normalized.faultConnector.targetReference);
            normalized.branchLabelArray.push(`fails on ${normalized.label ?? normalized.name}`);
        }

        if (normalized.type === 'loop') {
            if (normalized.nextValueConnector?.targetReference) {
                normalized.branchArray.push(normalized.nextValueConnector.targetReference);
                normalized.branchLabelArray.push(`next value on ${normalized.label ?? normalized.name}`);
            }
            if (normalized.noMoreValuesConnector?.targetReference) {
                normalized.branchArray.push(normalized.noMoreValuesConnector.targetReference);
                normalized.branchLabelArray.push(`no more values on ${normalized.label ?? normalized.name}`);
            }
        }

        if (normalized.type === 'wait' && normalized.waitEvents) {
            normalized.waitEvents.forEach((waitEvent) => {
                if (!waitEvent?.connector?.targetReference) {
                    return;
                }
                normalized.branchArray.push(waitEvent.connector.targetReference);
                normalized.branchLabelArray.push(`wait event ${waitEvent.label ?? ''}`.trim());
            });
        }

        if (Array.isArray(normalized.rules)) {
            normalized.rules.forEach((rule) => {
                if (!rule?.connector?.targetReference) {
                    return;
                }
                normalized.branchArray.push(rule.connector.targetReference);
                normalized.branchLabelArray.push(`condition ${rule.label ?? ''} on ${normalized.label ?? ''}`.trim());
            });
        }

        return normalized;
    };

    const buildActionMap = (flowDefinition) => {
        const actionMap = new Map();

        const startElementReference = flowDefinition.startElementReference
            ?? flowDefinition.start?.connector?.targetReference;
        const startElement = flowDefinition.start ?? {
            connector: { targetReference: startElementReference }
        };
        startElement.name = 'Start';
        startElement.type = 'start';
        startElement.branchArray = [];
        startElement.branchLabelArray = [];
        if (startElement.connector?.targetReference) {
            startElement.branchArray.push(startElement.connector.targetReference);
            startElement.branchLabelArray.push('start');
        }
        if (Array.isArray(startElement.scheduledPaths)) {
            startElement.scheduledPaths.forEach((scheduledPath) => {
                if (!scheduledPath?.connector?.targetReference) {
                    return;
                }
                startElement.branchArray.push(scheduledPath.connector.targetReference);
                startElement.branchLabelArray.push(`scheduled path ${scheduledPath.label ?? ''}`.trim());
            });
        }

        actionMap.set(startElement.name, startElement);

        definitionGroups.forEach((groupName) => {
            const elements = flowDefinition[groupName];
            if (!Array.isArray(elements)) {
                return;
            }
            elements.forEach((element) => {
                if (!element?.name) {
                    return;
                }
                const normalized = normalizeElement(element, groupName);
                actionMap.set(normalized.name, normalized);
            });
        });

        return actionMap;
    };

    const renderDefinition = (flowDefinition, label) => {
        try {
            const actionMap = buildActionMap(flowDefinition);
            renderer.render(actionMap);
            const positionedCount = [...actionMap.values()]
                .filter((element) => Number.isFinite(element.locationX) && Number.isFinite(element.locationY))
                .length;
            setStatus(`Rendered ${positionedCount} positioned elements from ${label}.`);
        } catch (error) {
            console.error(error);
            setStatus(`Failed to render ${label}. See console for details.`, true);
        }
    };

    const loadSampleFlow = async () => {
        try {
            setStatus('Loading sampleFlow.json...');
            const response = await fetch('./sampleFlow.json');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const flowDefinition = await response.json();
            renderDefinition(flowDefinition, 'sampleFlow.json');
        } catch (error) {
            console.error(error);
            setStatus('Unable to load sampleFlow.json. Run a local web server or use the file picker.', true);
        }
    };

    const handleFileInput = (event) => {
        const [file] = event.target.files ?? [];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            try {
                const flowDefinition = JSON.parse(loadEvent.target.result);
                renderDefinition(flowDefinition, file.name);
            } catch (error) {
                console.error(error);
                setStatus('Selected file is not valid JSON.', true);
            }
        };
        reader.onerror = () => {
            setStatus('Could not read the selected file.', true);
        };
        reader.readAsText(file);
    };

    sampleButton?.addEventListener('click', loadSampleFlow);
    fileInput?.addEventListener('change', handleFileInput);

    setStatus('Pick a flow JSON file or load the bundled sample to test the renderer.');
})();
