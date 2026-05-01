/**
 * Keyboard Shortcuts Registry
 *
 * A centralized system for registering and managing keyboard shortcuts.
 * Shortcuts registered here will automatically appear in the Help modal.
 */

// OS detection
const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

// Store all registered shortcuts
const shortcuts = new Map();

/**
 * Format a key combination for display based on OS
 * @param {Object} keys - Key combination object
 * @param {boolean} keys.ctrl - Requires Ctrl (or Cmd on Mac)
 * @param {boolean} keys.shift - Requires Shift
 * @param {boolean} keys.alt - Requires Alt (or Option on Mac)
 * @param {string} keys.key - The main key
 * @returns {string} Formatted key combination
 */
export function formatShortcut({ ctrl, shift, alt, key }) {
  const parts = [];

  if (ctrl) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }

  // Format special keys
  let displayKey = key;
  if (key === 'Enter') displayKey = isMac ? '↵' : 'Enter';
  if (key === 'Escape') displayKey = isMac ? 'esc' : 'Esc';
  if (key === 'ArrowUp') displayKey = '↑';
  if (key === 'ArrowDown') displayKey = '↓';
  if (key === 'ArrowLeft') displayKey = '←';
  if (key === 'ArrowRight') displayKey = '→';

  parts.push(displayKey);

  return parts.join(isMac ? '' : '+');
}

/**
 * Register a keyboard shortcut
 * @param {string} id - Unique identifier for the shortcut
 * @param {Object} config - Shortcut configuration
 * @param {string} config.description - Human-readable description
 * @param {string} config.category - Category for grouping (e.g., 'Chat', 'Navigation', 'General')
 * @param {Object} config.keys - Key combination
 * @param {boolean} config.keys.ctrl - Requires Ctrl (or Cmd on Mac)
 * @param {boolean} config.keys.shift - Requires Shift
 * @param {boolean} config.keys.alt - Requires Alt (or Option on Mac)
 * @param {string} config.keys.key - The main key
 */
export function registerShortcut(id, config) {
  shortcuts.set(id, {
    id,
    ...config,
    displayKeys: formatShortcut(config.keys)
  });
}

/**
 * Unregister a keyboard shortcut
 * @param {string} id - Shortcut identifier
 */
export function unregisterShortcut(id) {
  shortcuts.delete(id);
}

/**
 * Get all registered shortcuts
 * @returns {Array} Array of shortcut objects
 */
export function getAllShortcuts() {
  return Array.from(shortcuts.values());
}

/**
 * Get shortcuts grouped by category
 * @returns {Object} Object with categories as keys and arrays of shortcuts as values
 */
export function getShortcutsByCategory() {
  const categories = {};

  for (const shortcut of shortcuts.values()) {
    const category = shortcut.category || 'General';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(shortcut);
  }

  return categories;
}

/**
 * Check if a keyboard event matches a shortcut
 * @param {KeyboardEvent} event - The keyboard event
 * @param {Object} keys - Key combination to check
 * @returns {boolean} Whether the event matches
 */
export function matchesShortcut(event, keys) {
  const ctrlOrMeta = isMac ? event.metaKey : event.ctrlKey;

  return (
    (keys.ctrl ? ctrlOrMeta : !ctrlOrMeta || keys.allowCtrl) &&
    (keys.shift ? event.shiftKey : !event.shiftKey || keys.allowShift) &&
    (keys.alt ? event.altKey : !event.altKey || keys.allowAlt) &&
    event.key.toLowerCase() === keys.key.toLowerCase()
  );
}

// Register default application shortcuts
// Only register shortcuts that are actually implemented in the codebase

registerShortcut('send-message', {
  description: 'Send message',
  category: 'Chat',
  keys: { ctrl: false, shift: false, alt: false, key: 'Enter' }
});

registerShortcut('new-line', {
  description: 'New line in message',
  category: 'Chat',
  keys: { ctrl: false, shift: true, alt: false, key: 'Enter' }
});

registerShortcut('voice-input', {
  description: 'Toggle voice input',
  category: 'Chat',
  keys: { ctrl: true, shift: true, alt: false, key: 'M' }
});

registerShortcut('toggle-sidebar', {
  description: 'Toggle sidebar',
  category: 'Navigation',
  keys: { ctrl: true, shift: false, alt: false, key: 'B' }
});

registerShortcut('help', {
  description: 'Show help',
  category: 'General',
  keys: { ctrl: true, shift: false, alt: false, key: '/' }
});

// Squadron Headquarters shortcuts
registerShortcut('create-pilot', {
  description: 'Create new pilot',
  category: 'Squadron',
  keys: { ctrl: false, shift: false, alt: true, key: 'P' }
});

registerShortcut('create-team', {
  description: 'Create new team',
  category: 'Squadron',
  keys: { ctrl: false, shift: false, alt: true, key: 'T' }
});

registerShortcut('edit-current-agent', {
  description: 'Edit current pilot (the one selected in the chat header)',
  category: 'Squadron',
  keys: { ctrl: false, shift: false, alt: true, key: 'E' }
});

registerShortcut('load-agent', {
  description: 'Load an existing pilot (open import dialog)',
  category: 'Squadron',
  keys: { ctrl: false, shift: false, alt: true, key: 'L' }
});

// Export OS detection for components
export { isMac };
