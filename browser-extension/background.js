// Send to OnBuzz — Manifest V3 service worker.
//
// Responsibilities:
//   1. Register a context-menu entry that only appears when the user
//      has selected text on a page.
//   2. On click, capture { selected_text, source_url, page_title } and
//      stash it in chrome.storage.session.
//   3. Open the Side Panel for the active window/tab and let the side
//      panel pick up the staged selection.
//
// MV3 service workers are killed between events. No persistent state
// lives in this file; everything is either in chrome.storage.* or
// re-derived from the event payload.
//
// NOTE: the actual POST to OnBuzz happens in sidepanel.js, NOT here.
// We deliberately do not auto-send so the user always sees what is
// about to leave their machine before they hit Send.

const MENU_ID = 'onbuzz-send-selection';
const PENDING_KEY = 'pendingSelection';
const NOTIFICATION_ID_PREFIX = 'onbuzz-';

// Toolbar icon click opens the side panel too — handy for resuming
// without a fresh selection.
try {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => { /* older Chrome — ignore */ });
} catch (_err) {
  // Older Chrome without setPanelBehavior — ignore.
}

function ensureContextMenu() {
  // chrome.contextMenus.create throws on duplicate id; removeAll +
  // create is the idempotent recipe for service workers that may
  // re-run on every wake.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Send to OnBuzz agent',
      contexts: ['selection']
    });
  });
}

chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup.addListener(ensureContextMenu);

function notify(message) {
  const id = `${NOTIFICATION_ID_PREFIX}${Date.now()}`;
  try {
    chrome.notifications.create(id, {
      type: 'basic',
      title: 'OnBuzz',
      message,
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      priority: 1
    }, () => {
      // Drop lastError if iconUrl wasn't found — the notification still
      // renders on macOS, with a generic icon on Windows/Linux.
      void chrome.runtime.lastError;
    });
  } catch (_err) {
    console.error('[OnBuzz] notify failed:', message);
  }
}

async function stashSelection(payload) {
  await chrome.storage.session.set({ [PENDING_KEY]: payload });
  // Also tell any open side panel to refresh, since storage.session
  // changes do fire onChanged but we want to be explicit when the user
  // hits the context menu after the panel is already open.
  try {
    await chrome.runtime.sendMessage({ type: 'onbuzz/selection-staged' });
  } catch (_err) {
    // No listener (side panel closed) — fine; it'll read on open.
  }
}

// IMPORTANT: this listener is NOT async. chrome.sidePanel.open() is
// user-gesture-gated, and the gesture token from a context-menu click
// is consumed by the FIRST `await` boundary inside the handler. If we
// `await stashSelection(...)` before calling open(), Chrome rejects
// the open() silently and the user has to open the panel manually
// from the toolbar puzzle icon. To preserve the gesture we:
//   1. validate synchronously,
//   2. call open() FIRST, in the same sync stack frame as the event,
//   3. stash + notify the panel afterwards (fire-and-forget).
// The side panel script re-reads chrome.storage.session on open AND
// on the runtime message we send below, so the race is benign.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const selection = (info.selectionText || '').trim();
  if (!selection) {
    notify('No text selected. Highlight some text and try again.');
    return;
  }

  const payload = {
    selected_text: selection,
    source_url: (tab && tab.url) || '',
    page_title: (tab && tab.title) || '',
    captured_at: Date.now()
  };

  // 1. Open the side panel synchronously — must happen before any
  //    `await` so the user-gesture token is still valid.
  let openPromise = null;
  try {
    if (tab && typeof tab.windowId === 'number') {
      openPromise = chrome.sidePanel.open({ windowId: tab.windowId });
    } else if (tab && typeof tab.id === 'number') {
      openPromise = chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (err) {
    notify(`Could not open Side Panel: ${err.message || 'unknown error'}`);
  }
  if (openPromise && typeof openPromise.catch === 'function') {
    openPromise.catch((err) => {
      notify(`Could not open Side Panel: ${err.message || 'unknown error'}`);
    });
  }

  // 2. Stash the selection after open() is already in flight. The
  //    side panel reads chrome.storage.session on load AND listens
  //    for the runtime message stashSelection sends, so this can
  //    safely race the panel's init.
  stashSelection(payload).catch((err) => {
    notify(`Could not stage selection: ${err.message || 'unknown error'}`);
  });
});
