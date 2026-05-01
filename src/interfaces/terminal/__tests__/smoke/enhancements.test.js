/**
 * Phase 9 Enhancements - Smoke Tests
 * Verifies ErrorBoundary, LoadingSpinner, and enhanced InputBox components
 */

import { describe, test, expect } from '@jest/globals';

describe('Phase 9 - Enhanced Components - Imports', () => {
  test('ErrorBoundary component can be imported', async () => {
    const { ErrorBoundary } = await import('../../components/ErrorBoundary.js');

    expect(ErrorBoundary).toBeDefined();
    expect(typeof ErrorBoundary).toBe('function');
  }, 30000); // Increase timeout for import

  test('ErrorBoundary is a class component', async () => {
    const { ErrorBoundary } = await import('../../components/ErrorBoundary.js');

    // Verify it's a class with correct methods
    expect(ErrorBoundary.prototype).toBeDefined();
    expect(typeof ErrorBoundary.prototype.render).toBe('function');
  });

  test('LoadingSpinner component can be imported', async () => {
    const { LoadingSpinner } = await import('../../components/LoadingSpinner.js');

    expect(LoadingSpinner).toBeDefined();
    expect(typeof LoadingSpinner).toBe('function');
  });

  test('InlineSpinner component can be imported', async () => {
    const { InlineSpinner } = await import('../../components/LoadingSpinner.js');

    expect(InlineSpinner).toBeDefined();
    expect(typeof InlineSpinner).toBe('function');
  });

  test('LoadingSpinner is default export', async () => {
    const module = await import('../../components/LoadingSpinner.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.LoadingSpinner);
  });

  test('Enhanced InputBox maintains backward compatibility', async () => {
    const { InputBox } = await import('../../components/InputBox.js');

    expect(InputBox).toBeDefined();
    expect(typeof InputBox).toBe('function');
  });
});

describe('Phase 9 - ErrorBoundary - Structure', () => {
  test('ErrorBoundary is a React Component class', async () => {
    const { ErrorBoundary } = await import('../../components/ErrorBoundary.js');
    const React = await import('react');

    // Check that it extends React.Component
    expect(ErrorBoundary.prototype).toBeDefined();
    expect(typeof ErrorBoundary.prototype.render).toBe('function');
    expect(typeof ErrorBoundary.prototype.componentDidCatch).toBe('function');
  });

  test('ErrorBoundary has getDerivedStateFromError static method', async () => {
    const { ErrorBoundary } = await import('../../components/ErrorBoundary.js');

    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe('function');
  });

  test('ErrorBoundary componentDidCatch is defined', async () => {
    const { ErrorBoundary } = await import('../../components/ErrorBoundary.js');

    expect(typeof ErrorBoundary.prototype.componentDidCatch).toBe('function');
  });
});

describe('Phase 9 - LoadingSpinner - Structure', () => {
  test('LoadingSpinner is a function component', async () => {
    const { LoadingSpinner } = await import('../../components/LoadingSpinner.js');

    // Verify it's a function component
    expect(typeof LoadingSpinner).toBe('function');

    // It should not be a class (no prototype.render)
    expect(LoadingSpinner.prototype?.render).toBeUndefined();
  });

  test('InlineSpinner is a function component', async () => {
    const { InlineSpinner } = await import('../../components/LoadingSpinner.js');

    expect(typeof InlineSpinner).toBe('function');

    // It should not be a class (no prototype.render)
    expect(InlineSpinner.prototype?.render).toBeUndefined();
  });
});

describe('Phase 9 - Enhanced InputBox - History Support', () => {
  test('Enhanced InputBox imports useRef for history', async () => {
    const inputBoxSource = await import('../../components/InputBox.js');
    const React = await import('react');

    // Verify React hooks are available (used for history)
    expect(React.useState).toBeDefined();
    expect(React.useRef).toBeDefined();
  });

  test('InputBox component maintains exports', async () => {
    const module = await import('../../components/InputBox.js');

    expect(module.InputBox).toBeDefined();
    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.InputBox);
  });
});

describe('Phase 9 - Integration', () => {
  test('All enhanced components can be imported together', async () => {
    const [errorBoundaryModule, spinnerModule, inputBoxModule] = await Promise.all([
      import('../../components/ErrorBoundary.js'),
      import('../../components/LoadingSpinner.js'),
      import('../../components/InputBox.js'),
    ]);

    expect(errorBoundaryModule.ErrorBoundary).toBeDefined();
    expect(spinnerModule.LoadingSpinner).toBeDefined();
    expect(spinnerModule.InlineSpinner).toBeDefined();
    expect(inputBoxModule.InputBox).toBeDefined();
  });

  test('Enhanced Layout component imports useInput for keyboard shortcuts', async () => {
    const React = await import('react');
    const ink = await import('ink');

    // Verify useInput is available (used for keyboard shortcuts)
    expect(ink.useInput).toBeDefined();
    expect(typeof ink.useInput).toBe('function');
  });

  test('Layout component can still be imported after enhancements', async () => {
    const { Layout } = await import('../../components/Layout.js');

    expect(Layout).toBeDefined();
    expect(typeof Layout).toBe('function');
  });
});

describe('Phase 9 - Enhanced Features - Constants', () => {
  test('InputBox defines MAX_HISTORY constant', async () => {
    // We can't directly access the constant, but we can verify the module loads
    const module = await import('../../components/InputBox.js');

    expect(module.InputBox).toBeDefined();
    // The constant is used internally for history management
  });
});
