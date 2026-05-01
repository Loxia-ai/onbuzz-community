/**
 * MemoryRenderer
 *
 * The memory tool has two personalities:
 *
 *  A) CRUD side — add/update/delete/list/read/search/stats over long-term
 *     memories. Rendered as an index-card rolodex: every memory is a
 *     ruled-paper card with a title strip, a spine tab, and a discreet
 *     timestamp — cards fan slightly when stacked.
 *
 *  B) Reminisce side — a conversation-archive scope (overview/range/search/
 *     around/byTool/read). Rendered as a sepia-toned timeline: each message
 *     echo is a hair-line dot on a vertical rail, with role-coloured
 *     chat bubbles on alternating sides, tool-call receipts shown as
 *     tiny punch-card stubs, and an amber "you are here" pin for the
 *     `around`/`read` center.
 *
 * The two surfaces share a single chrome — a card with a sepia linen
 * header — so they feel like the same object, different page.
 */

import React, { useMemo } from 'react';
import {
  CircleStackIcon,
  PlusCircleIcon,
  PencilSquareIcon,
  TrashIcon,
  BookmarkIcon,
  MagnifyingGlassIcon,
  ChartBarIcon,
  ClockIcon,
  ChatBubbleLeftEllipsisIcon,
  ArrowsUpDownIcon,
  MapPinIcon,
  HashtagIcon,
  DocumentTextIcon,
  EyeIcon,
  WrenchScrewdriverIcon
} from '@heroicons/react/24/outline';
import { extractResult } from './usePersistedState';

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(ts); }
}

function fmtRelative(ts) {
  if (!ts) return '';
  const d = new Date(ts).getTime();
  const diff = Date.now() - d;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ${diff > 0 ? 'ago' : 'ahead'}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ${diff > 0 ? 'ago' : 'ahead'}`;
  const d2 = Math.round(h / 24);
  return `${d2}d ${diff > 0 ? 'ago' : 'ahead'}`;
}

function roleDot(role) {
  switch (role) {
    case 'user':      return 'bg-sky-500';
    case 'assistant': return 'bg-emerald-500';
    case 'tool':      return 'bg-violet-500';
    case 'system':    return 'bg-amber-500';
    default:          return 'bg-gray-400';
  }
}

function roleBubble(role) {
  switch (role) {
    case 'user':
      return 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-100';
    case 'assistant':
      return 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100';
    case 'tool':
      return 'bg-violet-50 dark:bg-violet-900/30 border-violet-200 dark:border-violet-800 text-violet-900 dark:text-violet-100';
    case 'system':
      return 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100';
    default:
      return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200';
  }
}

/* ------------------------------------------------------------------ */
/*  Rolodex card — single memory                                       */
/* ------------------------------------------------------------------ */

function RolodexCard({ memory, accent = 'amber', badge }) {
  const title       = memory.title || memory.name || '(untitled memory)';
  const description = memory.description;
  const content     = memory.content;
  const createdAt   = memory.createdAt || memory.created_at;
  const updatedAt   = memory.updatedAt || memory.updated_at;
  const expiration  = memory.expiration;
  const accessCount = memory.accessCount ?? memory.access_count;

  return (
    <div className="relative group">
      {/* spine tab */}
      <div className={`absolute -left-1 top-3 bottom-3 w-1 rounded-l ${
        accent === 'rose'    ? 'bg-rose-400' :
        accent === 'emerald' ? 'bg-emerald-400' :
        accent === 'sky'     ? 'bg-sky-400' :
        'bg-amber-400'
      }`} />
      <div
        className="ml-1 rounded-md border border-amber-200/70 dark:border-amber-900/40 bg-[linear-gradient(to_bottom,#fffbeb_0,#fffbeb_28px,#fef3c7_28px,#fef3c7_29px,#fffbeb_29px)] dark:bg-gradient-to-b dark:from-amber-950/40 dark:to-amber-950/10 shadow-sm hover:shadow-md transition-shadow"
        style={{ backgroundSize: '100% 29px' }}
      >
        <div className="flex items-start justify-between px-3 pt-2 pb-1 border-b border-amber-200/70 dark:border-amber-900/40">
          <div className="flex items-center gap-2 min-w-0">
            <BookmarkIcon className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-semibold text-amber-950 dark:text-amber-100 truncate">
              {title}
            </span>
          </div>
          {badge}
        </div>

        {description && (
          <div className="px-3 pt-2 text-xs text-amber-900/80 dark:text-amber-200/80 italic">
            {description}
          </div>
        )}
        {content && (
          <div className="px-3 py-2 text-sm text-amber-950 dark:text-amber-100 whitespace-pre-wrap leading-[29px]">
            {content.length > 600 ? content.slice(0, 600) + '…' : content}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-t border-amber-200/70 dark:border-amber-900/40 text-[11px] text-amber-800/80 dark:text-amber-300/80">
          {createdAt && <span title={new Date(createdAt).toISOString()}>📝 {fmtTime(createdAt)}</span>}
          {updatedAt && updatedAt !== createdAt && <span>✎ {fmtTime(updatedAt)}</span>}
          {expiration && <span>⏳ {fmtTime(expiration)}</span>}
          {accessCount != null && <span>👁 {accessCount} reads</span>}
          {memory.id && (
            <span className="ml-auto font-mono text-amber-700/60 dark:text-amber-400/50 truncate max-w-[160px]">
              #{memory.id}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Action chips                                                       */
/* ------------------------------------------------------------------ */

function ActionChip({ icon: Icon, label, tint = 'amber' }) {
  const tints = {
    amber:   'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    rose:    'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    sky:     'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
    violet:  'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${tints[tint] || tints.amber}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Reminisce sub-renderers                                            */
/* ------------------------------------------------------------------ */

function MessageEcho({ entry, side, isCenter }) {
  const { role, at, messageId, snippet, preview, content } = entry;
  const text = snippet || preview || content || '';
  return (
    <div className={`relative flex ${side === 'right' ? 'justify-end' : 'justify-start'} pl-8 pr-2 py-1.5`}>
      {/* dot on the rail */}
      <div className="absolute left-[22px] top-3 -translate-x-1/2">
        <div className={`w-2.5 h-2.5 rounded-full ring-2 ring-amber-50 dark:ring-amber-950 ${roleDot(role)} ${isCenter ? 'ring-4 ring-amber-400/60 dark:ring-amber-300/70' : ''}`} />
      </div>
      <div className={`relative max-w-[78%] rounded-lg border px-3 py-1.5 shadow-sm ${roleBubble(role)} ${isCenter ? 'ring-2 ring-amber-400 dark:ring-amber-300' : ''}`}>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-60 mb-0.5">
          <span className="font-semibold">{role || 'msg'}</span>
          {at && <span>· {fmtTime(at)}</span>}
          {messageId && <span className="font-mono opacity-60">#{String(messageId).slice(-6)}</span>}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words leading-snug">
          {text.length > 320 ? text.slice(0, 320) + '…' : text}
        </div>
        {isCenter && (
          <MapPinIcon className="absolute -top-2 -right-2 w-5 h-5 text-amber-500 drop-shadow" />
        )}
      </div>
    </div>
  );
}

function ReminisceRail({ messages = [], centerId, sparse = false }) {
  if (!messages.length) {
    return (
      <div className="px-4 py-6 text-center text-sm text-amber-800/60 dark:text-amber-300/60 italic">
        (no messages in this range)
      </div>
    );
  }
  return (
    <div className="relative">
      {/* vertical rail */}
      <div className="absolute left-[22px] top-0 bottom-0 w-px bg-gradient-to-b from-amber-300/0 via-amber-500/40 to-amber-300/0 dark:via-amber-400/30" />
      <div className={sparse ? 'space-y-2 py-2' : 'py-1'}>
        {messages.map((m, i) => {
          const id = m.messageId || m.id;
          const isCenter = !!centerId && (id === centerId);
          const side = m.role === 'assistant' ? 'left' : (m.role === 'user' ? 'right' : 'left');
          return (
            <MessageEcho key={id || i} entry={m} side={side} isCenter={isCenter} />
          );
        })}
      </div>
    </div>
  );
}

function ToolCallReceipt({ call }) {
  const statusColor = call.status === 'completed'
    ? 'text-emerald-600 dark:text-emerald-400'
    : call.status === 'failed'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-amber-600 dark:text-amber-400';
  return (
    <div className="flex items-start gap-3 py-1.5 pl-8 pr-2 relative">
      <div className="absolute left-[22px] top-3 -translate-x-1/2">
        <div className="w-2.5 h-2.5 rounded-sm ring-2 ring-amber-50 dark:ring-amber-950 bg-violet-500 rotate-45" />
      </div>
      <div className="flex-1 border border-dashed border-violet-300/60 dark:border-violet-700/60 rounded-md bg-white/60 dark:bg-violet-950/20 px-3 py-1.5 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          <WrenchScrewdriverIcon className="w-3.5 h-3.5 text-violet-500" />
          <span className="font-semibold text-violet-800 dark:text-violet-200">{call.toolId}</span>
          <span className={`uppercase tracking-wider ${statusColor}`}>{call.status}</span>
          {call.at && <span className="ml-auto text-gray-500 dark:text-gray-400">{fmtTime(call.at)}</span>}
        </div>
        {call.inputSnippet && (
          <div className="mt-1 text-gray-600 dark:text-gray-400 truncate">
            {call.inputSnippet}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary stat plates                                                */
/* ------------------------------------------------------------------ */

function StatPlate({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40">
      {Icon && <Icon className="w-4 h-4 text-amber-700 dark:text-amber-400" />}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70">{label}</span>
        <span className="text-sm font-semibold text-amber-950 dark:text-amber-100">{value}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main renderer                                                      */
/* ------------------------------------------------------------------ */

function parseMemoryInvocation(parsedData) {
  if (!parsedData) return null;
  return {
    action: parsedData.action,
    mode: parsedData.mode,
    id: parsedData.id,
    title: parsedData.title,
    description: parsedData.description,
    content: parsedData.content,
    expiration: parsedData.expiration,
    level: parsedData.level,
    query: parsedData.query,
    // reminisce-scoped
    from: parsedData.from,
    to: parsedData.to,
    offset: parsedData.offset,
    limit: parsedData.limit,
    role: parsedData.role,
    maxResults: parsedData.maxResults,
    cursor: parsedData.cursor,
    messageId: parsedData.messageId,
    before: parsedData.before,
    after: parsedData.after,
    toolId: parsedData.toolId,
    lineFrom: parsedData.lineFrom,
    lineTo: parsedData.lineTo,
    contentFrom: parsedData.contentFrom,
    contentTo: parsedData.contentTo,
  };
}

function MemoryRenderer({ parsedData }) {
  const inv = useMemo(() => parseMemoryInvocation(parsedData), [parsedData]);
  const { hasResults, result, success, error } = extractResult(parsedData);

  if (!inv) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-3 my-1 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-700 text-sm">
        <CircleStackIcon className="w-4 h-4" />
        <span>Memory (no input parsed)</span>
      </div>
    );
  }

  const action  = inv.action || 'memory';
  const isReminisce = action === 'reminisce';
  const mode    = inv.mode;
  const reminisceResult = result?.result || result; // tool wraps reminisce in .result

  /* ---------- header meta ---------- */
  const actionIcon = {
    add:    PlusCircleIcon,
    update: PencilSquareIcon,
    delete: TrashIcon,
    list:   BookmarkIcon,
    read:   DocumentTextIcon,
    search: MagnifyingGlassIcon,
    stats:  ChartBarIcon,
    reminisce: ClockIcon,
  }[action] || CircleStackIcon;
  const ActionIcon = actionIcon;

  const titleText = isReminisce
    ? `Reminisce · ${mode || 'overview'}`
    : `Memory · ${action}`;

  /* ---------- header subtitle ---------- */
  const subtitleParts = [];
  if (inv.id)        subtitleParts.push(`#${inv.id}`);
  if (inv.title)     subtitleParts.push(`"${inv.title}"`);
  if (inv.query)     subtitleParts.push(`q: "${inv.query}"`);
  if (inv.toolId)    subtitleParts.push(`toolId: ${inv.toolId}`);
  if (inv.messageId) subtitleParts.push(`@ ${String(inv.messageId).slice(-8)}`);
  if (inv.from || inv.to) subtitleParts.push(`${inv.from || '…'} → ${inv.to || '…'}`);
  if (inv.role)      subtitleParts.push(`role: ${inv.role}`);

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-amber-300/70 dark:border-amber-900/50 shadow-sm bg-amber-50/40 dark:bg-amber-950/10">
      {/* linen header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 dark:from-amber-950/70 dark:via-amber-950/50 dark:to-amber-950/70 border-b border-amber-300/70 dark:border-amber-900/50">
        <div className="w-8 h-8 rounded-full bg-amber-200/80 dark:bg-amber-900/60 flex items-center justify-center">
          <ActionIcon className="w-4 h-4 text-amber-800 dark:text-amber-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-950 dark:text-amber-100 tracking-wide">
            {titleText}
          </div>
          {subtitleParts.length > 0 && (
            <div className="text-[11px] text-amber-800/70 dark:text-amber-300/70 font-mono truncate">
              {subtitleParts.join(' · ')}
            </div>
          )}
        </div>
        {hasResults && !success && (
          <ActionChip label="failed" tint="rose" />
        )}
        {hasResults && success && (
          <ActionChip label="ok" tint="emerald" />
        )}
      </div>

      {/* body */}
      <div className="p-3 space-y-3">
        {/* REMINISCE */}
        {isReminisce && renderReminisce(mode, reminisceResult, inv)}

        {/* CRUD */}
        {!isReminisce && renderCrud(action, result, inv, error)}

        {/* executing placeholder */}
        {!hasResults && (
          <div className="flex items-center gap-2 text-xs text-amber-700/70 dark:text-amber-400/70 italic">
            <ClockIcon className="w-3.5 h-3.5 animate-pulse" />
            <span>Consulting the archive…</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CRUD branch                                                         */
/* ------------------------------------------------------------------ */

function renderCrud(action, result, inv, error) {
  if (error) {
    return (
      <div className="px-3 py-2 text-sm bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded">
        {error}
      </div>
    );
  }

  const memoriesByDate = result?.memoriesByDate;
  const memories       = result?.memories || result?.results;
  const single         = result?.memory;
  const stats          = result?.stats;

  // stats
  if (action === 'stats' && stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {Object.entries(stats).map(([k, v]) => (
          <StatPlate key={k} label={k.replace(/([A-Z])/g, ' $1')} value={String(v)} icon={HashtagIcon} />
        ))}
      </div>
    );
  }

  // single read / add / update
  if (single) {
    return <RolodexCard memory={single} accent={action === 'add' ? 'emerald' : action === 'update' ? 'sky' : 'amber'} />;
  }

  // list/search — show rolodex stack
  if (memoriesByDate && typeof memoriesByDate === 'object') {
    const entries = Object.entries(memoriesByDate);
    if (!entries.length) return <EmptyRolodex text="No memories yet." />;
    return (
      <div className="space-y-3">
        {entries.map(([date, items]) => (
          <div key={date}>
            <div className="text-[11px] uppercase tracking-widest font-semibold text-amber-800/60 dark:text-amber-400/60 mb-1.5">
              {date}
            </div>
            <div className="space-y-2">
              {(Array.isArray(items) ? items : []).map((m, i) => (
                <RolodexCard key={m.id || i} memory={m} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (Array.isArray(memories)) {
    if (!memories.length) return <EmptyRolodex text={inv.query ? `No memories match "${inv.query}".` : 'No memories.'} />;
    return (
      <div className="space-y-2">
        {memories.map((m, i) => (
          <RolodexCard key={m.id || i} memory={m} badge={m.score != null ? <ActionChip label={`score ${m.score.toFixed ? m.score.toFixed(2) : m.score}`} tint="sky" /> : null} />
        ))}
      </div>
    );
  }

  // delete
  if (action === 'delete') {
    return (
      <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
        <TrashIcon className="w-4 h-4" />
        <span>Memory {inv.id ? <code className="font-mono">#{inv.id}</code> : ''} removed.</span>
      </div>
    );
  }

  // unknown shape — minimal echo
  return result ? (
    <pre className="text-xs font-mono bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 p-2 rounded overflow-x-auto whitespace-pre-wrap">
      {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
    </pre>
  ) : null;
}

function EmptyRolodex({ text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-amber-700/70 dark:text-amber-400/70">
      <BookmarkIcon className="w-6 h-6" />
      <span className="text-sm italic">{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reminisce branch                                                    */
/* ------------------------------------------------------------------ */

function renderReminisce(mode, result, inv) {
  if (!result) return null;

  /* overview */
  if (mode === 'overview') {
    const { totalMessages, firstAt, lastAt, totalApproxTokens, timeline } = result;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatPlate label="messages" value={totalMessages ?? '—'} icon={ChatBubbleLeftEllipsisIcon} />
          <StatPlate label="tokens ≈" value={totalApproxTokens?.toLocaleString?.() ?? '—'} icon={HashtagIcon} />
          <StatPlate label="first" value={fmtRelative(firstAt)} icon={ClockIcon} />
          <StatPlate label="last" value={fmtRelative(lastAt)} icon={ClockIcon} />
        </div>
        <ReminisceRail messages={timeline || []} sparse />
      </div>
    );
  }

  /* range */
  if (mode === 'range') {
    const msgs = result.messages || [];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-amber-800/70 dark:text-amber-300/70">
          <ArrowsUpDownIcon className="w-4 h-4" />
          <span>{msgs.length} of {result.total ?? msgs.length} messages</span>
          {result.hasMore && <ActionChip label="has more" tint="sky" />}
          {result.offset != null && <span className="ml-auto font-mono">offset {result.offset}</span>}
        </div>
        <ReminisceRail messages={msgs} />
      </div>
    );
  }

  /* search */
  if (mode === 'search') {
    const hits = result.matches || result.hits || [];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-amber-800/70 dark:text-amber-300/70">
          <MagnifyingGlassIcon className="w-4 h-4" />
          <span>{hits.length} match{hits.length === 1 ? '' : 'es'} for <code className="font-mono">"{inv.query}"</code></span>
          {result.hasMore && <ActionChip label="more available" tint="sky" />}
        </div>
        <ReminisceRail messages={hits} />
      </div>
    );
  }

  /* around — center pinned */
  if (mode === 'around') {
    const msgs = result.messages || [];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-amber-800/70 dark:text-amber-300/70">
          <MapPinIcon className="w-4 h-4" />
          <span>{msgs.length} surrounding messages · center: <code className="font-mono">{String(inv.messageId || '').slice(-8)}</code></span>
        </div>
        <ReminisceRail messages={msgs} centerId={result.center?.messageId || inv.messageId} />
      </div>
    );
  }

  /* byTool — punch-card stubs */
  if (mode === 'byTool') {
    const calls = result.toolCalls || [];
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-amber-800/70 dark:text-amber-300/70">
          <WrenchScrewdriverIcon className="w-4 h-4" />
          <span>{calls.length} tool call{calls.length === 1 ? '' : 's'}{inv.toolId ? ` for ${inv.toolId}` : ''}</span>
        </div>
        <div className="relative">
          <div className="absolute left-[22px] top-0 bottom-0 w-px bg-gradient-to-b from-violet-300/0 via-violet-500/40 to-violet-300/0 dark:via-violet-400/30" />
          {calls.map((c, i) => (
            <ToolCallReceipt key={c.messageId || i} call={c} />
          ))}
        </div>
      </div>
    );
  }

  /* read — full message rendered as a document fragment */
  if (mode === 'read') {
    const msg = result.message;
    if (!msg) return null;
    const w = msg.contentWindow || {};
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-amber-300/60 dark:border-amber-900/50 bg-white/70 dark:bg-amber-950/20 overflow-hidden">
          {/* subtitle */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-amber-100/50 dark:bg-amber-900/30 text-[11px] font-mono text-amber-800 dark:text-amber-200 border-b border-amber-200/60 dark:border-amber-900/40">
            <span className={`px-1.5 py-0.5 rounded ${roleBubble(msg.role)} !border-0`}>{msg.role}</span>
            {msg.at && <span>· {fmtTime(msg.at)}</span>}
            {msg.model && <span>· {msg.model}</span>}
            {msg.tokenCount != null && <span>· {msg.tokenCount} tok</span>}
            {msg.hasToolCalls && <span className="text-violet-600 dark:text-violet-300">· tool-calls</span>}
            <span className="ml-auto">#{String(msg.messageId || '').slice(-8)}</span>
          </div>

          {/* content window */}
          <div className="px-4 py-3 text-sm text-amber-950 dark:text-amber-100 whitespace-pre-wrap font-mono leading-relaxed max-h-[480px] overflow-auto">
            {msg.content || <span className="italic opacity-60">(empty)</span>}
          </div>

          {/* window meta strip */}
          <div className="flex items-center gap-3 px-3 py-1 border-t border-amber-200/60 dark:border-amber-900/40 text-[10px] text-amber-700/70 dark:text-amber-400/70 font-mono">
            {w.kind && <span>window: {w.kind}</span>}
            {w.lineFrom != null && <span>lines {w.lineFrom}–{w.lineTo}{w.totalLines ? ` / ${w.totalLines}` : ''}</span>}
            {w.contentFrom != null && <span>bytes {w.contentFrom}–{w.contentTo}</span>}
            {w.hasMoreBefore && <span className="text-sky-600 dark:text-sky-400">← more before</span>}
            {w.hasMoreAfter && <span className="text-sky-600 dark:text-sky-400">more after →</span>}
            {w.truncatedAtBytes && <span className="text-rose-600 dark:text-rose-400">truncated @ {w.truncatedAtBytes}</span>}
          </div>
        </div>
      </div>
    );
  }

  /* unknown mode */
  return (
    <pre className="text-xs font-mono bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 p-2 rounded overflow-x-auto whitespace-pre-wrap">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

export default MemoryRenderer;
