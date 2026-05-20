// Options page: read/write the two persisted settings.

const DEFAULT_SERVER_URL = 'http://localhost:8080';

const serverUrlInput = document.getElementById('serverUrl');
const tokenInput = document.getElementById('token');
const saveButton = document.getElementById('save');
const statusEl = document.getElementById('status');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.classList.remove('success', 'error');
  if (kind) statusEl.classList.add(kind);
}

function normaliseServerUrl(raw) {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SERVER_URL;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_err) {
    throw new Error('Server URL is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Server URL must use http or https');
  }
  return parsed.origin;
}

function load() {
  chrome.storage.local.get(['serverUrl', 'token'], (items) => {
    serverUrlInput.value = items.serverUrl || DEFAULT_SERVER_URL;
    tokenInput.value = items.token || '';
  });
}

function save() {
  let serverUrl;
  try {
    serverUrl = normaliseServerUrl(serverUrlInput.value);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  const token = (tokenInput.value || '').trim();

  saveButton.disabled = true;
  chrome.storage.local.set({ serverUrl, token }, () => {
    saveButton.disabled = false;
    if (chrome.runtime.lastError) {
      setStatus(`Could not save: ${chrome.runtime.lastError.message}`, 'error');
      return;
    }
    serverUrlInput.value = serverUrl; // reflect the normalised value
    setStatus(token ? 'Saved.' : 'Saved. Token is empty — the side panel will warn you on use.', 'success');
  });
}

document.addEventListener('DOMContentLoaded', load);
saveButton.addEventListener('click', save);
