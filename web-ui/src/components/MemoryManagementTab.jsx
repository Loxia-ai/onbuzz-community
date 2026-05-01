/**
 * MemoryManagementTab — the "Memory" tab in AgentEditModal.
 *
 * Three sections, top-to-bottom:
 *
 *   1. Memories catalog (CRUD): table-style list, inline-edit on click,
 *      "Add memory" button. Backed by /api/agents/:id/memories.
 *
 *   2. Live context snapshot (read-only): the FULL system prompt (with
 *      tool injections), the message array that would be sent to the
 *      model on the next turn, and pending message queues.
 *      Backed by /api/agents/:id/context-snapshot.
 *
 *   3. Stats strip at the top of (2): estimated tokens, message count,
 *      "Refresh" button so the user can re-fetch after taking actions.
 *
 * UX choices:
 *   - Each context section is a collapsible accordion (default: prompt
 *     open, messages collapsed) so the panel doesn't overwhelm.
 *   - Long content gets a "Show more" expander rather than a wall of
 *     text — keeps scroll position predictable.
 *   - System prompt has two views (User-written vs Full) with a tabbed
 *     selector; an "injected: +N bytes" chip surfaces the diff size.
 *   - Inline-edit memories: click a row → fields become editable;
 *     Save / Cancel buttons appear. Avoids modal-on-modal stacking.
 *   - Destructive actions (delete memory) ask confirm() first.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowPathIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

const ROLE_COLORS = {
  system:    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  user:      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  assistant: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  tool:      'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

function copyToClipboard(text) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied to clipboard'),
    () => toast.error('Failed to copy'),
  );
}

function bytesLabel(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Section: collapsible accordion ───────────────────────────────────

function Section({ title, defaultOpen = false, badge, children, dataTestId }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden" data-testid={dataTestId}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-2 text-left bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        {open
          ? <ChevronDownIcon className="w-4 h-4 text-gray-500" />
          : <ChevronRightIcon className="w-4 h-4 text-gray-500" />}
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1">{title}</span>
        {badge}
      </button>
      {open && <div className="p-4 bg-white dark:bg-gray-900">{children}</div>}
    </div>
  );
}

// ── Memory row (display + inline edit) ───────────────────────────────

function MemoryRow({ memory, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: memory.title, description: memory.description || '', content: memory.content });
  const [busy, setBusy] = useState(false);

  // Re-sync draft when the memory prop changes from upstream (e.g. after a save).
  useEffect(() => {
    if (!editing) setDraft({ title: memory.title, description: memory.description || '', content: memory.content });
  }, [memory.title, memory.description, memory.content, editing]);

  const save = async () => {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setBusy(true);
    try {
      await onSave(memory.id, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        content: draft.content,
      });
      setEditing(false);
    } finally { setBusy(false); }
  };

  const expirationLabel = useMemo(() => {
    const e = memory.expiration;
    if (!e || e.type === 'never' || !e.value) return 'never';
    if (e.type === 'date') {
      const d = new Date(e.value);
      return Number.isNaN(d.getTime()) ? e.value : d.toLocaleString();
    }
    return e.value;
  }, [memory.expiration]);

  if (editing) {
    return (
      <div className="border border-loxia-300 dark:border-loxia-700 rounded-lg p-3 space-y-2 bg-loxia-50/50 dark:bg-loxia-900/10" data-testid="memory-row-editing">
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Title"
          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
        <input
          type="text"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Description (optional)"
          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
        <textarea
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          placeholder="Content"
          rows={4}
          className="w-full px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} disabled={busy}
            className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} data-testid="memory-row-save"
            className="px-3 py-1 text-xs bg-loxia-600 text-white rounded hover:bg-loxia-700 disabled:opacity-50 inline-flex items-center gap-1">
            <CheckIcon className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-loxia-300 dark:hover:border-loxia-700" data-testid="memory-row">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{memory.title}</div>
          {memory.description && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{memory.description}</div>
          )}
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
            <span>expires: {expirationLabel}</span>
            {typeof memory.accessCount === 'number' && <span>· read {memory.accessCount}×</span>}
            {memory.lastAccessed && <span>· last {new Date(memory.lastAccessed).toLocaleDateString()}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setEditing(true)} title="Edit" data-testid="memory-row-edit"
            className="p-1 rounded text-gray-400 hover:text-loxia-600 hover:bg-loxia-50 dark:hover:bg-loxia-900/30">
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => onDelete(memory.id, memory.title)} title="Delete" data-testid="memory-row-delete"
            className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20">
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add-memory inline form ────────────────────────────────────────────

function AddMemoryForm({ onAdd, onCancel }) {
  const [draft, setDraft] = useState({ title: '', description: '', content: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    setBusy(true);
    try {
      await onAdd({ title: draft.title.trim(), description: draft.description.trim(), content: draft.content });
      onCancel();
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="border border-loxia-300 dark:border-loxia-700 rounded-lg p-3 space-y-2 bg-loxia-50/50 dark:bg-loxia-900/10" data-testid="memory-add-form">
      <input
        type="text"
        autoFocus
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        placeholder="Memory title"
        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />
      <input
        type="text"
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder="Short description (optional)"
        className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />
      <textarea
        value={draft.content}
        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        placeholder="Content the agent will recall"
        rows={4}
        className="w-full px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy}
          className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={busy} data-testid="memory-add-submit"
          className="px-3 py-1 text-xs bg-loxia-600 text-white rounded hover:bg-loxia-700 disabled:opacity-50">
          Add memory
        </button>
      </div>
    </form>
  );
}

// ── System prompt — tabbed view (original | full with injections) ─────

function SystemPromptView({ original, full, enhancementBytes }) {
  const [view, setView] = useState('full');   // 'original' | 'full'
  const text = view === 'original' ? original : full;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button type="button" onClick={() => setView('full')}
            className={`px-3 py-1 text-xs ${view === 'full' ? 'bg-loxia-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
            data-testid="system-prompt-view-full">
            Full (model sees this)
          </button>
          <button type="button" onClick={() => setView('original')}
            className={`px-3 py-1 text-xs ${view === 'original' ? 'bg-loxia-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}
            data-testid="system-prompt-view-original">
            User-written
          </button>
        </div>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {bytesLabel(text.length)}
          {enhancementBytes > 0 && view === 'full' && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              + {bytesLabel(enhancementBytes)} injected
            </span>
          )}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={() => copyToClipboard(text)} title="Copy"
          className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
          <ClipboardDocumentIcon className="w-4 h-4" />
        </button>
      </div>
      <pre
        className="p-3 max-h-72 overflow-auto text-xs font-mono bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200"
        data-testid="system-prompt-content"
      >
        {text || '(empty)'}
      </pre>
    </div>
  );
}

// ── Single message preview ────────────────────────────────────────────

function MessagePreview({ msg }) {
  const [expanded, setExpanded] = useState(false);
  const cls = ROLE_COLORS[msg.role] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  const display = expanded || !msg.truncated ? msg.contentPreview : msg.contentPreview.slice(0, 280);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded p-2 text-xs" data-testid="context-message">
      <div className="flex items-center gap-2 mb-1">
        <span className={`px-1.5 py-0.5 rounded font-mono ${cls}`}>{msg.role}</span>
        <span className="text-gray-400 dark:text-gray-500">#{msg.index}</span>
        <span className="text-gray-400 dark:text-gray-500">{bytesLabel(msg.contentLength)}</span>
        {msg.hasToolCalls && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">tool calls</span>}
        {msg.toolCallId && <span className="text-[10px] text-gray-400 font-mono truncate">tcid: {msg.toolCallId}</span>}
        <div className="flex-1" />
        {(msg.truncated || msg.contentPreview.length > 280) && (
          <button type="button" onClick={() => setExpanded(e => !e)}
            className="text-loxia-600 hover:underline">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-gray-700 dark:text-gray-300">{display}{(!expanded && (msg.truncated || msg.contentPreview.length > 280)) ? '…' : ''}</pre>
    </div>
  );
}

// ── Pending queue block ───────────────────────────────────────────────

function QueueBlock({ kind, items }) {
  if (!items || items.length === 0) {
    return <div className="text-xs text-gray-400 italic">{kind}: empty</div>;
  }
  return (
    <div>
      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
        {kind} ({items.length})
      </div>
      <div className="space-y-1">
        {items.map((m, i) => (
          <div key={i} className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-gray-50 dark:bg-gray-800/50">
            <pre className="whitespace-pre-wrap break-words font-mono text-gray-700 dark:text-gray-300">{m.contentPreview || '(empty)'}</pre>
            {m.timestamp && <div className="text-[10px] text-gray-400 mt-0.5">{m.timestamp}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────

export default function MemoryManagementTab({ agentId }) {
  const [memories, setMemories] = useState(null);     // null = loading
  const [snapshot, setSnapshot] = useState(null);     // null = loading
  const [adding, setAdding] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [errMsg, setErrMsg] = useState(null);

  const loadMemories = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memories`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setMemories(data.memories || []);
    } catch (err) {
      setErrMsg(err.message);
      setMemories([]);
    }
  }, [agentId]);

  const loadSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/context-snapshot`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setSnapshot(data);
    } catch (err) {
      setErrMsg(err.message);
      setSnapshot({ messages: [], pendingQueues: {}, systemPrompt: { original: '', full: '', enhancementBytes: 0 }, stats: {} });
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    setMemories(null);
    setSnapshot(null);
    setErrMsg(null);
    loadMemories();
    loadSnapshot();
  }, [agentId, refreshTick, loadMemories, loadSnapshot]);

  const handleAdd = async (data) => {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      toast.error(body.error || `HTTP ${res.status}`);
      throw new Error(body.error);
    }
    toast.success('Memory added');
    setMemories(prev => [...(prev || []), body.memory]);
  };

  const handleSave = async (memoryId, updates) => {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      toast.error(body.error || `HTTP ${res.status}`);
      throw new Error(body.error);
    }
    toast.success('Memory updated');
    setMemories(prev => (prev || []).map(m => m.id === memoryId ? body.memory : m));
  };

  const handleDelete = async (memoryId, title) => {
    if (typeof confirm === 'function' && !confirm(`Delete memory "${title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      toast.error(body.error || `HTTP ${res.status}`);
      return;
    }
    toast.success('Memory deleted');
    setMemories(prev => (prev || []).filter(m => m.id !== memoryId));
  };

  if (!agentId) {
    return <div className="text-sm text-gray-500">Save the agent first to access memory.</div>;
  }

  return (
    <div className="space-y-4" data-testid="memory-management-tab">
      {/* Header bar with refresh + token estimate */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-3">
          <span data-testid="memories-count-label">
            {memories === null ? '…' : `${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}`}
          </span>
          {snapshot?.stats && (
            <>
              <span>·</span>
              <span data-testid="ctx-message-count">{snapshot.stats.messageCount} messages</span>
              <span>·</span>
              <span data-testid="ctx-token-estimate">~{snapshot.stats.estimatedTokens?.toLocaleString()} tokens</span>
            </>
          )}
        </div>
        <button type="button" onClick={() => setRefreshTick(t => t + 1)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          data-testid="memory-refresh-btn">
          <ArrowPathIcon className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {errMsg && (
        <div className="px-3 py-2 text-xs text-rose-700 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded">
          {errMsg}
        </div>
      )}

      {/* Section 1: Memories CRUD */}
      <Section
        title="Memories (persistent across sessions)"
        defaultOpen
        badge={
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {memories === null ? '…' : memories.length}
          </span>
        }
        dataTestId="section-memories"
      >
        <div className="space-y-2">
          {!adding && (
            <button type="button" onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-loxia-600 text-white rounded hover:bg-loxia-700"
              data-testid="memory-add-btn">
              <PlusIcon className="w-3.5 h-3.5" />
              Add memory
            </button>
          )}
          {adding && <AddMemoryForm onAdd={handleAdd} onCancel={() => setAdding(false)} />}
          {memories === null ? (
            <div className="text-xs text-gray-500">Loading…</div>
          ) : memories.length === 0 ? (
            <div className="text-xs text-gray-400 italic">No memories yet.</div>
          ) : (
            <div className="space-y-2">
              {memories.map(m => (
                <MemoryRow key={m.id} memory={m} onSave={handleSave} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Section 2: System prompt */}
      <Section
        title="System prompt (next-turn)"
        defaultOpen
        badge={
          snapshot?.systemPrompt && (
            <span className="text-[11px] text-gray-500">
              {bytesLabel(snapshot.systemPrompt.fullLength || 0)}
            </span>
          )
        }
        dataTestId="section-system-prompt"
      >
        {snapshot ? (
          <SystemPromptView
            original={snapshot.systemPrompt?.original || ''}
            full={snapshot.systemPrompt?.full || ''}
            enhancementBytes={snapshot.systemPrompt?.enhancementBytes || 0}
          />
        ) : (
          <div className="text-xs text-gray-500">Loading…</div>
        )}
      </Section>

      {/* Section 3: Messages that would be sent */}
      <Section
        title="Messages sent on next turn"
        defaultOpen
        badge={
          snapshot?.stats && (
            <span className="text-[11px] text-gray-500">
              {snapshot.stats.messageCount} · {bytesLabel(snapshot.stats.totalMessageBytes || 0)}
            </span>
          )
        }
        dataTestId="section-messages"
      >
        {!snapshot ? (
          <div className="text-xs text-gray-500">Loading…</div>
        ) : snapshot.messagesError ? (
          <div className="text-xs text-rose-600">Could not assemble messages: {snapshot.messagesError}</div>
        ) : snapshot.messages.length === 0 ? (
          <div className="text-xs text-gray-400 italic">No messages queued.</div>
        ) : (
          <div className="space-y-1.5">
            {snapshot.messages.map(m => <MessagePreview key={m.index} msg={m} />)}
          </div>
        )}
      </Section>

      {/* Section 4: Pending queues */}
      <Section
        title="Pending queues (not yet folded into history)"
        defaultOpen
        badge={
          snapshot?.pendingQueues && (
            <span className="text-[11px] text-gray-500">
              {(snapshot.pendingQueues.userMessages?.length || 0)
                + (snapshot.pendingQueues.interAgentMessages?.length || 0)
                + (snapshot.pendingQueues.toolResults?.length || 0)}
            </span>
          )
        }
        dataTestId="section-queues"
      >
        {snapshot ? (
          <div className="space-y-3">
            <QueueBlock kind="User messages" items={snapshot.pendingQueues?.userMessages} />
            <QueueBlock kind="Inter-agent messages" items={snapshot.pendingQueues?.interAgentMessages} />
            <QueueBlock kind="Tool results" items={snapshot.pendingQueues?.toolResults} />
          </div>
        ) : (
          <div className="text-xs text-gray-500">Loading…</div>
        )}
      </Section>
    </div>
  );
}
