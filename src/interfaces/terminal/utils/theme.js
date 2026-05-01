/**
 * Theme Configuration for Terminal UI
 * Provides color schemes for different visual preferences
 */

/**
 * Theme Definitions
 * Each theme provides colors for:
 * - border: Border colors for boxes
 * - primary: Primary text color
 * - secondary: Secondary/agent text color
 * - success: Success state color (connected, user messages)
 * - error: Error state color (disconnected, errors)
 * - warning: Warning state color (loading, alerts)
 * - info: Info text color (system messages)
 * - dim: Dimmed text color (timestamps, hints)
 */
const THEMES = {
  default: {
    border: 'blue',
    borderLoading: 'yellow',
    primary: 'white',
    secondary: 'cyan',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'blue',
    dim: 'gray',
  },
  light: {
    border: 'blue',
    borderLoading: 'yellow',
    primary: 'black',
    secondary: 'blue',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'cyan',
    dim: 'gray',
  },
  dark: {
    border: 'cyan',
    borderLoading: 'magenta',
    primary: 'white',
    secondary: 'cyan',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'blueBright',
    dim: 'gray',
  },
  'high-contrast': {
    border: 'white',
    borderLoading: 'yellow',
    primary: 'white',
    secondary: 'cyan',
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'cyanBright',
    dim: 'white',
  },
};

/**
 * Get theme colors for a given color scheme
 * @param {string} colorScheme - The color scheme name (default, light, dark, high-contrast)
 * @returns {Object} Theme color configuration
 */
export function getTheme(colorScheme = 'default') {
  return THEMES[colorScheme] || THEMES.default;
}

/**
 * Get a specific color from the theme
 * @param {string} colorScheme - The color scheme name
 * @param {string} colorKey - The color key (border, primary, success, etc.)
 * @returns {string} Color name for Ink
 */
export function getThemeColor(colorScheme, colorKey) {
  const theme = getTheme(colorScheme);
  return theme[colorKey] || theme.primary;
}

export default { getTheme, getThemeColor };
