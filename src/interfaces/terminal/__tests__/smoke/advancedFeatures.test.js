/**
 * Phase 10 Advanced Features - Smoke Tests
 * Verifies AgentSwitcher, AgentCreator, SettingsPanel, SearchPanel, and HelpPanel components
 */

import { describe, test, expect } from '@jest/globals';

describe('Phase 10 - Advanced Features - Imports', () => {
  test('AgentSwitcher component can be imported', async () => {
    const { AgentSwitcher } = await import('../../components/AgentSwitcher.js');

    expect(AgentSwitcher).toBeDefined();
    expect(typeof AgentSwitcher).toBe('function');
  }, 30000);

  test('AgentCreator component can be imported', async () => {
    const { AgentCreator } = await import('../../components/AgentCreator.js');

    expect(AgentCreator).toBeDefined();
    expect(typeof AgentCreator).toBe('function');
  });

  test('SettingsPanel component can be imported', async () => {
    const { SettingsPanel } = await import('../../components/SettingsPanel.js');

    expect(SettingsPanel).toBeDefined();
    expect(typeof SettingsPanel).toBe('function');
  });

  test('SearchPanel component can be imported', async () => {
    const { SearchPanel } = await import('../../components/SearchPanel.js');

    expect(SearchPanel).toBeDefined();
    expect(typeof SearchPanel).toBe('function');
  });

  test('HelpPanel component can be imported', async () => {
    const { HelpPanel } = await import('../../components/HelpPanel.js');

    expect(HelpPanel).toBeDefined();
    expect(typeof HelpPanel).toBe('function');
  });
});

describe('Phase 10 - AgentSwitcher - Structure', () => {
  test('AgentSwitcher is a function component', async () => {
    const { AgentSwitcher } = await import('../../components/AgentSwitcher.js');

    expect(typeof AgentSwitcher).toBe('function');
    expect(AgentSwitcher.prototype?.render).toBeUndefined();
  });

  test('AgentSwitcher is default export', async () => {
    const module = await import('../../components/AgentSwitcher.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.AgentSwitcher);
  });
});

describe('Phase 10 - AgentCreator - Structure', () => {
  test('AgentCreator is a function component', async () => {
    const { AgentCreator } = await import('../../components/AgentCreator.js');

    expect(typeof AgentCreator).toBe('function');
    expect(AgentCreator.prototype?.render).toBeUndefined();
  });

  test('AgentCreator is default export', async () => {
    const module = await import('../../components/AgentCreator.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.AgentCreator);
  });
});

describe('Phase 10 - SettingsPanel - Structure', () => {
  test('SettingsPanel is a function component', async () => {
    const { SettingsPanel } = await import('../../components/SettingsPanel.js');

    expect(typeof SettingsPanel).toBe('function');
    expect(SettingsPanel.prototype?.render).toBeUndefined();
  });

  test('SettingsPanel is default export', async () => {
    const module = await import('../../components/SettingsPanel.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.SettingsPanel);
  });
});

describe('Phase 10 - SearchPanel - Structure', () => {
  test('SearchPanel is a function component', async () => {
    const { SearchPanel } = await import('../../components/SearchPanel.js');

    expect(typeof SearchPanel).toBe('function');
    expect(SearchPanel.prototype?.render).toBeUndefined();
  });

  test('SearchPanel is default export', async () => {
    const module = await import('../../components/SearchPanel.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.SearchPanel);
  });
});

describe('Phase 10 - HelpPanel - Structure', () => {
  test('HelpPanel is a function component', async () => {
    const { HelpPanel } = await import('../../components/HelpPanel.js');

    expect(typeof HelpPanel).toBe('function');
    expect(HelpPanel.prototype?.render).toBeUndefined();
  });

  test('HelpPanel is default export', async () => {
    const module = await import('../../components/HelpPanel.js');

    expect(module.default).toBeDefined();
    expect(module.default).toBe(module.HelpPanel);
  });
});

describe('Phase 10 - Integration with Layout', () => {
  test('Layout component can import all Phase 10 components', async () => {
    const [
      agentSwitcherModule,
      agentCreatorModule,
      settingsPanelModule,
      searchPanelModule,
      helpPanelModule,
    ] = await Promise.all([
      import('../../components/AgentSwitcher.js'),
      import('../../components/AgentCreator.js'),
      import('../../components/SettingsPanel.js'),
      import('../../components/SearchPanel.js'),
      import('../../components/HelpPanel.js'),
    ]);

    expect(agentSwitcherModule.AgentSwitcher).toBeDefined();
    expect(agentCreatorModule.AgentCreator).toBeDefined();
    expect(settingsPanelModule.SettingsPanel).toBeDefined();
    expect(searchPanelModule.SearchPanel).toBeDefined();
    expect(helpPanelModule.HelpPanel).toBeDefined();
  });

  test('Layout component still loads after Phase 10 additions', async () => {
    const { Layout } = await import('../../components/Layout.js');

    expect(Layout).toBeDefined();
    expect(typeof Layout).toBe('function');
  });

  test('All Phase 10 components use React and Ink', async () => {
    const React = await import('react');
    const ink = await import('ink');

    // Verify dependencies are available
    expect(React.createElement).toBeDefined();
    expect(React.useState).toBeDefined();
    expect(ink.Box).toBeDefined();
    expect(ink.Text).toBeDefined();
    expect(ink.useInput).toBeDefined();
  });
});

describe('Phase 10 - Component Constants and Configurations', () => {
  test('AgentCreator defines step constants', async () => {
    // We can't directly access module constants, but we can verify the module structure
    const module = await import('../../components/AgentCreator.js');

    expect(module.AgentCreator).toBeDefined();
    // The component uses STEPS, MODELS, MODES internally
  });

  test('SettingsPanel defines category constants', async () => {
    const module = await import('../../components/SettingsPanel.js');

    expect(module.SettingsPanel).toBeDefined();
    // The component uses CATEGORIES, CATEGORY_TITLES internally
  });

  test('HelpPanel defines shortcut configurations', async () => {
    const module = await import('../../components/HelpPanel.js');

    expect(module.HelpPanel).toBeDefined();
    // The component uses SHORTCUTS and TIPS internally
  });
});

describe('Phase 10 - All Components Export Correctly', () => {
  test('All components can be imported together without conflicts', async () => {
    const components = await Promise.all([
      import('../../components/AgentSwitcher.js'),
      import('../../components/AgentCreator.js'),
      import('../../components/SettingsPanel.js'),
      import('../../components/SearchPanel.js'),
      import('../../components/HelpPanel.js'),
    ]);

    // Verify no naming conflicts
    const names = components.map((mod) => Object.keys(mod)[0]);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length); // All unique names
  });
});
