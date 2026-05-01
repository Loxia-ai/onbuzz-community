/**
 * Microsoft Clarity Analytics Integration
 *
 * This module handles Clarity initialization based on user consent level.
 * Clarity Project ID: ubjxmttwlh
 */

import { CONSENT_LEVELS } from '../hooks/useConsent.js';

const CLARITY_PROJECT_ID = 'ubjxmttwlh';

// Track if Clarity has been initialized
let clarityInitialized = false;
let currentMaskingState = true; // Default to masked

/**
 * Initialize Microsoft Clarity
 * @param {string} consentLevel - The user's consent level
 */
export function initializeClarity(consentLevel) {
  // Don't initialize if consent is 'none'
  if (consentLevel === CONSENT_LEVELS.NONE) {
    console.log('[Clarity] Analytics disabled - user declined consent');
    return;
  }

  // Don't reinitialize if already loaded
  if (clarityInitialized && window.clarity) {
    // Just update masking state
    updateClarityMasking(consentLevel);
    return;
  }

  // Load Clarity script
  (function(c, l, a, r, i, t, y) {
    c[a] = c[a] || function() { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r);
    t.async = 1;
    t.src = "https://www.clarity.ms/tag/" + i;
    y = l.getElementsByTagName(r)[0];
    y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_PROJECT_ID);

  clarityInitialized = true;

  // Set masking based on consent level
  updateClarityMasking(consentLevel);

  console.log(`[Clarity] Initialized with consent level: ${consentLevel}`);
}

/**
 * Update Clarity masking based on consent level
 * @param {string} consentLevel - The user's consent level
 */
export function updateClarityMasking(consentLevel) {
  if (!window.clarity) {
    console.log('[Clarity] Not initialized, cannot update masking');
    return;
  }

  const shouldMask = consentLevel !== CONSENT_LEVELS.FULL;

  if (currentMaskingState === shouldMask) {
    return; // No change needed
  }

  currentMaskingState = shouldMask;

  if (shouldMask) {
    // Enable masking for basic consent
    window.clarity("set", "mask-text", true);
    window.clarity("set", "mask-images", false);
    applyMaskingToElements(true);
    console.log('[Clarity] Text masking enabled (basic consent)');
  } else {
    // Disable masking for full consent (except sensitive fields)
    window.clarity("set", "mask-text", false);
    window.clarity("set", "mask-images", false);
    applyMaskingToElements(false);
    console.log('[Clarity] Text masking disabled (full consent)');
  }
}

/**
 * Apply or remove masking attributes on sensitive elements
 * @param {boolean} mask - Whether to mask elements
 */
function applyMaskingToElements(mask) {
  // Selectors for elements that should always be masked (sensitive data)
  const alwaysMaskedSelectors = [
    'input[type="password"]',
    '[data-clarity-mask="always"]',
    '.api-key-input',
    '[name*="apiKey"]',
    '[name*="api_key"]',
    '[name*="secret"]',
    '[name*="token"]'
  ];

  // Selectors for elements that should be masked in basic mode
  const basicMaskedSelectors = [
    'textarea',
    'input[type="text"]',
    'input:not([type="password"]):not([type="checkbox"]):not([type="radio"])',
    '[contenteditable="true"]',
    '.message-content',
    '.chat-input'
  ];

  // Always mask sensitive fields
  alwaysMaskedSelectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.setAttribute('data-clarity-mask', 'true');
    });
  });

  // Apply or remove masking on other input elements based on consent
  if (mask) {
    basicMaskedSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        // Don't override always-masked elements
        if (el.getAttribute('data-clarity-mask') !== 'always') {
          el.setAttribute('data-clarity-mask', 'true');
        }
      });
    });
  } else {
    basicMaskedSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        // Don't unmask always-masked elements
        if (el.getAttribute('data-clarity-mask') !== 'always') {
          el.removeAttribute('data-clarity-mask');
        }
      });
    });
  }
}

/**
 * Stop Clarity tracking (when consent is revoked)
 */
export function stopClarity() {
  if (window.clarity) {
    window.clarity("stop");
    console.log('[Clarity] Tracking stopped');
  }
}

/**
 * Set custom tags for better filtering in Clarity dashboard
 * @param {string} key - Tag key
 * @param {string} value - Tag value
 */
export function setClarityTag(key, value) {
  if (window.clarity) {
    window.clarity("set", key, value);
  }
}

/**
 * Identify user (for session correlation)
 * Note: Only call this with non-sensitive identifiers
 * @param {string} userId - User identifier
 */
export function identifyUser(userId) {
  if (window.clarity) {
    window.clarity("identify", userId);
  }
}

/**
 * Track custom events
 * @param {string} eventName - Name of the event
 */
export function trackEvent(eventName) {
  if (window.clarity) {
    window.clarity("event", eventName);
  }
}

/**
 * Upgrade consent level (e.g., from basic to full)
 * @param {string} newLevel - The new consent level
 */
export function upgradeConsent(newLevel) {
  if (newLevel === CONSENT_LEVELS.NONE) {
    stopClarity();
  } else {
    if (!clarityInitialized) {
      initializeClarity(newLevel);
    } else {
      updateClarityMasking(newLevel);
    }
  }
}

export default {
  initializeClarity,
  updateClarityMasking,
  stopClarity,
  setClarityTag,
  identifyUser,
  trackEvent,
  upgradeConsent
};
