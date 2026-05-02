class FlowIsometricRenderer {
    constructor(rootElement, options = {}) {
        this.root = rootElement;
        this.options = Object.assign({
            nodeWidth: 160,
            nodeHeight: 70,
            isoScaleX: 0.33,
            isoScaleY: 0.18,
            margin: 280,
            minZoom: 0.4,
            maxZoom: 5,
            zoomStep: 0.1,
            cuboidDepth: 28,
            minSpacing: 1600,
            levelSpacing: 820,
            scrollPanFactor: 5.4,
            frontBaseSlope: -0.53,
            linkLaneSpacing: 120,
            edgeWidth: 12,
            edgeDashPattern: '22 12',
            edgeColor: '#9aa0a6',
            edgeDashColor: '#ffffff',
            typeColors: {
                start: '#4361ee',
                screen: '#8e44ad',
                decision: '#f39c12',
                loop: '#2ecc71',
                assignment: '#e74c3c',
                recordUpdate: '#16a085',
                recordCreate: '#0f9d58',
                recordDelete: '#c0392b',
                recordLookup: '#3a86ff',
                default: '#4a90e2'
            }
        }, options);

        this.zoom = 1;
        this.pan = { x: 0, y: 0 };

        if (this.root) {
            this.initializeDOM();
        } else {
            console.warn('FlowIsometricRenderer: root element not found.');
        }
    }

    initializeDOM() {
        this.root.classList.add('iso-flow-root');
        this.root.innerHTML = '';

        this.controls = document.createElement('div');
        this.controls.className = 'iso-flow-controls';
        this.root.appendChild(this.controls);

        const controlsLeft = document.createElement('div');
        controlsLeft.className = 'iso-flow-controls-left';
        controlsLeft.innerHTML = '<strong>Isometric Flow View</strong>';

        const controlsRight = document.createElement('div');
        controlsRight.className = 'iso-flow-controls-right';

        this.controls.appendChild(controlsLeft);
        this.controls.appendChild(controlsRight);

        this.zoomLabel = document.createElement('span');
        this.zoomLabel.className = 'iso-flow-zoom-label';
        this.zoomLabel.textContent = '100%';

        this.zoomSlider = document.createElement('input');
        this.zoomSlider.type = 'range';
        this.zoomSlider.min = this.options.minZoom;
        this.zoomSlider.max = this.options.maxZoom;
        this.zoomSlider.step = this.options.zoomStep;
        this.zoomSlider.value = this.zoom;
        this.zoomSlider.setAttribute('aria-label', 'Zoom level');

        this.resetButton = document.createElement('button');
        this.resetButton.type = 'button';
        this.resetButton.textContent = 'Reset view';

        controlsRight.appendChild(this.zoomLabel);
        controlsRight.appendChild(this.zoomSlider);
        controlsRight.appendChild(this.resetButton);

        this.stageWrapper = document.createElement('div');
        this.stageWrapper.className = 'iso-flow-stage iso-flow-empty';
        this.stageWrapper.dataset.empty = 'Waiting for flow metadata...';
        this.root.appendChild(this.stageWrapper);

        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.classList.add('iso-flow-svg');
        this.svg.setAttribute('role', 'img');
        this.svg.setAttribute('focusable', 'true');

        this.stageWrapper.appendChild(this.svg);

        this.setupSvgLayers();
        this.attachEvents();
    }

    setupSvgLayers() {
        while (this.svg.firstChild) {
            this.svg.removeChild(this.svg.firstChild);
        }

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'isoArrow');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse');

        const markerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        markerPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        marker.appendChild(markerPath);
        defs.appendChild(marker);
        this.svg.appendChild(defs);

        this.panGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.zoomGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        this.zoomGroup.appendChild(this.edgeLayer);
        this.zoomGroup.appendChild(this.nodeLayer);
        this.panGroup.appendChild(this.zoomGroup);
        this.svg.appendChild(this.panGroup);
    }

    attachEvents() {
        this.zoomSlider.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            this.setZoom(value);
        });

        this.resetButton.addEventListener('click', () => {
            this.zoom = 1;
            this.pan = { x: 0, y: 0 };
            this.applyTransforms();
        });

        this.stageWrapper.addEventListener('wheel', (event) => {
            if (event.ctrlKey) {
                event.preventDefault();
                const direction = event.deltaY > 0 ? -1 : 1;
                const nextZoom = this.zoom + (direction * this.options.zoomStep);
                this.setZoom(nextZoom);
                return;
            }

            event.preventDefault();
            const factor = this.options.scrollPanFactor;
            this.pan.x -= event.deltaX * factor;
            this.pan.y -= event.deltaY * factor;
            this.applyTransforms();
        }, { passive: false });

        let isPanning = false;
        let startPoint = null;

        const startPan = (event) => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            isPanning = true;
            startPoint = { x: event.clientX, y: event.clientY };
            this.stageWrapper.classList.add('iso-flow-panning');
        };

        const movePan = (event) => {
            if (!isPanning) {
                return;
            }
            const dx = event.clientX - startPoint.x;
            const dy = event.clientY - startPoint.y;
            startPoint = { x: event.clientX, y: event.clientY };
            this.pan.x += dx;
            this.pan.y += dy;
            this.applyTransforms();
        };

        const stopPan = () => {
            isPanning = false;
            this.stageWrapper.classList.remove('iso-flow-panning');
        };

        this.stageWrapper.addEventListener('pointerdown', startPan);
        window.addEventListener('pointermove', movePan);
        window.addEventListener('pointerup', stopPan);
        window.addEventListener('pointerleave', stopPan);
    }

    setZoom(value) {
        const clamped = Math.min(this.options.maxZoom, Math.max(this.options.minZoom, value));
        this.zoom = Number(clamped.toFixed(2));
        this.zoomSlider.value = this.zoom;
        this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
        this.applyTransforms();
    }

    applyTransforms() {
        this.panGroup.setAttribute('transform', `translate(${this.pan.x}, ${this.pan.y})`);
        const center = this.viewBoxCenter ?? { x: 0, y: 0 };
        this.zoomGroup.setAttribute(
            'transform',
            `translate(${center.x}, ${center.y}) scale(${this.zoom}) translate(${-center.x}, ${-center.y})`
        );
    }

    render(actionMap) {
        if (!this.root) {
            return;
        }
        const graph = this.buildGraphFromMap(actionMap);
        this.drawGraph(graph);
    }

    buildGraphFromMap(actionMap) {
        const nodes = [];
        const edges = [];
        const allowedIds = new Set();

        for (const [name, element] of actionMap.entries()) {
            const hasCoordinates = Number.isFinite(element.locationX) && Number.isFinite(element.locationY);
            if (!hasCoordinates) {
                continue;
            }
            allowedIds.add(name);
            nodes.push({
                id: name,
                label: element.label || name,
                type: element.type || 'element',
                description: element.description || '',
                x: element.locationX,
                y: element.locationY
            });
        }

        for (const [name, element] of actionMap.entries()) {
            if (!allowedIds.has(name)) {
                continue;
            }
            const branches = element.branchArray || [];
            const branchLabels = element.branchLabelArray || [];
            branches.forEach((target, idx) => {
                if (!target || !allowedIds.has(target)) {
                    return;
                }
                edges.push({
                    from: name,
                    to: target,
                    label: this.formatConnectorLabel(branchLabels[idx])
                });
            });
        }

        return { nodes, edges };
    }

    formatConnectorLabel(label) {
        if (!label) {
            return '';
        }
        return label.replace(/^condition\s*/i, '').replace(/on .*$/i, '').trim();
    }

    drawGraph(graph) {
        if (!graph.nodes.length) {
            this.edgeLayer.innerHTML = '';
            this.nodeLayer.innerHTML = '';
            this.stageWrapper.classList.add('iso-flow-empty');
            this.stageWrapper.dataset.empty = 'No positioned flow elements available.';
            return;
        }
        this.stageWrapper.classList.remove('iso-flow-empty');
        this.stageWrapper.removeAttribute('data-empty');
        this.pan = { x: 0, y: 0 };
        this.zoom = 1;
        this.zoomSlider.value = this.zoom;
        this.zoomLabel.textContent = '100%';
        this.assignTreeLayout(graph);

        const nodesWithWorld = graph.nodes.map((node, index) => {
            const fallback = index * this.options.minSpacing;
            const baseX = Number.isFinite(node.worldX) ? node.worldX : fallback;
            const baseY = Number.isFinite(node.worldY) ? node.worldY : 0;
            return {
                ...node,
                worldX: baseX,
                worldY: baseY
            };
        });

        const projectedNodes = nodesWithWorld.map((node) => ({
            ...node,
            isoX: (node.worldY - node.worldX) * this.options.isoScaleX,
            isoY: (node.worldX + node.worldY) * this.options.isoScaleY
        }));

        const xValues = projectedNodes.map((node) => node.isoX);
        const yValues = projectedNodes.map((node) => node.isoY);
        const minX = Math.min(...xValues);
        const maxX = Math.max(...xValues);
        const minY = Math.min(...yValues);
        const maxY = Math.max(...yValues);
        const margin = this.options.margin;

        const width = Math.max(1, (maxX - minX) + margin * 2);
        const height = Math.max(1, (maxY - minY) + margin * 2);
        this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        this.viewBoxCenter = { x: width / 2, y: height / 2 };
        this.applyTransforms();

        const offsetX = margin - minX;
        const offsetY = margin - minY;
        this.projectionOffsets = { offsetX, offsetY };

        const nodePositions = new Map();
        projectedNodes.forEach((node) => {
            const x = node.isoX + offsetX;
            const y = node.isoY + offsetY;
            nodePositions.set(node.id, { x, y, node, worldX: node.worldX, worldY: node.worldY });
        });

        this.edgeLayer.innerHTML = '';
        this.segmentRegistry = [];
        this.segmentLaneUsage = new Map();
        graph.edges.forEach((edge) => {
            const from = nodePositions.get(edge.from);
            const to = nodePositions.get(edge.to);
            if (!from || !to) {
                return;
            }

            const worldPath = this.buildWorldPath(from, to);
            const adjustedWorldPath = this.offsetWorldPath(worldPath);
            const pathData = this.worldPathToSvg(adjustedWorldPath);

            const road = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            road.setAttribute('d', pathData);
            road.classList.add('iso-flow-edge', 'iso-flow-edge-road');
            road.setAttribute('stroke-width', this.options.edgeWidth);
            road.setAttribute('stroke', this.options.edgeColor);
            this.edgeLayer.appendChild(road);

            const centerLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            centerLine.setAttribute('d', pathData);
            centerLine.classList.add('iso-flow-edge', 'iso-flow-edge-dash');
            centerLine.setAttribute('stroke', this.options.edgeDashColor);
            centerLine.setAttribute('stroke-width', this.options.edgeWidth * 0.25);
            centerLine.setAttribute('stroke-dasharray', this.options.edgeDashPattern);
            this.edgeLayer.appendChild(centerLine);

            if (edge.label) {
                const labelPoint = this.getEdgeLabelPoint(from, to);
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.classList.add('iso-flow-edge-label');
                text.setAttribute('x', labelPoint.x);
                text.setAttribute('y', labelPoint.y);
                text.textContent = edge.label;
                this.edgeLayer.appendChild(text);
            }
        });

        this.nodeLayer.innerHTML = '';
        projectedNodes.forEach((node) => {
            const position = nodePositions.get(node.id);
            if (!position) {
                return;
            }
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.classList.add('iso-flow-node', `iso-flow-node-${node.type}`);
            group.setAttribute('transform', `translate(${position.x}, ${position.y})`);

            const shape = this.createNodeShape(node.type);
            group.appendChild(shape);

            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `${node.label}\n${node.type}`;
            group.appendChild(title);

            const labelAngle = Math.atan(this.options.frontBaseSlope) * (180 / Math.PI);
            const labelWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            labelWrapper.setAttribute('transform', `rotate(${labelAngle})`);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.classList.add('iso-flow-node-label');
            text.setAttribute('x', 10);
            text.setAttribute('y', -40);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.textContent = node.label;
            labelWrapper.appendChild(text);

            group.appendChild(labelWrapper);

            this.nodeLayer.appendChild(group);
        });
    }

    projectWorldPoint(worldX, worldY) {
        const offsets = this.projectionOffsets ?? { offsetX: 0, offsetY: 0 };
        const isoX = (worldY - worldX) * this.options.isoScaleX;
        const isoY = (worldX + worldY) * this.options.isoScaleY;
        return {
            x: isoX + offsets.offsetX,
            y: isoY + offsets.offsetY
        };
    }

    buildWorldPath(from, to) {
        const epsilon = 0.5;
        const startWorldX = from.worldX ?? 0;
        const startWorldY = from.worldY ?? 0;
        const endWorldX = to.worldX ?? 0;
        const endWorldY = to.worldY ?? 0;
        const pathPoints = [];
        const addPoint = (worldX, worldY) => {
            pathPoints.push({ x: worldX, y: worldY });
        };

        addPoint(startWorldX, startWorldY);

        const sameX = Math.abs(startWorldX - endWorldX) < epsilon;
        const sameY = Math.abs(startWorldY - endWorldY) < epsilon;

        if (!sameX && !sameY) {
            const midWorldX = (startWorldX + endWorldX) / 2;
            addPoint(midWorldX, startWorldY);
            addPoint(midWorldX, endWorldY);
        }

        addPoint(endWorldX, endWorldY);

        return pathPoints;
    }

    worldPathToSvg(worldPath) {
        if (!worldPath || worldPath.length === 0) {
            return '';
        }
        const projectedPoints = worldPath.map((pt) => this.projectWorldPoint(pt.x, pt.y));
        const instructions = projectedPoints.map((pt) => `${pt.x} ${pt.y}`);
        return `M ${instructions.join(' L ')}`;
    }

    getEdgeLabelPoint(from, to) {
        const midWorldX = (from.worldX + to.worldX) / 2;
        const midWorldY = (from.worldY + to.worldY) / 2;
        const projected = this.projectWorldPoint(midWorldX, midWorldY);
        return { x: projected.x, y: projected.y - this.options.edgeWidth };
    }

    assignTreeLayout(graph) {
        if (!graph?.nodes?.length) {
            return;
        }

        const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
        const adjacency = new Map();
        graph.edges.forEach((edge) => {
            if (!adjacency.has(edge.from)) {
                adjacency.set(edge.from, []);
            }
            adjacency.get(edge.from).push(edge.to);
        });

        const visited = new Set();
        let globalMaxLevel = 0;

        const traverseFromRoot = (root, baseLevel) => {
            if (!root) {
                return baseLevel;
            }
            const queue = [root];
            root.level = baseLevel;
            visited.add(root.id);
            let localMax = baseLevel;

            while (queue.length > 0) {
                const current = queue.shift();
                const children = adjacency.get(current.id) ?? [];
                children.forEach((childId) => {
                    const child = nodeMap.get(childId);
                    if (!child) {
                        return;
                    }
                    const candidateLevel = (current.level ?? baseLevel) + 1;
                    if (child.level === undefined || child.level > candidateLevel) {
                        child.level = candidateLevel;
                    }
                    if (!visited.has(child.id)) {
                        visited.add(child.id);
                        queue.push(child);
                    }
                    localMax = Math.max(localMax, child.level);
                });
            }
            return localMax;
        };

        const startNode = nodeMap.get('Start') ?? graph.nodes[0];
        if (startNode) {
            globalMaxLevel = traverseFromRoot(startNode, 0);
        }

        graph.nodes.forEach((node) => {
            if (node.level === undefined) {
                globalMaxLevel += 1;
                const maxFromSubtree = traverseFromRoot(node, globalMaxLevel);
                globalMaxLevel = Math.max(globalMaxLevel, maxFromSubtree);
            }
        });

        const levelMap = new Map();
        graph.nodes.forEach((node) => {
            const level = node.level ?? 0;
            if (!levelMap.has(level)) {
                levelMap.set(level, []);
            }
            levelMap.get(level).push(node);
        });

        const sortedLevels = [ ...levelMap.keys() ].sort((a, b) => a - b);
        sortedLevels.forEach((level) => {
            const nodesAtLevel = levelMap.get(level);
            const total = nodesAtLevel.length;
            const startX = -((total - 1) * this.options.minSpacing) / 2;
            nodesAtLevel.forEach((node, index) => {
                node.worldX = startX + index * this.options.minSpacing;
                node.worldY = level * this.options.levelSpacing;
            });
        });
    }

    offsetWorldPath(pathPoints) {
        const adjusted = pathPoints.map((pt) => ({ ...pt }));
        for (let index = 0; index < adjusted.length - 1; index++) {
            const from = adjusted[index];
            const to = adjusted[index + 1];
            const isHorizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
            const orientation = isHorizontal ? 'horizontal' : 'vertical';
            const offset = this.getSegmentLaneOffset(from, to, orientation);
            if (offset !== 0) {
                if (orientation === 'horizontal') {
                    from.y += offset;
                    to.y += offset;
                } else {
                    from.x += offset;
                    to.x += offset;
                }
            }
            this.registerSegment(from, to, orientation);
        }
        return adjusted;
    }

    getSegmentLaneOffset(from, to, orientation) {
        const conflict = this.segmentConflicts(from, to, orientation);
        if (!conflict) {
            return 0;
        }
        const coord = orientation === 'horizontal' ? from.y : from.x;
        const laneKey = `${orientation}:${Math.round(coord / 5)}`;
        const laneIndex = (this.segmentLaneUsage.get(laneKey) ?? 0) + 1;
        this.segmentLaneUsage.set(laneKey, laneIndex);
        const direction = laneIndex % 2 === 0 ? -1 : 1;
        const magnitude = Math.ceil(laneIndex / 2);
        return direction * magnitude * this.options.linkLaneSpacing;
    }

    segmentConflicts(from, to, orientation) {
        if (!this.segmentRegistry) {
            return false;
        }
        const epsilon = 0.2;
        const coord = orientation === 'horizontal' ? from.y : from.x;
        const rangeStart = orientation === 'horizontal'
            ? Math.min(from.x, to.x)
            : Math.min(from.y, to.y);
        const rangeEnd = orientation === 'horizontal'
            ? Math.max(from.x, to.x)
            : Math.max(from.y, to.y);

        for (const segment of this.segmentRegistry) {
            if (segment.orientation !== orientation) {
                continue;
            }
            if (Math.abs(segment.coord - coord) > epsilon) {
                continue;
            }
            if (rangeEnd <= segment.rangeStart + epsilon || rangeStart >= segment.rangeEnd - epsilon) {
                continue;
            }
            return true;
        }
        return false;
    }

    registerSegment(from, to, orientation) {
        if (!this.segmentRegistry) {
            this.segmentRegistry = [];
        }
        const entry = {
            orientation,
            coord: orientation === 'horizontal' ? from.y : from.x,
            rangeStart: orientation === 'horizontal'
                ? Math.min(from.x, to.x)
                : Math.min(from.y, to.y),
            rangeEnd: orientation === 'horizontal'
                ? Math.max(from.x, to.x)
                : Math.max(from.y, to.y)
        };
        if (Math.abs(entry.rangeEnd - entry.rangeStart) < 0.01) {
            return;
        }
        this.segmentRegistry.push(entry);
    }

    createNodeShape(type) {
        const fragment = document.createDocumentFragment();
        const width = this.options.nodeWidth;
        const height = this.options.nodeHeight;
        const depth = this.options.cuboidDepth;
        const depthX = -depth;
        const depthY = depth * -0.6;
        const halfW = width / 2;
        const halfH = height / 2;
        const left = -halfW;
        const right = halfW;
        const topY = -halfH;
        const bottomY = halfH;
        const slope = this.options.frontBaseSlope;

        const getSlopeOffset = (x) => slope * (x - left);
        const baseColor = this.getNodeColor(type);
        const topColor = this.adjustColor(baseColor, 18);
        const sideColor = this.adjustColor(baseColor, -15);

        const topFace = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        topFace.setAttribute('points', [
            `${left},${topY}`,
            `${right},${topY + getSlopeOffset(right)}`,
            `${right + depthX},${topY + depthY + getSlopeOffset(right + depthX)}`,
            `${left + depthX},${topY + depthY + getSlopeOffset(left + depthX)}`
        ].join(' '));
        topFace.setAttribute('fill', topColor);
        topFace.classList.add('iso-flow-node-shape', 'iso-flow-node-face', 'iso-flow-node-top');
        fragment.appendChild(topFace);

        const sideFace = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        sideFace.setAttribute('points', [
            `${left},${topY}`,
            `${left},${bottomY}`,
            `${left + depthX},${bottomY + depthY + getSlopeOffset(left + depthX)}`,
            `${left + depthX},${topY + depthY + getSlopeOffset(left + depthX)}`
        ].join(' '));
        sideFace.setAttribute('fill', sideColor);
        sideFace.classList.add('iso-flow-node-shape', 'iso-flow-node-face', 'iso-flow-node-side');
        fragment.appendChild(sideFace);

        const frontFace = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        frontFace.setAttribute('points', [
            `${left},${topY}`,
            `${right},${topY + getSlopeOffset(right)}`,
            `${right},${bottomY + getSlopeOffset(right)}`,
            `${left},${bottomY}`
        ].join(' '));
        frontFace.setAttribute('fill', baseColor);
        frontFace.classList.add('iso-flow-node-shape', 'iso-flow-node-face', 'iso-flow-node-front');
        fragment.appendChild(frontFace);

        return fragment;
    }

    getNodeColor(type) {
        return this.options.typeColors[type] ?? this.options.typeColors.default;
    }

    adjustColor(hexColor, percent) {
        const normalized = hexColor.replace('#', '');
        const num = parseInt(normalized, 16);
        if (Number.isNaN(num)) {
            return hexColor;
        }
        const r = Math.min(255, Math.max(0, (num >> 16) + Math.round((255 * percent) / 100)));
        const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + Math.round((255 * percent) / 100)));
        const b = Math.min(255, Math.max(0, (num & 0x0000ff) + Math.round((255 * percent) / 100)));
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
}

window.FlowIsometricRenderer = FlowIsometricRenderer;
