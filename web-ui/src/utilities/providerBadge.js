/**
 * providerBadge — display helpers for the provider chip shown next to model
 * names in the agent modals. One source of truth so future pickers (settings
 * page, sidebar, etc.) don't end up with three slightly-different mappings.
 *
 * Keep this file dependency-free — it's pure data + Tailwind class strings.
 */

const LABELS = {
  openai:    'OpenAI',
  anthropic: 'Anthropic',
  gemini:    'Gemini',
  xai:       'xAI',
  ollama:    'Ollama',
};

const UNKNOWN_PROVIDER_LABEL = 'Unknown';

/**
 * Human-readable provider label for the chip. Unknown ids (e.g. a user's
 * custom OpenAI-compatible endpoint name) are returned with the first
 * letter uppercased — better than rendering an empty chip.
 *
 * @param {string|undefined|null} id
 * @returns {string}
 */
export function providerLabel(id) {
  if (!id || typeof id !== 'string') return UNKNOWN_PROVIDER_LABEL;
  if (LABELS[id]) return LABELS[id];
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Subtle accent border per provider; neutral background works in both
// themes. Tailwind classes are inlined so the JIT picker keeps them.
const BADGE_BASE =
  'inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] ' +
  'font-medium leading-none whitespace-nowrap ' +
  'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 ' +
  'border';

const ACCENT = {
  openai:    'border-emerald-300 dark:border-emerald-700/60',
  anthropic: 'border-orange-300 dark:border-orange-700/60',
  gemini:    'border-blue-300 dark:border-blue-700/60',
  xai:       'border-slate-400 dark:border-slate-500/60',
  ollama:    'border-purple-300 dark:border-purple-700/60',
};

const NEUTRAL_BORDER = 'border-gray-300 dark:border-gray-600';

/**
 * Tailwind class string for the chip. Includes base pill styling plus a
 * provider-specific border accent.
 *
 * @param {string|undefined|null} id
 * @returns {string}
 */
export function providerBadgeClass(id) {
  const accent = ACCENT[id] || NEUTRAL_BORDER;
  return `${BADGE_BASE} ${accent}`;
}

/**
 * Tailwind class string for a generic feature badge (e.g. "Vision"). Same
 * pill base as the provider chip with a deliberately neutral border, so
 * feature flags read as quieter siblings of the provider chip rather than
 * competing for attention.
 */
export const FEATURE_BADGE_CLASS = `${BADGE_BASE} ${NEUTRAL_BORDER}`;

/**
 * Strip backend naming noise ("Loxia ", "Direct ", " (Platform)", " (Direct)")
 * from a model display name. The provider chip carries that information
 * visually, so the row label should read clean.
 *
 * @param {string|undefined|null} name
 * @returns {string}
 */
export function cleanDisplayName(name) {
  return (name || '')
    .replace('Loxia ', '')
    .replace('Direct ', '')
    .replace(' (Platform)', '')
    .replace(' (Direct)', '');
}
