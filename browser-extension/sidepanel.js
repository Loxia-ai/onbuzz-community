// Side panel logic.
//
//   - Reads the staged selection from chrome.storage.session.
//   - Lets the user optionally type a question.
//   - POSTs { selected_text, source_url, page_title, user_message } to
//     {serverUrl}/api/chat/quick-send with the X-OnBuzz-Token header.
//   - Polls /api/chat/quick-send/messages until the assistant reply
//     appears (or a timeout fires).
//
// The service worker does the staging and side-panel-open; this file
// does everything that needs to live in a regular DOM context.

const DEFAULT_SERVER_URL = 'http://localhost:8080';
const PENDING_KEY = 'pendingSelection';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

const els = {
  appHeaderSub:    document.getElementById('appHeaderSub'),
  selectionCard:   document.getElementById('selectionCard'),
  pageTitle:       document.getElementById('pageTitle'),
  sourceUrl:       document.getElementById('sourceUrl'),
  selectedText:    document.getElementById('selectedText'),
  clearSelection:  document.getElementById('clearSelection'),
  actionChips:     document.getElementById('actionChips'),
  actionChipsRow:  document.getElementById('actionChipsRow'),
  emptyState:      document.getElementById('emptyState'),
  conversation:    document.getElementById('conversation'),
  errorBanner:     document.getElementById('errorBanner'),
  errorTitle:      document.getElementById('errorTitle'),
  errorBody:       document.getElementById('errorBody'),
  composer:        document.getElementById('composer'),
  userMessage:     document.getElementById('userMessage'),
  sendBtn:         document.getElementById('sendBtn'),
  micBtn:          document.getElementById('micBtn'),
  langBtn:         document.getElementById('langBtn'),
  langBadge:       document.getElementById('langBadge'),
  langPopover:     document.getElementById('langPopover'),
  sendHint:        document.getElementById('sendHint'),
  selectionPill:   document.getElementById('selectionPill'),
  settingsBtn:     document.getElementById('settingsBtn')
};

// Mascot URL — used by the bouncing assistant avatar in thinking bubbles.
const MASCOT_URL = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
  ? chrome.runtime.getURL('assets/mascot.webp')
  : 'assets/mascot.webp';

// Direction detection. The design renders Hebrew RTL; we apply dir="rtl"
// to bubbles / the selection quote whenever the first strong-direction
// character in the text is in a Hebrew or Arabic script range. Keeping
// it text-driven (rather than UI-driven) means an English follow-up
// after a Hebrew selection still lays out LTR.
function detectDir(text) {
  if (typeof text !== 'string') return 'ltr';
  // Hebrew block U+0590–U+05FF, Arabic blocks U+0600–U+06FF and U+0750–U+077F.
  const m = text.match(/[֐-׿؀-ۿݐ-ݿ]|[A-Za-z]/);
  if (!m) return 'ltr';
  return /[֐-׿؀-ۿݐ-ݿ]/.test(m[0]) ? 'rtl' : 'ltr';
}

let currentSelection = null;     // { selected_text, source_url, page_title }
let activeAgentId = null;
let activePollAbort = null;      // AbortController for in-flight poll
// Monotonic id stamped on each handleSend invocation. Any continuation
// (try, catch, finally) that finds its id is no longer the latest must
// exit silently. Without this, a stale poll that has already been
// superseded — but whose sleep loop isn't abort-aware — can fire its
// own "Timed out" error 60 s later and overwrite the banner *after*
// the newer poll has already rendered an assistant reply.
let sendInvocationCounter = 0;
let latestSendInvocation = 0;

// ── Settings ────────────────────────────────────────────────
async function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'token'], (items) => {
      resolve({
        serverUrl: (items.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, ''),
        token: items.token || ''
      });
    });
  });
}

// ── Staged selection ───────────────────────────────────────
async function readStagedSelection() {
  return new Promise((resolve) => {
    chrome.storage.session.get([PENDING_KEY], (items) => {
      resolve(items[PENDING_KEY] || null);
    });
  });
}

async function clearStagedSelection() {
  await chrome.storage.session.remove(PENDING_KEY);
}

function hostFromUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch (_err) {
    return rawUrl;
  }
}

function renderSelection(sel) {
  currentSelection = sel;
  if (!sel) {
    // Empty / welcome state — mascot card visible, everything else off.
    els.selectionCard.classList.add('hidden');
    els.actionChips.classList.add('hidden');
    els.conversation.classList.add('hidden');
    els.emptyState.classList.remove('hidden');
    els.selectionPill.classList.add('hidden');
    els.appHeaderSub.textContent = 'No selection yet';
    return;
  }

  els.emptyState.classList.add('hidden');

  // Selection card
  els.selectionCard.classList.remove('hidden');
  els.pageTitle.textContent = sel.page_title || '(untitled page)';
  els.pageTitle.title = sel.page_title || '';
  if (sel.source_url) {
    els.sourceUrl.textContent = hostFromUrl(sel.source_url) || sel.source_url;
    els.sourceUrl.href = sel.source_url;
  } else {
    els.sourceUrl.textContent = '';
    els.sourceUrl.removeAttribute('href');
  }
  const quoteText = sel.selected_text || '';
  const quoteDir = detectDir(quoteText);
  els.selectedText.textContent = quoteText;
  els.selectedText.setAttribute('dir', quoteDir);

  // Action chips visible whenever a selection is staged.
  els.actionChips.classList.remove('hidden');

  // Conversation area starts hidden — revealed on first appendMessage.
  if (els.conversation.children.length === 0) {
    els.conversation.classList.add('hidden');
  }

  // Selection-attached pill in the composer.
  els.selectionPill.classList.remove('hidden');

  // Header sub-label updates to the page host.
  els.appHeaderSub.textContent = hostFromUrl(sel.source_url) || '1 selection captured';
}

// ── Conversation render ────────────────────────────────────
// Bubbles follow the design: user bubble right-aligned with brand-yellow
// fill, assistant bubble left-aligned with a 28px mascot avatar that
// bounces while the LLM is thinking. Direction is per-message — Hebrew
// content renders RTL, with the bubble alignment / corner-rounding
// mirrored. The "loading" form is an assistant bubble with three
// animated dots.
function appendMessage({ role, content, loading = false }) {
  els.conversation.classList.remove('hidden');

  const row = document.createElement('div');
  const text = loading ? '' : (typeof content === 'string' ? content : '');
  const dir = role === 'assistant' && loading
    ? (currentSelection ? detectDir(currentSelection.selected_text) : 'ltr')
    : detectDir(text);
  row.className = `msg-row ${role}`;
  row.setAttribute('dir', dir);

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = `msg-avatar${loading ? ' is-thinking' : ''}`;
    const img = document.createElement('img');
    img.src = MASCOT_URL;
    img.alt = '';
    avatar.appendChild(img);
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}${loading ? ' is-loading' : ''}`;
  bubble.setAttribute('dir', dir);
  if (loading) {
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'ob-dot';
      bubble.appendChild(dot);
    }
  } else {
    bubble.textContent = text;
  }
  row.appendChild(bubble);

  els.conversation.appendChild(row);
  els.conversation.scrollTop = els.conversation.scrollHeight;

  // Once a real assistant reply lands, hide the Quick actions card.
  // The chips are most useful BEFORE the first answer ("how do I want
  // the agent to handle this selection?"). After the answer arrives,
  // they crowd the conversation. A new selection or "Clear selection"
  // brings them back via renderSelection().
  if (role === 'assistant' && !loading && els.actionChips) {
    els.actionChips.classList.add('hidden');
  }

  return row;
}

function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function clearConversation() {
  els.conversation.innerHTML = '';
  els.conversation.classList.add('hidden');
}

// ── Errors ──────────────────────────────────────────────────
// The banner has two text slots now (title + body). Most callers pass
// a single string; we split it on " — " or ". " for a tidy display,
// and fall back to the message as the body if it doesn't split.
function showError(message, opts = {}) {
  let title = opts.title || null;
  let body = opts.body || null;
  if (!title && !body) {
    const raw = String(message || '');
    const splitIdx = raw.indexOf(' — ');
    if (splitIdx > 0 && splitIdx < 80) {
      title = raw.slice(0, splitIdx).trim();
      body = raw.slice(splitIdx + 3).trim();
    } else {
      title = "Couldn't reach OnBuzz";
      body = raw;
    }
  }
  els.errorTitle.textContent = title || 'Something went wrong';
  els.errorBody.textContent = body || '';
  els.errorBanner.classList.remove('hidden');
}

function clearError() {
  els.errorTitle.textContent = '';
  els.errorBody.textContent = '';
  els.errorBanner.classList.add('hidden');
}

// Short banner titles for the structured error codes the backend
// returns from the Quick Send endpoints. Fall back to the server's
// own message if a code isn't in the table.
function titleForErrorCode(code) {
  switch (code) {
    case 'NO_DEFAULT_MODEL':            return 'No default model';
    case 'MODEL_PROVIDER_UNAVAILABLE':  return 'Model provider unavailable';
    case 'PROVIDER_AUTH_ERROR':         return 'Provider key invalid';
    case 'PROVIDER_BILLING_ERROR':      return 'Provider billing issue';
    case 'PROVIDER_RATE_LIMITED':       return 'Provider rate-limited';
    case 'PROVIDER_RUNTIME_ERROR':      return 'Provider error';
    case 'AGENT_PAUSED':                return 'Quick Send agent paused';
    case 'AI_SERVICE_UNAVAILABLE':      return 'AI service not ready';
    default:                            return null;
  }
}

// ── Networking ─────────────────────────────────────────────
async function postQuickSend({ serverUrl, token, selection, userMessage }) {
  const res = await fetch(`${serverUrl}/api/chat/quick-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OnBuzz-Token': token
    },
    body: JSON.stringify({
      selected_text: selection.selected_text,
      source_url:    selection.source_url || null,
      page_title:    selection.page_title || null,
      user_message:  userMessage || null
    })
  });

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }

  if (!res.ok) {
    // Surface the structured error fields the backend returns for
    // provider/model failures (code + message + suggestion +
    // localModelsAvailable). handleSend's catch reads these to build
    // a useful banner instead of a generic "HTTP 503".
    const detail = json && (json.message || json.error)
      ? `: ${json.message || json.error}`
      : '';
    const err = new Error(`HTTP ${res.status}${detail}`);
    err.status = res.status;
    err.code = json?.code || null;
    err.serverMessage = json?.message || json?.error || null;
    err.suggestion = json?.suggestion || null;
    err.localModelsAvailable = json?.localModelsAvailable || false;
    err.structured = Boolean(json?.message || json?.code);
    throw err;
  }
  return json;
}

async function pollForReply({ serverUrl, token, agentId, since, signal }) {
  const start = Date.now();
  // Transient errors (network blips, server restart mid-response) are
  // worth retrying briefly, but a persistent non-2xx is almost always
  // a real failure the user needs to see. Cap silent retries.
  const MAX_TRANSIENT_RETRIES = 3;
  let transientRetries = 0;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    if (signal && signal.aborted) throw new DOMException('Poll aborted', 'AbortError');

    const url = new URL(`${serverUrl}/api/chat/quick-send/messages`);
    url.searchParams.set('agentId', agentId);
    url.searchParams.set('since', String(since));

    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { 'X-OnBuzz-Token': token },
        signal
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (transientRetries++ >= MAX_TRANSIENT_RETRIES) {
        throw new Error('Lost the connection to OnBuzz while waiting for the reply.');
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    if (res.status === 401) {
      const e = new Error('Server rejected the extension token while polling.');
      e.status = 401;
      throw e;
    }
    if (res.status === 404) {
      // The Quick Send agent vanished (manually deleted in the UI, or
      // never created). No point retrying.
      throw new Error('The Quick Send agent is missing on the server. Try sending again to recreate it.');
    }
    if (!res.ok) {
      if (transientRetries++ >= MAX_TRANSIENT_RETRIES) {
        throw new Error(`OnBuzz poll endpoint kept returning HTTP ${res.status}. Check the server logs.`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    transientRetries = 0;

    const body = await res.json().catch(() => null);
    const messages = (body && body.messages) || [];

    // First, check whether the server is telling us the agent is in a
    // bad state. If yes, stop polling and bubble the structured hint
    // up — handleSend's catch composes a user-facing banner from
    // err.serverMessage + err.suggestion when present.
    if (body && body.unhealthy) {
      const status = body.agentStatus ? ` (agent status: ${body.agentStatus})` : '';
      const hint = body.errorHint ? ` — ${body.errorHint}` : '';
      const err = new Error(`Quick Send agent is unhealthy${status}${hint}`);
      err.unhealthy = true;
      err.code = body.code || null;
      err.serverMessage = body.errorHint || null;
      err.suggestion = body.suggestion || null;
      err.localModelsAvailable = body.localModelsAvailable || false;
      err.structured = Boolean(body.errorHint || body.code);
      throw err;
    }

    for (const m of messages) {
      if (m.role === 'assistant' && (m.content || '').trim().length > 0) {
        return m;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for the agent reply.');
}

// ── Send flow ───────────────────────────────────────────────
async function handleSend() {
  if (!currentSelection || !currentSelection.selected_text) {
    showError('Highlight some text on a page first, then right-click → Send to OnBuzz agent.');
    return;
  }
  const userMessage = els.userMessage.value.trim();
  const { serverUrl, token } = await readSettings();
  if (!token) {
    showError('Extension token is not set. Open Settings and paste the token from OnBuzz.');
    return;
  }
  clearError();

  // UI lock
  els.sendBtn.disabled = true;
  els.userMessage.disabled = true;
  els.sendHint.textContent = 'Sending…';

  // Echo the user message locally so the conversation feels live.
  const preview = userMessage
    ? userMessage
    : `(sent selection from ${currentSelection.page_title || currentSelection.source_url || 'this page'})`;
  appendMessage({ role: 'user', content: preview });
  const loadingNode = appendMessage({ role: 'assistant', loading: true });

  const myInvocation = ++sendInvocationCounter;
  latestSendInvocation = myInvocation;
  const isStale = () => myInvocation !== latestSendInvocation;

  if (activePollAbort) {
    try { activePollAbort.abort(); } catch { /* ignore */ }
  }
  activePollAbort = new AbortController();

  try {
    // Reply-language hint: when the user has picked a non-Auto reply
    // language from the globe popover, we prepend a short bracketed
    // directive to the user message client-side. The backend treats
    // it as plain content; the LLM sees it as an instruction and
    // obeys. Keeps the wire format unchanged.
    const languageHint = languageHintForCurrentChoice();
    const composedUserMessage = languageHint
      ? (userMessage ? `${languageHint}\n\n${userMessage}` : languageHint)
      : userMessage;

    const sendResult = await postQuickSend({
      serverUrl,
      token,
      selection: currentSelection,
      userMessage: composedUserMessage
    });
    if (isStale()) return;
    if (!sendResult || sendResult.ok !== true || !sendResult.agentId) {
      throw new Error((sendResult && sendResult.error) || 'Unexpected server response.');
    }
    activeAgentId = sendResult.agentId;

    const reply = await pollForReply({
      serverUrl,
      token,
      agentId: sendResult.agentId,
      since: sendResult.firstMessageIndex || 0,
      signal: activePollAbort.signal
    });
    if (isStale()) return;
    removeNode(loadingNode);
    appendMessage({ role: 'assistant', content: reply.content });
    els.sendHint.textContent = 'Reply received.';
    // Success: drop our reference so a later invocation doesn't try
    // to abort an already-settled controller.
    activePollAbort = null;
  } catch (err) {
    // Stale catch — a newer handleSend has taken over (or rendered).
    // Do NOT touch the banner / loading bubble; those belong to the
    // current invocation now. This is the guard that prevents a
    // 60-second-late timeout from overwriting a freshly-rendered
    // assistant reply.
    if (isStale()) return;
    removeNode(loadingNode);
    if (err.name === 'AbortError') {
      els.sendHint.textContent = '';
      return;
    }
    if (err.status === 401) {
      showError('OnBuzz rejected the extension token. Open Settings and paste a fresh token.');
    } else if (err.structured && (err.serverMessage || err.suggestion)) {
      // Structured server response (POST 503 with provider hint, or
      // poll unhealthy with errorHint+suggestion). Prefer the server's
      // own copy verbatim — it already says what the user needs to do.
      showError('', {
        title: titleForErrorCode(err.code) || err.serverMessage || 'OnBuzz returned an error',
        body: [err.serverMessage, err.suggestion].filter(Boolean).join(' ').trim()
            || 'Open OnBuzz Settings to fix the issue.'
      });
    } else if (err.unhealthy) {
      // Fallback for older backends that flagged unhealthy without the
      // structured body.
      showError(`${err.message}. Open OnBuzz Settings → Providers and confirm a key is configured for the Quick Send agent's model.`);
    } else if (err.message && /HTTP 5\d\d/.test(err.message)) {
      showError(`OnBuzz returned a server error. ${err.message}`);
    } else if (err.message && /Failed to fetch|NetworkError/i.test(err.message)) {
      showError('Could not reach OnBuzz. Make sure the server is running.');
    } else {
      showError(err.message || 'Something went wrong.');
    }
    els.sendHint.textContent = '';
  } finally {
    // Stale finally — leave shared UI state alone. The newer
    // handleSend owns the send button / textarea state.
    if (!isStale()) {
      els.sendBtn.disabled = false;
      els.userMessage.disabled = false;
      els.userMessage.value = '';
      els.userMessage.focus();
    }
  }
}

// ── Wire-up ────────────────────────────────────────────────
els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  handleSend();
});

els.userMessage.addEventListener('keydown', (e) => {
  // Standard chat UX: Enter sends, Shift+Enter inserts a newline.
  // `isComposing` guards IME composition (e.g. CJK input methods)
  // so confirming a composed character via Enter doesn't fire a send.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    handleSend();
  }
});

// Reset shared state used by handleSend. Bumping the invocation
// counter marks any in-flight poll as stale (its catch/finally will
// no-op). Aborting the controller also kicks the in-flight fetch /
// next-iteration check so the stale poll exits faster.
function invalidateInFlightSend() {
  latestSendInvocation = ++sendInvocationCounter;
  if (activePollAbort) {
    try { activePollAbort.abort(); } catch { /* ignore */ }
    activePollAbort = null;
  }
}

els.clearSelection.addEventListener('click', async () => {
  invalidateInFlightSend();
  await clearStagedSelection();
  renderSelection(null);
  clearConversation();
  clearError();
  els.sendHint.textContent = '';
});

els.settingsBtn.addEventListener('click', () => {
  // chrome.runtime.openOptionsPage opens whichever page the manifest
  // declared (we use options.html).
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

// Quick-action chips: each chip has a data-prompt attribute that we
// drop into the textarea, then fire the send flow. The chips only
// surface when there's a staged selection (renderSelection unhides
// the card), so handleSend's currentSelection guard is already in
// the right state.
if (els.actionChipsRow) {
  els.actionChipsRow.addEventListener('click', (e) => {
    const chip = e.target.closest('button.action-chip');
    if (!chip) return;
    const prompt = chip.getAttribute('data-prompt');
    if (!prompt) return;
    els.userMessage.value = prompt;
    handleSend();
  });
}

// ── Reply-language picker ───────────────────────────────────
// Persisted in chrome.storage.local under `replyLanguage`. Empty
// string = Auto. The globe button shows a small code badge when a
// non-Auto language is selected, and handleSend prepends a short
// "[Reply in <Lang>]" directive to the user message at send time.
const LANG_NAMES = {
  '':   { code: 'AUTO', name: 'auto-detected language' },
  en:   { code: 'EN',   name: 'English' },
  he:   { code: 'HE',   name: 'Hebrew' },
  es:   { code: 'ES',   name: 'Spanish' },
  fr:   { code: 'FR',   name: 'French' },
  ar:   { code: 'AR',   name: 'Arabic' }
};
let replyLanguage = '';

function languageHintForCurrentChoice() {
  if (!replyLanguage) return '';
  const meta = LANG_NAMES[replyLanguage];
  if (!meta) return '';
  return `[Reply in ${meta.name}.]`;
}

function applyLangBadge() {
  const meta = LANG_NAMES[replyLanguage];
  if (!replyLanguage || !meta || meta.code === 'AUTO') {
    els.langBadge.classList.add('hidden');
    els.langBadge.textContent = '';
    els.langBtn.title = 'Reply language — Auto';
  } else {
    els.langBadge.classList.remove('hidden');
    els.langBadge.textContent = meta.code;
    els.langBtn.title = `Reply language — ${meta.name}`;
  }
  // Mark the active option in the popover.
  for (const btn of els.langPopover.querySelectorAll('.lang-option')) {
    if (btn.getAttribute('data-lang') === replyLanguage) {
      btn.classList.add('is-active');
    } else {
      btn.classList.remove('is-active');
    }
  }
}

function openLangPopover() {
  els.langPopover.classList.remove('hidden');
  els.langBtn.setAttribute('aria-expanded', 'true');
}
function closeLangPopover() {
  els.langPopover.classList.add('hidden');
  els.langBtn.setAttribute('aria-expanded', 'false');
}

els.langBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (els.langPopover.classList.contains('hidden')) {
    openLangPopover();
  } else {
    closeLangPopover();
  }
});

els.langPopover.addEventListener('click', (e) => {
  const opt = e.target.closest('button.lang-option');
  if (!opt) return;
  replyLanguage = opt.getAttribute('data-lang') || '';
  chrome.storage.local.set({ replyLanguage }, () => { /* fire-and-forget */ });
  applyLangBadge();
  closeLangPopover();
});

// Close popover on outside click / Escape.
document.addEventListener('click', (e) => {
  if (els.langPopover.classList.contains('hidden')) return;
  if (e.target.closest('#langBtn') || e.target.closest('#langPopover')) return;
  closeLangPopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.langPopover.classList.contains('hidden')) {
    closeLangPopover();
    els.langBtn.focus();
  }
});

// Load persisted language preference on init.
chrome.storage.local.get(['replyLanguage'], (items) => {
  if (typeof items.replyLanguage === 'string') {
    replyLanguage = items.replyLanguage;
  }
  applyLangBadge();
});

// ── Voice input (Web Speech API) ────────────────────────────
// Click toggles recording. Interim results stream into the textarea
// so the user sees what's being captured; final results stay. If the
// API is unavailable or permission is denied, we surface a small
// notice via the existing error banner and disable the button.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionActive = false;
let speechBaseValue = '';

function localeForRecognition() {
  // Bias the recognizer toward the picked reply language when set.
  // Falls back to the browser/UI language for Auto.
  switch (replyLanguage) {
    case 'he': return 'he-IL';
    case 'es': return 'es-ES';
    case 'fr': return 'fr-FR';
    case 'ar': return 'ar-SA';
    case 'en': return 'en-US';
    default:   return navigator.language || 'en-US';
  }
}

function stopRecording() {
  if (recognition && recognitionActive) {
    try { recognition.stop(); } catch { /* ignore */ }
  }
}

function startRecording() {
  if (!SR) {
    showError('Voice input', {
      title: 'Voice input not supported',
      body: 'This browser does not expose the Web Speech API.'
    });
    return;
  }
  recognition = new SR();
  recognition.lang = localeForRecognition();
  recognition.interimResults = true;
  recognition.continuous = false;
  speechBaseValue = els.userMessage.value;

  recognition.onstart = () => {
    recognitionActive = true;
    els.micBtn.classList.add('is-recording');
    els.micBtn.setAttribute('aria-pressed', 'true');
    els.sendHint.textContent = 'Listening…';
  };
  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    const joiner = speechBaseValue && !speechBaseValue.endsWith(' ') ? ' ' : '';
    els.userMessage.value = `${speechBaseValue}${joiner}${final}${interim}`;
    if (final) speechBaseValue = els.userMessage.value;
  };
  recognition.onerror = (event) => {
    recognitionActive = false;
    els.micBtn.classList.remove('is-recording');
    els.micBtn.setAttribute('aria-pressed', 'false');
    els.sendHint.textContent = '';
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showError('Voice input', {
        title: 'Microphone permission denied',
        body: 'Allow microphone access for this extension in Chrome to use voice input.'
      });
    } else if (event.error === 'no-speech') {
      // Quiet failure mode — just stop, no banner.
    } else {
      showError('Voice input', {
        title: 'Voice input failed',
        body: `Recognizer error: ${event.error}`
      });
    }
  };
  recognition.onend = () => {
    recognitionActive = false;
    els.micBtn.classList.remove('is-recording');
    els.micBtn.setAttribute('aria-pressed', 'false');
    if (els.sendHint.textContent === 'Listening…') {
      els.sendHint.textContent = '';
    }
    els.userMessage.focus();
  };

  try {
    recognition.start();
  } catch (err) {
    showError('Voice input', {
      title: 'Could not start microphone',
      body: err.message || 'Unknown error'
    });
  }
}

els.micBtn.addEventListener('click', () => {
  if (recognitionActive) {
    stopRecording();
  } else {
    startRecording();
  }
});

if (!SR) {
  els.micBtn.disabled = true;
  els.micBtn.title = 'Voice input not supported in this browser';
}

// React to a fresh selection arriving from the service worker while
// the side panel is already open.
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg && msg.type === 'onbuzz/selection-staged') {
    const staged = await readStagedSelection();
    if (staged) {
      // New selection → fresh conversation, fresh state. Treat any
      // poll from a previous selection as stale so its eventual
      // timeout (or late reply) doesn't bleed into this UI.
      invalidateInFlightSend();
      clearConversation();
      clearError();
      els.sendHint.textContent = '';
      renderSelection(staged);
    }
  }
});

// Initial render on panel open.
(async function init() {
  const staged = await readStagedSelection();
  renderSelection(staged);
})();
