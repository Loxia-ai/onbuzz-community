import React, { useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  MarkerType
} from '@xyflow/react';

// Custom nodes
import InputNode from './nodes/InputNode.jsx';
import AgentNode from './nodes/AgentNode.jsx';
import OutputNode from './nodes/OutputNode.jsx';
import toast from 'react-hot-toast';

// v2 type compatibility — must match src/core/flowTypes.js. Mirrored
// here so drag-time connect can refuse incompatible drops without a
// round-trip. Keep in sync with the server's compat matrix.
const TYPE_COMPAT = (() => {
  const allowed = new Map([
    ['number',     new Set(['text', 'json'])],
    ['boolean',    new Set(['text', 'json'])],
    ['json',       new Set(['text'])],
    ['text',       new Set(['json', 'list<text>'])],
    ['file',       new Set(['file[]'])],
    ['list<text>', new Set(['json'])],
  ]);
  return (from, to) => {
    if (!from || !to) return false;
    if (from === to) return true;
    return allowed.get(from)?.has(to) === true;
  };
})();

// Node types registry
const nodeTypes = {
  input: InputNode,
  agent: AgentNode,
  output: OutputNode
};

// Default edge options
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: true,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 20,
    height: 20
  },
  style: {
    strokeWidth: 2
  }
};

function FlowCanvas({
  nodes: initialNodes,
  edges: initialEdges,
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
  onNodeSelect,
  agents,
  nodeStates = {}, // Execution status for each node: { nodeId: { status: 'running' | 'completed' | 'failed' } }
  lintBadgesByNode = new Map(), // Phase 5: per-node lint warnings (Map<nodeId, [{kind, field, message}, ...]>)
}) {
  const reactFlowWrapper = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  // Inject execution status + lint warnings into nodes so the custom
  // node components (InputNode/AgentNode/OutputNode) can surface them.
  const nodesWithExecutionStatus = useMemo(() => {
    return initialNodes.map(node => {
      const lintWarnings = lintBadgesByNode?.get?.(node.id) || [];
      return {
        ...node,
        data: {
          ...node.data,
          executionStatus: nodeStates[node.id]?.status || null,
          lintWarnings,
          // Phase 5 UI: surface typed I/O on the canvas so users SEE
          // the contract (port chips with name+type).
          declaredInputs:  Array.isArray(node.inputs)  ? node.inputs  : null,
          declaredOutputs: Array.isArray(node.outputs) ? node.outputs : null,
        }
      };
    });
  }, [initialNodes, nodeStates, lintBadgesByNode]);

  // React Flow state - use nodes with execution status
  const [nodes, setNodes, onNodesChange] = useNodesState(nodesWithExecutionStatus);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when nodeStates change
  useEffect(() => {
    setNodes(nodesWithExecutionStatus);
  }, [nodesWithExecutionStatus, setNodes]);

  // Sync changes back to parent (only for meaningful edits, not internal ReactFlow events)
  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);

    // Skip dimension measurements and selection changes — these are internal
    // ReactFlow events that fire on mount and don't represent user edits.
    const hasContentChange = changes.some(c =>
      c.type !== 'dimensions' && c.type !== 'select'
    );
    if (!hasContentChange) return;

    setNodes((nds) => {
      const updated = [...nds];
      onNodesChangeCallback(updated);
      return updated;
    });
  }, [onNodesChange, setNodes, onNodesChangeCallback]);

  const handleEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);

    const hasContentChange = changes.some(c => c.type !== 'select');
    if (!hasContentChange) return;

    setEdges((eds) => {
      const updated = [...eds];
      onEdgesChangeCallback(updated);
      return updated;
    });
  }, [onEdgesChange, setEdges, onEdgesChangeCallback]);

  // Handle new connections.
  // Phase 5 UI (v6): when both endpoints declare typed I/O, auto-pick
  // the first compatible (sourceField, targetField) pair using the
  // compat matrix. If NO compatible pair exists, refuse the connection
  // with an explanation toast — better than silently creating an edge
  // the schema validator will reject at save.
  const onConnect = useCallback((params) => {
    const srcNode = initialNodes.find(n => n.id === params.source);
    const tgtNode = initialNodes.find(n => n.id === params.target);
    const srcOutputs = Array.isArray(srcNode?.outputs) ? srcNode.outputs : [];
    const tgtInputs  = Array.isArray(tgtNode?.inputs)  ? tgtNode.inputs  : [];
    const isTyped    = srcOutputs.length > 0 || tgtInputs.length > 0;

    let mapping = {};
    if (isTyped) {
      // Try every (output, input) pair, prefer name match, then type match.
      let pick = null;
      for (const o of srcOutputs) {
        for (const i of tgtInputs) {
          if (!TYPE_COMPAT(o.type, i.type)) continue;
          if (o.name === i.name) { pick = { o, i, score: 2 }; break; }
          if (!pick || pick.score < 1) pick = { o, i, score: 1 };
        }
        if (pick?.score === 2) break;
      }
      if (!pick) {
        toast.error(
          `Cannot connect: no compatible field pair between "${srcNode?.data?.label || params.source}" and "${tgtNode?.data?.label || params.target}". Check declared output / input types in the properties panel.`,
          { duration: 5000 }
        );
        return;
      }
      mapping = { sourceField: pick.o.name, targetField: pick.i.name };
    }

    setEdges((eds) => {
      const newEdges = addEdge({
        ...params,
        ...defaultEdgeOptions,
        ...mapping,
        id: `edge-${Date.now()}`,
        // Surface the mapping on the edge label so it's visible on hover.
        label: mapping.sourceField ? `${mapping.sourceField} → ${mapping.targetField}` : undefined,
      }, eds);
      onEdgesChangeCallback(newEdges);
      return newEdges;
    });
  }, [initialNodes, setEdges, onEdgesChangeCallback]);

  // Handle node selection
  const onNodeClick = useCallback((event, node) => {
    onNodeSelect(node);
  }, [onNodeSelect]);

  // Handle drop from palette
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();

    const type = event.dataTransfer.getData('application/reactflow/type');
    const label = event.dataTransfer.getData('application/reactflow/label');

    if (!type) return;

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });

    const newNode = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      data: {
        label: label || type,
        ...getDefaultNodeData(type)
      }
    };

    setNodes((nds) => {
      const updated = [...nds, newNode];
      onNodesChangeCallback(updated);
      return updated;
    });
  }, [screenToFlowPosition, setNodes, onNodesChangeCallback]);

  // Handle delete key
  const onKeyDown = useCallback((event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // React Flow handles deletion internally with selected nodes/edges
    }
  }, []);

  // Memoize node types with agents context
  const nodeTypesWithContext = useMemo(() => ({
    input: InputNode,
    agent: (props) => <AgentNode {...props} agents={agents} />,
    output: OutputNode
  }), [agents]);

  return (
    <div ref={reactFlowWrapper} className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypesWithContext}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        // Touch / multi-touch support. ReactFlow's defaults already
        // handle pinch-to-zoom and finger-drag pan correctly; we used
        // to set panOnDrag={[0,1]} + selectionOnDrag={false} here, but
        // those interfered with the HTML5 drag-and-drop from the
        // NodePalette (palette → canvas drop stopped firing onDrop on
        // some setups). Reverted to defaults — drag-and-drop works
        // again, and pinch/pan still work because they're default-on.
        zoomOnDoubleClick={false}
        className="bg-gray-50 dark:bg-gray-900"
      >
        <Controls
          className="!bg-white dark:!bg-gray-800 !border !border-gray-200 dark:!border-gray-700 !rounded-lg !shadow-lg [&>button]:!bg-white dark:[&>button]:!bg-gray-800 [&>button]:!border-gray-200 dark:[&>button]:!border-gray-700 [&>button]:!text-gray-600 dark:[&>button]:!text-gray-300 [&>button:hover]:!bg-gray-100 dark:[&>button:hover]:!bg-gray-700"
        />
        <MiniMap
          className="!bg-white dark:!bg-gray-800 !border !border-gray-200 dark:!border-gray-700 !rounded-lg !shadow-lg"
          nodeColor={(node) => {
            switch (node.type) {
              case 'input': return '#22c55e';
              case 'agent': return '#3b82f6';
              case 'output': return '#f59e0b';
              default: return '#6b7280';
            }
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          className="bg-gray-50 dark:bg-gray-900"
        />
      </ReactFlow>
    </div>
  );
}

// Get default data for each node type
function getDefaultNodeData(type) {
  switch (type) {
    case 'input':
      return {
        label: 'Flow Input',
        promptTemplate: '{{userInput}}'
      };
    case 'agent':
      return {
        label: 'Agent',
        agentId: null,
        promptTemplate: 'Process the following:\n\n{{input}}',
        outputKey: 'result'
      };
    case 'output':
      return {
        label: 'Flow Output',
        outputFormat: 'text'
      };
    default:
      return {};
  }
}

export default FlowCanvas;
