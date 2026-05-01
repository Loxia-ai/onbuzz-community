/**
 * ThinkingBubble Component
 *
 * Unified indicator shown whenever the agent is busy/processing.
 * Shows rotating messages and tracks elapsed time for long waits.
 */

import React, { useState, useEffect } from 'react';
import { CpuChipIcon } from '@heroicons/react/24/outline';

const THINKING_MESSAGES = [
  'Waiting for my turn...',
  'In the queue, hang tight.',
  'Preparing to process...',
  'Almost my turn...',
  'Standing by...'
];

// Messages shown when waiting longer than expected (agent is waiting to be scheduled)
const LONG_WAIT_MESSAGES = [
  'Waiting to be scheduled, bear with me.',
  'Other agents are being processed, I\'m next...',
  'Sitting tight until scheduled...',
  'Hold on, I\'ll be with you shortly...',
  'Still waiting for my slot...'
];

const LONG_WAIT_THRESHOLD = 30000; // 30 seconds before showing long wait messages
const LONG_WAIT_INTERVAL = 30000;  // Show new long wait message every 30 seconds
const MESSAGE_INTERVAL = 2500;     // Time between message changes (ms)

function ThinkingBubble({ agentName = 'Assistant' }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [longWaitIndex, setLongWaitIndex] = useState(0);

  const isLongWait = elapsedTime >= LONG_WAIT_THRESHOLD;

  // Track elapsed time
  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Update long wait message index every 30 seconds after threshold
  useEffect(() => {
    if (!isLongWait) return;

    const longWaitElapsed = elapsedTime - LONG_WAIT_THRESHOLD;
    const newIndex = Math.floor(longWaitElapsed / LONG_WAIT_INTERVAL) % LONG_WAIT_MESSAGES.length;

    if (newIndex !== longWaitIndex) {
      setIsExiting(true);
      setTimeout(() => {
        setLongWaitIndex(newIndex);
        setIsExiting(false);
      }, 400);
    }
  }, [elapsedTime, isLongWait, longWaitIndex]);

  // Rotate normal messages when not in long wait
  useEffect(() => {
    if (isLongWait) return;

    const interval = setInterval(() => {
      setIsExiting(true);

      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % THINKING_MESSAGES.length);
        setIsExiting(false);
      }, 400);
    }, MESSAGE_INTERVAL);

    return () => clearInterval(interval);
  }, [isLongWait]);

  const getMessage = () => {
    if (isLongWait) {
      return LONG_WAIT_MESSAGES[longWaitIndex];
    }
    return THINKING_MESSAGES[currentIndex];
  };

  return (
    <div className="message-bubble message-assistant">
      <div className="flex items-center">
        {/* Agent Avatar */}
        <div className="w-8 h-8 bg-loxia-600 rounded-full flex items-center justify-center flex-shrink-0">
          <CpuChipIcon className="w-5 h-5 text-white" />
        </div>

        {/* Content */}
        <div className="ml-3 flex items-center">
          {/* Spinner */}
          <div
            className="w-5 h-5 border-2 rounded-full animate-spin border-gray-300 dark:border-gray-600 border-t-loxia-600 dark:border-t-loxia-400"
          />

          {/* Message */}
          <div className="ml-3 min-w-[280px]">
            <span className={`text-sm font-medium text-gray-600 dark:text-gray-300 ${isExiting ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}>
              {getMessage()}
            </span>
          </div>
        </div>
      </div>

      {/* Agent Name and elapsed time */}
      <div className="mt-1 ml-11 text-xs text-gray-400 dark:text-gray-500">
        {agentName} is working...
        {isLongWait && (
          <span className="ml-2 text-amber-500 dark:text-amber-400">
            ({Math.floor(elapsedTime / 1000)}s)
          </span>
        )}
      </div>
    </div>
  );
}

export default ThinkingBubble;
