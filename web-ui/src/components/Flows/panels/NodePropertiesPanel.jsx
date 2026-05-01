import React, { useState, useEffect } from 'react';
import {
  XMarkIcon,
  CpuChipIcon,
  ArrowRightStartOnRectangleIcon,
  ArrowRightEndOnRectangleIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import AgentSelector from './AgentSelector.jsx';

// v2 type registry — must match src/core/flowTypes.js
const FLOW_TYPES = ['text', 'number', 'boolean', 'json', 'file', 'file[]', 'list<text>'];

const TYPE_COLORS = {
  'text':       'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300',
  'number':     'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'boolean':    'bg-pink-100   text-pink-700   dark:bg-pink-900/40   dark:text-pink-300',
  'json':       'bg-green-100  text-green-700  dark:bg-green-900/40  dark:text-green-300',
  'file':       'bg-amber-100  text-amber-700  dark:bg-amber-900/40  dark:text-amber-300',
  'file[]':     'bg-amber-100  text-amber-800  dark:bg-amber-900/50  dark:text-amber-200',
  'list<text>': 'bg-blue-100   text-blue-800   dark:bg-blue-900/50   dark:text-blue-200',
};

function NodePropertiesPanel({ node, agents, onUpdate, onUpdateTop, onClose }) {
  const [localData, setLocalData] = useState(node.data);

  // Sync when node changes
  useEffect(() => {
    setLocalData(node.data);
  }, [node.id, node.data]);

  const handleChange = (field, value) => {
    const updated = { ...localData, [field]: value };
    setLocalData(updated);
    onUpdate(updated);
  };

  const nodeTypeConfig = getNodeTypeConfig(node.type);
  const Icon = nodeTypeConfig.icon;

  return (
    <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0">
      {/* Header */}
      <div className={`
        flex items-center justify-between px-4 py-3 border-b
        ${nodeTypeConfig.headerBg} ${nodeTypeConfig.headerBorder}
      `}>
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${nodeTypeConfig.iconBg}`}>
            <Icon className={`w-4 h-4 ${nodeTypeConfig.iconColor}`} />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${nodeTypeConfig.textColor}`}>
              {nodeTypeConfig.title}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Configure node properties
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Label
          </label>
          <input
            type="text"
            value={localData.label || ''}
            onChange={(e) => handleChange('label', e.target.value)}
            className="input-primary text-sm"
            placeholder="Node label"
          />
        </div>

        {/* Type-specific fields */}
        {node.type === 'input' && (
          <InputNodeFields data={localData} onChange={handleChange} />
        )}

        {node.type === 'agent' && (
          <AgentNodeFields data={localData} agents={agents} onChange={handleChange} />
        )}

        {node.type === 'output' && (
          <OutputNodeFields data={localData} onChange={handleChange} />
        )}

        {/* ---- v2 TYPED I/O EDITOR ---- */}
        {/* Typed inputs/outputs make the node's contract explicit:
            named, typed fields the agent receives + must produce. */}
        <TypedIOSection
          node={node}
          onUpdateTop={onUpdateTop}
        />

        {/* ---- EXECUTION SETTINGS (agent nodes only) ---- */}
        {node.type === 'agent' && (
          <ExecutionSection node={node} onUpdateTop={onUpdateTop} />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Node ID: <code className="font-mono">{node.id}</code>
        </p>
      </div>
    </div>
  );
}

// Input node specific fields
function InputNodeFields({ data, onChange }) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Prompt Template
        </label>
        <textarea
          value={data.promptTemplate || ''}
          onChange={(e) => onChange('promptTemplate', e.target.value)}
          rows={4}
          className="input-primary text-sm font-mono resize-none"
          placeholder="{{userInput}}"
        />
        <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg text-xs space-y-1">
          <p className="font-medium text-green-700 dark:text-green-300">Variable:</p>
          <p className="text-green-600 dark:text-green-400">
            <code className="bg-green-100 dark:bg-green-800 px-1 rounded">{"{{userInput}}"}</code>
            {" "}— Text entered when running the flow
          </p>
        </div>
      </div>
    </>
  );
}

// Agent node specific fields
function AgentNodeFields({ data, agents, onChange }) {
  return (
    <>
      {/* Agent Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Agent
        </label>
        <AgentSelector
          value={data.agentId || ''}
          onChange={(agentId) => onChange('agentId', agentId || null)}
        />
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Select a loaded agent or load one from disk
        </p>
      </div>

      {/* Phase 7: per-node instructions — role + how to succeed at this
          step. Distinct from the Prompt Template (which is the input
          message). Surfaced verbatim in the agent's system prompt as
          "NODE INSTRUCTIONS". */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Instructions <span className="font-normal text-gray-400">(role + done-condition)</span>
        </label>
        <textarea
          value={data.instructions || ''}
          onChange={(e) => onChange('instructions', e.target.value)}
          rows={3}
          placeholder="e.g. Researcher: cite peer-reviewed sources only. Done when findings has ≥3 citations."
          className="input-primary text-sm resize-none"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Tells the agent its role and how to know it's done.
        </p>
      </div>

      {/* Prompt Template */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Prompt Template
        </label>
        <textarea
          value={data.promptTemplate || ''}
          onChange={(e) => onChange('promptTemplate', e.target.value)}
          rows={6}
          className="input-primary text-sm font-mono resize-none"
          placeholder="Process the following:\n\n{{input}}"
        />
        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs space-y-1.5">
          <p className="font-medium text-blue-700 dark:text-blue-300">Variables you can use:</p>
          <p className="text-blue-600 dark:text-blue-400">
            <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{"{{input}}"}</code>
            {" "}— Output from the previous connected node
          </p>
          <p className="text-blue-500 dark:text-blue-500 text-[11px] border-t border-blue-200 dark:border-blue-700 pt-1.5 mt-1.5">
            Tip: The first agent receives the Input node's output (which contains <code>{"{{userInput}}"}</code>)
          </p>
        </div>
      </div>

      {/* Output Key */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Output Key <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={data.outputKey || ''}
          onChange={(e) => onChange('outputKey', e.target.value)}
          className="input-primary text-sm font-mono"
          placeholder="e.g. analysis"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Give this output a name so later nodes can reference it directly.
          {data.outputKey && (
            <span className="block mt-1 text-blue-600 dark:text-blue-400">
              Later nodes can use: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{`{{${data.outputKey}}}`}</code>
            </span>
          )}
        </p>
      </div>
    </>
  );
}

// Output node specific fields
function OutputNodeFields({ data, onChange }) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Output Format
        </label>
        <select
          value={data.outputFormat || 'text'}
          onChange={(e) => onChange('outputFormat', e.target.value)}
          className="input-primary text-sm"
        >
          <option value="text">Plain Text</option>
          <option value="json">JSON</option>
          <option value="markdown">Markdown</option>
        </select>
      </div>
    </>
  );
}

/**
 * TypedIOSection — edit the v2 typed inputs[] / outputs[] for a node.
 *
 * Each row is { name, type, required? }. Add/remove rows updates the
 * top-level node fields (NOT node.data) via onUpdateTop. Backend
 * schema validator enforces uniqueness + known types — invalid
 * configs are caught at save.
 */
function TypedIOSection({ node, onUpdateTop }) {
  const inputs  = Array.isArray(node.inputs)  ? node.inputs  : [];
  const outputs = Array.isArray(node.outputs) ? node.outputs : [];

  const updateField = (kind, idx, patch) => {
    const arr = (node[kind] || []).slice();
    arr[idx] = { ...arr[idx], ...patch };
    onUpdateTop({ [kind]: arr, schemaVersion: 2 });
  };

  const addField = (kind) => {
    const arr = (node[kind] || []).slice();
    const base = kind === 'inputs'
      ? { name: `field${arr.length + 1}`, type: 'text', required: true }
      : { name: `field${arr.length + 1}`, type: 'text' };
    arr.push(base);
    onUpdateTop({ [kind]: arr, schemaVersion: 2 });
  };

  const removeField = (kind, idx) => {
    const arr = (node[kind] || []).slice();
    arr.splice(idx, 1);
    onUpdateTop({ [kind]: arr, schemaVersion: 2 });
  };

  // Input nodes don't take inputs (they're sources); output nodes
  // don't produce typed outputs (they're sinks). Skip those sections.
  const showInputs  = node.type !== 'input';
  const showOutputs = node.type !== 'output';

  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          Typed I/O
          <span className="text-[10px] font-normal text-gray-400 uppercase tracking-wide">v2</span>
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Declare the named, typed payload this node receives and produces.
        </p>
      </div>

      {showInputs && (
        <FieldEditorBlock
          title="Inputs"
          subtitle="Edges feed these fields by name"
          rows={inputs}
          kind="inputs"
          onUpdate={updateField}
          onAdd={addField}
          onRemove={removeField}
        />
      )}

      {showOutputs && (
        <FieldEditorBlock
          title="Outputs"
          subtitle="Agent must produce these fields in job-done"
          rows={outputs}
          kind="outputs"
          onUpdate={updateField}
          onAdd={addField}
          onRemove={removeField}
        />
      )}
    </div>
  );
}

function FieldEditorBlock({ title, subtitle, rows, kind, onUpdate, onAdd, onRemove }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{title}</span>
          <span className="text-xs text-gray-400 ml-2">{subtitle}</span>
        </div>
        <button
          type="button"
          onClick={() => onAdd(kind)}
          className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          title={`Add ${kind === 'inputs' ? 'input' : 'output'}`}
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 italic px-1 py-1">None declared</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <FieldRow
              key={idx}
              row={row}
              kind={kind}
              onUpdate={(patch) => onUpdate(kind, idx, patch)}
              onRemove={() => onRemove(kind, idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * FieldRow — single I/O declaration as a card with:
 *   - row 1: name | type | required-checkbox (inputs only) | remove
 *   - row 2: description input (compact, always shown)
 *   - row 3 (collapsible): example (JSON) editor
 *
 * Keeps the editor visually dense while making the rich contract
 * fields discoverable and editable.
 */
function FieldRow({ row, kind, onUpdate, onRemove }) {
  const [exampleOpen, setExampleOpen] = useState(
    row.example !== undefined && row.example !== null
  );
  // Local example text so we can let the user type invalid JSON while
  // editing without thrashing the persisted value. Commit on blur.
  const [exampleText, setExampleText] = useState(() =>
    row.example === undefined ? ''
    : (typeof row.example === 'string' ? JSON.stringify(row.example) : JSON.stringify(row.example, null, 2))
  );
  const [exampleError, setExampleError] = useState(null);

  const commitExample = () => {
    if (!exampleText.trim()) {
      onUpdate({ example: undefined });
      setExampleError(null);
      return;
    }
    try {
      const parsed = JSON.parse(exampleText);
      onUpdate({ example: parsed });
      setExampleError(null);
    } catch (err) {
      setExampleError(err.message);
    }
  };

  return (
    <div className="p-1.5 bg-gray-50 dark:bg-gray-900/40 rounded border border-gray-200 dark:border-gray-700 space-y-1">
      {/* Row 1: name + type + required + remove */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={row.name || ''}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="name"
          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-loxia-500"
        />
        <select
          value={row.type || 'text'}
          onChange={(e) => onUpdate({ type: e.target.value })}
          className={`px-1.5 py-0.5 text-[10px] font-mono rounded border-0 cursor-pointer ${TYPE_COLORS[row.type] || 'bg-gray-100 text-gray-700'}`}
        >
          {FLOW_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {kind === 'inputs' && (
          <label className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={!!row.required}
              onChange={(e) => onUpdate({ required: e.target.checked })}
              className="h-3 w-3"
            />
            req
          </label>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-gray-400 hover:text-red-600"
          title="Remove field"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Row 2: description (always visible). Same description is read
          by both producer and consumer of this field — write it as a
          contract: "what this is + how to format/use it". */}
      <input
        type="text"
        value={row.description || ''}
        onChange={(e) => onUpdate({ description: e.target.value })}
        placeholder={kind === 'inputs'
          ? 'What this input represents + how to use it'
          : 'What to produce + format requirements'}
        className="w-full px-1.5 py-0.5 text-[11px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500"
      />

      {/* Row 3: example (collapsible — most fields don't need one). */}
      <div>
        <button
          type="button"
          onClick={() => setExampleOpen(o => !o)}
          className="text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          {exampleOpen ? '− example' : '+ example'}
        </button>
        {exampleOpen && (
          <>
            <textarea
              value={exampleText}
              onChange={(e) => setExampleText(e.target.value)}
              onBlur={commitExample}
              placeholder={row.type === 'json' ? '{\n  "key": "value"\n}' : 'JSON-encoded example'}
              rows={3}
              className="w-full mt-1 px-1.5 py-1 text-[11px] font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-loxia-500 resize-none"
            />
            {exampleError && (
              <p className="text-[10px] text-red-500 mt-0.5">JSON parse: {exampleError}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * ExecutionSection — per-node retry/timeout overrides.
 * Maps to node.execution = { timeoutMs, maxRetries } consumed by
 * FlowExecutor._resolveExecutionConfig.
 */
function ExecutionSection({ node, onUpdateTop }) {
  const exec = node.execution || {};
  const setExec = (patch) => {
    const next = { ...exec, ...patch };
    // Drop empty values so JSON stays clean
    for (const k of Object.keys(next)) {
      if (next[k] === '' || next[k] === undefined) delete next[k];
    }
    onUpdateTop({ execution: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Execution</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Per-node retry and timeout overrides. Defaults: 5min, no retries.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">
            Timeout (sec)
          </label>
          <input
            type="number"
            min={1}
            value={exec.timeoutMs ? Math.round(exec.timeoutMs / 1000) : ''}
            onChange={(e) => {
              const sec = parseInt(e.target.value, 10);
              setExec({ timeoutMs: Number.isFinite(sec) ? sec * 1000 : '' });
            }}
            placeholder="300"
            className="input-primary text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">
            Max retries
          </label>
          <input
            type="number"
            min={0}
            max={10}
            value={exec.maxRetries ?? ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setExec({ maxRetries: Number.isFinite(n) ? n : '' });
            }}
            placeholder="0"
            className="input-primary text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// Node type configuration
function getNodeTypeConfig(type) {
  switch (type) {
    case 'input':
      return {
        title: 'Input Node',
        icon: ArrowRightStartOnRectangleIcon,
        headerBg: 'bg-green-50 dark:bg-green-900/30',
        headerBorder: 'border-green-200 dark:border-green-800',
        iconBg: 'bg-green-100 dark:bg-green-800',
        iconColor: 'text-green-600 dark:text-green-400',
        textColor: 'text-green-800 dark:text-green-200'
      };
    case 'agent':
      return {
        title: 'Agent Node',
        icon: CpuChipIcon,
        headerBg: 'bg-blue-50 dark:bg-blue-900/30',
        headerBorder: 'border-blue-200 dark:border-blue-800',
        iconBg: 'bg-blue-100 dark:bg-blue-800',
        iconColor: 'text-blue-600 dark:text-blue-400',
        textColor: 'text-blue-800 dark:text-blue-200'
      };
    case 'output':
      return {
        title: 'Output Node',
        icon: ArrowRightEndOnRectangleIcon,
        headerBg: 'bg-amber-50 dark:bg-amber-900/30',
        headerBorder: 'border-amber-200 dark:border-amber-800',
        iconBg: 'bg-amber-100 dark:bg-amber-800',
        iconColor: 'text-amber-600 dark:text-amber-400',
        textColor: 'text-amber-800 dark:text-amber-200'
      };
    default:
      return {
        title: 'Node',
        icon: CpuChipIcon,
        headerBg: 'bg-gray-50 dark:bg-gray-900/30',
        headerBorder: 'border-gray-200 dark:border-gray-700',
        iconBg: 'bg-gray-100 dark:bg-gray-700',
        iconColor: 'text-gray-600 dark:text-gray-400',
        textColor: 'text-gray-800 dark:text-gray-200'
      };
  }
}

export default NodePropertiesPanel;
