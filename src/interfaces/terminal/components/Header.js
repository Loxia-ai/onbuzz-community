/**
 * Header Component
 * Displays application title, current agent, and connection status
 */

import React from 'react';
import { Box, Text } from 'ink';

export function Header({ currentAgent, connectionStatus, isConnected }) {
  const statusColor = isConnected ? 'green' : 'red';
  const statusText = isConnected ? '● Connected' : '● Disconnected';

  return React.createElement(
    Box,
    { borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    React.createElement(Box, { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
      // Title and agent
      React.createElement(Box, {},
        React.createElement(Text, { bold: true, color: 'cyan' }, 'OnBuzz Community'),
        currentAgent && React.createElement(Text, { dimColor: true }, ` | Agent: ${currentAgent.name}`)
      ),
      // Connection status
      React.createElement(Text, { color: statusColor }, statusText)
    )
  );
}

export default Header;
