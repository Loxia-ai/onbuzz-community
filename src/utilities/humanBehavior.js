/**
 * Human Behavior Simulation Utility
 *
 * Provides human-like mouse movements, typing patterns, and action delays
 * to make browser automation less detectable by anti-bot systems.
 */

import { createCursor } from 'ghost-cursor';
import {
  TYPING_CONFIG,
  MOUSE_CONFIG,
  ACTION_DELAYS
} from './stealthConstants.js';

/**
 * Generate a random number within a range
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random number between min and max
 */
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a human-like cursor controller for a page
 * @param {Page} page - Puppeteer page instance
 * @param {Object} options - Cursor options
 * @returns {Object} Ghost cursor instance with enhanced methods
 */
export function createHumanCursor(page, options = {}) {
  const cursor = createCursor(page, {
    // Start position (center of viewport)
    start: {
      x: Math.floor(page.viewport()?.width || 1920) / 2,
      y: Math.floor(page.viewport()?.height || 1080) / 2
    }
  });

  // Wrap cursor with human-like enhancements
  return {
    /**
     * Move cursor to element with human-like motion
     * @param {string} selector - CSS selector
     * @param {Object} moveOptions - Movement options
     */
    async moveTo(selector, moveOptions = {}) {
      const {
        hesitate = true,
        hesitateMs = randomInRange(
          MOUSE_CONFIG.HESITATE_BEFORE_CLICK.MIN_MS,
          MOUSE_CONFIG.HESITATE_BEFORE_CLICK.MAX_MS
        )
      } = moveOptions;

      await cursor.move(selector);

      if (hesitate) {
        await sleep(hesitateMs);
      }
    },

    /**
     * Click element with human-like behavior
     * @param {string} selector - CSS selector
     * @param {Object} clickOptions - Click options
     */
    async click(selector, clickOptions = {}) {
      const {
        hesitate = true,
        moveFirst = true
      } = clickOptions;

      if (moveFirst) {
        await this.moveTo(selector, { hesitate });
      }

      // Random click duration
      const clickDelay = randomInRange(
        MOUSE_CONFIG.CLICK_DURATION.MIN_MS,
        MOUSE_CONFIG.CLICK_DURATION.MAX_MS
      );

      await cursor.click(selector, {
        hesitate: hesitate ? randomInRange(
          MOUSE_CONFIG.HESITATE_BEFORE_CLICK.MIN_MS,
          MOUSE_CONFIG.HESITATE_BEFORE_CLICK.MAX_MS
        ) : 0,
        waitForClick: clickDelay
      });
    },

    /**
     * Double click element with human-like behavior
     * @param {string} selector - CSS selector
     */
    async doubleClick(selector) {
      await this.moveTo(selector);
      await cursor.click(selector, { waitForClick: 50 });
      await sleep(randomInRange(50, 150));
      await cursor.click(selector, { waitForClick: 50 });
    },

    /**
     * Hover over element
     * @param {string} selector - CSS selector
     */
    async hover(selector) {
      await this.moveTo(selector, { hesitate: true });
    },

    /**
     * Random mouse movement within viewport (simulates idle behavior)
     * @param {number} duration - Duration in ms for random movements
     */
    async randomMovement(duration = 2000) {
      const startTime = Date.now();
      const viewport = page.viewport() || { width: 1920, height: 1080 };

      while (Date.now() - startTime < duration) {
        const x = randomInRange(100, viewport.width - 100);
        const y = randomInRange(100, viewport.height - 100);

        await cursor.moveTo({ x, y });
        await sleep(randomInRange(200, 500));
      }
    },

    // Expose original cursor for advanced use
    _cursor: cursor
  };
}

/**
 * Type text with human-like patterns
 * @param {Page} page - Puppeteer page instance
 * @param {string} selector - CSS selector for input field
 * @param {string} text - Text to type
 * @param {Object} options - Typing options
 */
export async function humanType(page, selector, text, options = {}) {
  const {
    clearFirst = true,
    clickFirst = true,
    baseDelay = TYPING_CONFIG.BASE_DELAY_MS,
    randomDelay = TYPING_CONFIG.RANDOM_DELAY_MAX_MS,
    pauseProbability = TYPING_CONFIG.PAUSE_PROBABILITY,
    simulateTypos = false,
    typoProbability = TYPING_CONFIG.TYPO_PROBABILITY
  } = options;

  // Click to focus the field
  if (clickFirst) {
    await page.click(selector);
    await sleep(randomInRange(100, 200));
  }

  // Clear existing content using keyboard commands (triggers proper input events)
  // IMPORTANT: Setting element.value = '' directly does NOT trigger input events,
  // which breaks React/Vue/Angular forms and can be detected as bot behavior.
  if (clearFirst) {
    // Triple-click to select all text in the field (more human-like than Ctrl+A)
    await page.click(selector, { clickCount: 3 });
    await sleep(randomInRange(50, 100));

    // Delete selected text with Backspace (triggers input events)
    await page.keyboard.press('Backspace');
    await sleep(randomInRange(50, 100));

    // Dispatch input event to ensure framework state updates
    await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, selector);
    await sleep(randomInRange(30, 80));
  }

  // Type each character with human-like timing
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Occasional typo simulation
    if (simulateTypos && Math.random() < typoProbability && char.match(/[a-z]/i)) {
      // Type wrong key
      const wrongChar = getAdjacentKey(char);
      await page.keyboard.type(wrongChar);
      await sleep(randomInRange(100, 200));

      // Pause (realize mistake)
      await sleep(randomInRange(200, 400));

      // Delete wrong character
      await page.keyboard.press('Backspace');
      await sleep(TYPING_CONFIG.TYPO_CORRECTION_DELAY_MS);
    }

    // Type the correct character
    await page.keyboard.type(char);

    // Calculate delay for next character
    let delay = baseDelay + randomInRange(0, randomDelay);

    // Add occasional pauses (thinking)
    if (Math.random() < pauseProbability) {
      delay += randomInRange(
        TYPING_CONFIG.PAUSE_DURATION.MIN_MS,
        TYPING_CONFIG.PAUSE_DURATION.MAX_MS
      );
    }

    // Slightly longer delay after punctuation or spaces
    if (['.', ',', '!', '?', ' ', '@'].includes(char)) {
      delay += randomInRange(30, 80);
    }

    await sleep(delay);
  }

  // Final event dispatch to ensure framework state is fully updated
  // Some frameworks (especially React with controlled inputs) need explicit events
  await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element) {
      // Dispatch events that frameworks listen for
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      // Also dispatch blur and focus to trigger validation
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }
  }, selector);
}

/**
 * Get an adjacent key on QWERTY keyboard for typo simulation
 * @param {string} char - Original character
 * @returns {string} Adjacent character
 */
function getAdjacentKey(char) {
  const keyboard = {
    'q': ['w', 'a'], 'w': ['q', 'e', 's'], 'e': ['w', 'r', 'd'], 'r': ['e', 't', 'f'],
    't': ['r', 'y', 'g'], 'y': ['t', 'u', 'h'], 'u': ['y', 'i', 'j'], 'i': ['u', 'o', 'k'],
    'o': ['i', 'p', 'l'], 'p': ['o', 'l'],
    'a': ['q', 's', 'z'], 's': ['a', 'w', 'd', 'x'], 'd': ['s', 'e', 'f', 'c'],
    'f': ['d', 'r', 'g', 'v'], 'g': ['f', 't', 'h', 'b'], 'h': ['g', 'y', 'j', 'n'],
    'j': ['h', 'u', 'k', 'm'], 'k': ['j', 'i', 'l'], 'l': ['k', 'o', 'p'],
    'z': ['a', 's', 'x'], 'x': ['z', 's', 'd', 'c'], 'c': ['x', 'd', 'f', 'v'],
    'v': ['c', 'f', 'g', 'b'], 'b': ['v', 'g', 'h', 'n'], 'n': ['b', 'h', 'j', 'm'],
    'm': ['n', 'j', 'k']
  };

  const lowerChar = char.toLowerCase();
  const adjacent = keyboard[lowerChar];

  if (!adjacent) return char;

  const wrongChar = adjacent[Math.floor(Math.random() * adjacent.length)];
  return char === char.toUpperCase() ? wrongChar.toUpperCase() : wrongChar;
}

/**
 * Wait with human-like timing after an action
 * @param {string} actionType - Type of action (navigation, action, submit)
 * @returns {Promise<void>}
 */
export async function humanWait(actionType = 'action') {
  let delay;

  switch (actionType) {
    case 'navigation':
      delay = randomInRange(
        ACTION_DELAYS.AFTER_NAVIGATION_MS.MIN,
        ACTION_DELAYS.AFTER_NAVIGATION_MS.MAX
      );
      break;
    case 'submit':
    case 'beforeSubmit':
      delay = randomInRange(
        ACTION_DELAYS.BEFORE_SUBMIT_MS.MIN,
        ACTION_DELAYS.BEFORE_SUBMIT_MS.MAX
      );
      break;
    case 'afterSubmit':
      delay = randomInRange(
        ACTION_DELAYS.AFTER_SUBMIT_MS.MIN,
        ACTION_DELAYS.AFTER_SUBMIT_MS.MAX
      );
      break;
    case 'scroll':
      delay = randomInRange(
        ACTION_DELAYS.SCROLL_PAUSE_MS.MIN,
        ACTION_DELAYS.SCROLL_PAUSE_MS.MAX
      );
      break;
    case 'action':
    default:
      delay = randomInRange(
        ACTION_DELAYS.BETWEEN_ACTIONS_MS.MIN,
        ACTION_DELAYS.BETWEEN_ACTIONS_MS.MAX
      );
      break;
  }

  await sleep(delay);
}

/**
 * Scroll page with human-like behavior
 * @param {Page} page - Puppeteer page instance
 * @param {Object} options - Scroll options
 */
export async function humanScroll(page, options = {}) {
  const {
    direction = 'down',
    distance = 300,
    steps = 5
  } = options;

  const stepDistance = Math.floor(distance / steps);
  const scrollMultiplier = direction === 'up' ? -1 : 1;

  for (let i = 0; i < steps; i++) {
    // Add slight variation to each step
    const actualStep = stepDistance + randomInRange(-20, 20);

    await page.evaluate((y) => {
      window.scrollBy({ top: y, behavior: 'smooth' });
    }, actualStep * scrollMultiplier);

    // Random pause between scroll steps
    await sleep(randomInRange(50, 150));
  }

  // Pause after scrolling
  await humanWait('scroll');
}

/**
 * Scroll element into view with human-like behavior
 * @param {Page} page - Puppeteer page instance
 * @param {string} selector - CSS selector
 */
export async function scrollToElement(page, selector) {
  await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, selector);

  await humanWait('scroll');
}

/**
 * Fill a form with human-like behavior
 * @param {Page} page - Puppeteer page instance
 * @param {Object} fields - Form fields { selector: value }
 * @param {Object} options - Fill options
 */
export async function humanFillForm(page, fields, options = {}) {
  const {
    cursor = null,
    tabBetweenFields = false
  } = options;

  const fieldEntries = Object.entries(fields);

  for (let i = 0; i < fieldEntries.length; i++) {
    const [selector, value] = fieldEntries[i];

    // Move to field (if cursor provided)
    if (cursor) {
      await cursor.click(selector);
    } else {
      await page.click(selector);
    }

    await humanWait('action');

    // Type the value
    await humanType(page, selector, value, {
      clearFirst: true,
      clickFirst: false // Already clicked
    });

    // Wait between fields
    if (i < fieldEntries.length - 1) {
      await humanWait('action');

      // Optionally use Tab to move to next field
      if (tabBetweenFields) {
        await page.keyboard.press('Tab');
        await sleep(randomInRange(100, 200));
      }
    }
  }
}

/**
 * Submit a form with human-like behavior
 * @param {Page} page - Puppeteer page instance
 * @param {string} submitSelector - CSS selector for submit button
 * @param {Object} options - Submit options
 */
export async function humanSubmit(page, submitSelector, options = {}) {
  const { cursor = null, waitForNavigation = true } = options;

  // Pause before submit (human would review)
  await humanWait('beforeSubmit');

  // Click submit
  if (cursor) {
    await cursor.click(submitSelector);
  } else {
    await page.click(submitSelector);
  }

  // Wait for navigation if expected
  if (waitForNavigation) {
    try {
      await page.waitForNavigation({
        timeout: 10000,
        waitUntil: 'networkidle2'
      });
    } catch (e) {
      // Navigation might not happen (AJAX form)
    }
  }

  await humanWait('afterSubmit');
}

export default {
  createHumanCursor,
  humanType,
  humanWait,
  humanScroll,
  scrollToElement,
  humanFillForm,
  humanSubmit
};
