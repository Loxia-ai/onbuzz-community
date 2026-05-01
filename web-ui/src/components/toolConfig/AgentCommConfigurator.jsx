/**
 * AgentCommConfigurator — per-agent configuration for the
 * `agentcommunication` tool.
 *
 * Fields (all optional):
 *   - enableBroadcast:          boolean
 *   - maxRecipientsPerMessage:  number (1..N)
 *   - maxConversationDepth:     number (reply chain cap)
 *   - maxAttachmentsPerMessage: number
 *   - maxAttachmentSize:        number bytes (rendered as MB)
 *   - messageRetentionPeriod:   number ms (rendered as hours)
 *
 * Backend merges via BaseTool#getEffectiveConfig at execute time.
 */

import React from 'react';

const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;

function NumberField({ id, label, hint, value, unit, scale, min, step, onChange, disabled }) {
  const displayValue = value == null
    ? ''
    : (scale ? (value / scale).toFixed(2).replace(/\.?0+$/, '') : String(value));
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
        {label}{unit ? ` (${unit})` : ''}
      </label>
      {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{hint}</p>}
      <input
        id={id}
        type="number"
        min={min}
        step={step}
        value={displayValue}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null); // clear
          } else {
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) {
              onChange(scale ? Math.round(n * scale) : Math.round(n));
            }
          }
        }}
        className="w-36 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-loxia-500 disabled:opacity-50"
      />
    </div>
  );
}

function AgentCommConfigurator({ value, onChange, disabled }) {
  const cfg = value || {};

  const setField = (key, newVal) => {
    if (newVal === null) {
      const { [key]: _removed, ...rest } = cfg;
      onChange(rest);
    } else {
      onChange({ ...cfg, [key]: newVal });
    }
  };

  return (
    <div className="space-y-4" data-testid="agentcomm-configurator">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!cfg.enableBroadcast}
          disabled={disabled}
          onChange={(e) => setField('enableBroadcast', e.target.checked)}
          className="mt-0.5 h-4 w-4 text-loxia-600 focus:ring-loxia-500 border-gray-300 rounded"
        />
        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Enable broadcast</div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Allow this agent to send broadcast messages to all agents at once.
          </p>
        </div>
      </label>

      <NumberField
        id="ac-max-recipients"
        label="Max recipients per message"
        hint="Hard cap on how many recipients a single send/reply can target. Leave blank for global default."
        value={cfg.maxRecipientsPerMessage}
        unit={null}
        min={1}
        step={1}
        onChange={(v) => setField('maxRecipientsPerMessage', v)}
        disabled={disabled}
      />

      <NumberField
        id="ac-max-depth"
        label="Max conversation depth"
        hint="Maximum reply chain length before the thread is capped."
        value={cfg.maxConversationDepth}
        unit={null}
        min={1}
        step={1}
        onChange={(v) => setField('maxConversationDepth', v)}
        disabled={disabled}
      />

      <NumberField
        id="ac-max-attachments"
        label="Max attachments per message"
        hint="Hard cap on attachments per outbound message."
        value={cfg.maxAttachmentsPerMessage}
        unit={null}
        min={1}
        step={1}
        onChange={(v) => setField('maxAttachmentsPerMessage', v)}
        disabled={disabled}
      />

      <NumberField
        id="ac-max-attachment-size"
        label="Max attachment size"
        hint="Maximum size of any single attachment."
        value={cfg.maxAttachmentSize}
        unit="MB"
        scale={MB}
        min={0.1}
        step={0.5}
        onChange={(v) => setField('maxAttachmentSize', v)}
        disabled={disabled}
      />

      <NumberField
        id="ac-retention"
        label="Message retention"
        hint="Messages older than this are purged from the in-memory store."
        value={cfg.messageRetentionPeriod}
        unit="hours"
        scale={HOUR}
        min={1}
        step={1}
        onChange={(v) => setField('messageRetentionPeriod', v)}
        disabled={disabled}
      />
    </div>
  );
}

export default AgentCommConfigurator;
