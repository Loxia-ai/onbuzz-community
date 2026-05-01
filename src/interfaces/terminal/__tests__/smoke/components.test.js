/**
 * Component Management - Smoke Tests
 * Verifies that UI components can be imported and basic structure is correct
 */

import { describe, test, expect } from '@jest/globals';

describe('Component Management - Imports', () => {
  test('Layout component can be imported', async () => {
    const { Layout } = await import('../../components/Layout.js');

    expect(Layout).toBeDefined();
    expect(typeof Layout).toBe('function');
  });

  test('Layout is default export', async () => {
    const module = await import('../../components/Layout.js');

    expect(module.default).toBeDefined();
    expect(typeof module.default).toBe('function');
    expect(module.default).toBe(module.Layout);
  });

  test('Header component can be imported', async () => {
    const { Header } = await import('../../components/Header.js');

    expect(Header).toBeDefined();
    expect(typeof Header).toBe('function');
  });

  test('Header is default export', async () => {
    const module = await import('../../components/Header.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.Header);
  });

  test('StatusBar component can be imported', async () => {
    const { StatusBar } = await import('../../components/StatusBar.js');

    expect(StatusBar).toBeDefined();
    expect(typeof StatusBar).toBe('function');
  });

  test('StatusBar is default export', async () => {
    const module = await import('../../components/StatusBar.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.StatusBar);
  });

  test('MessageList component can be imported', async () => {
    const { MessageList } = await import('../../components/MessageList.js');

    expect(MessageList).toBeDefined();
    expect(typeof MessageList).toBe('function');
  });

  test('MessageList is default export', async () => {
    const module = await import('../../components/MessageList.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.MessageList);
  });

  test('InputBox component can be imported', async () => {
    const { InputBox } = await import('../../components/InputBox.js');

    expect(InputBox).toBeDefined();
    expect(typeof InputBox).toBe('function');
  });

  test('InputBox is default export', async () => {
    const module = await import('../../components/InputBox.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.InputBox);
  });
});

describe('Component Management - Integration', () => {
  test('All components can be imported together', async () => {
    const [
      layoutModule,
      headerModule,
      statusBarModule,
      messageListModule,
      inputBoxModule,
    ] = await Promise.all([
      import('../../components/Layout.js'),
      import('../../components/Header.js'),
      import('../../components/StatusBar.js'),
      import('../../components/MessageList.js'),
      import('../../components/InputBox.js'),
    ]);

    expect(layoutModule.Layout).toBeDefined();
    expect(headerModule.Header).toBeDefined();
    expect(statusBarModule.StatusBar).toBeDefined();
    expect(messageListModule.MessageList).toBeDefined();
    expect(inputBoxModule.InputBox).toBeDefined();
  });

  test('Layout component integrates with all state hooks', async () => {
    const { Layout } = await import('../../components/Layout.js');
    const { useConnection } = await import('../../state/useConnection.js');
    const { useAgents } = await import('../../state/useAgents.js');
    const { useMessages } = await import('../../state/useMessages.js');
    const { useAgentControl } = await import('../../state/useAgentControl.js');
    const { useTools } = await import('../../state/useTools.js');

    // Verify all dependencies exist
    expect(Layout).toBeDefined();
    expect(useConnection).toBeDefined();
    expect(useAgents).toBeDefined();
    expect(useMessages).toBeDefined();
    expect(useAgentControl).toBeDefined();
    expect(useTools).toBeDefined();
  });
});

describe('Component Management - React/Ink Dependencies', () => {
  test('Ink components can be imported', async () => {
    const { Box, Text } = await import('ink');

    expect(Box).toBeDefined();
    expect(Text).toBeDefined();
  });

  test('React can be imported', async () => {
    const React = await import('react');

    expect(React.default).toBeDefined();
    expect(React.useState).toBeDefined();
    expect(React.useEffect).toBeDefined();
  });
});
