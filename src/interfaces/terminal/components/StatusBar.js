/**
 * StatusBar Component
 * Displays connection uptime, agent info, and statistics
 * Rotates between uptime and help hint every 5 seconds
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const ROTATION_INTERVAL_MS = 5000; // 5 seconds

export function StatusBar({
  connectionStatus,
  connectionUptime = 0,
  currentAgent,
  currentMode,
  messageCount = 0,
  activeAgentCount = 0,
  totalAgentCount = 0,
  toolCount = 0,
  errorCount = 0,
}) {
  const [showHelpHint, setShowHelpHint] = useState(false);

  // Rotate between uptime and help hint every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setShowHelpHint((prev) => !prev);
    }, ROTATION_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return hrs + 'h ' + (mins - hrs * 60) + 'm';
    if (mins > 0) return mins + 'm ' + (seconds - mins * 60) + 's';
    return seconds + 's';
  };

  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: errorCount > 0 ? 'red' : 'gray', paddingX: 1 },
    React.createElement(Box, { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
      React.createElement(Text, { dimColor: !showHelpHint, color: showHelpHint ? 'cyan' : undefined, bold: showHelpHint },
        showHelpHint
          ? 'Press Alt+H for help and keyboard shortcuts'
          : 'Uptime: ' + formatUptime(connectionUptime) + ' | Mode: ' + (currentMode || 'CHAT') + ' | Messages: ' + messageCount
      ),
      React.createElement(Box, { flexDirection: 'row', gap: 1 },
        errorCount > 0 &&
          React.createElement(Text, { color: 'red', bold: true },
            '⚠ ' + errorCount + ' error' + (errorCount > 1 ? 's' : '') + ' | '
          ),
        React.createElement(Text, { dimColor: true },
          'Agents: ' + activeAgentCount + '/' + totalAgentCount + ' | Tools: ' + toolCount
        )
      )
    )
  );
}

export default StatusBar;
