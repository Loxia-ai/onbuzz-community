/**
 * Registry of per-tool configurators.
 *
 * A configurator is a React component that renders a form for ONE tool's
 * per-agent configuration (the slice of `agent.toolConfig[toolId]`). The
 * ToolConfigModal looks up the component by tool id and hosts it.
 *
 * Registration pattern lives here (not on the components themselves) so
 * adding a new configurator is a single import + map entry rather than
 * hunting through the modal. Tools without a registered configurator get
 * a grey-out ⚙ button and a "no configurable settings" state when
 * clicked, which is the right default for tools like `jobdone` / `help`
 * that have nothing user-configurable.
 *
 * Each configurator receives props:
 *   value:        object | null    — current per-agent config for this
 *                                    tool (null = use global defaults)
 *   onChange:     (newValue) => {} — parent merges into agent.toolConfig
 *   disabled:     boolean          — gray-out while a save is in flight
 */

import TerminalConfigurator     from './TerminalConfigurator.jsx';
import FilesystemConfigurator   from './FilesystemConfigurator.jsx';
import WebConfigurator          from './WebConfigurator.jsx';
import AgentCommConfigurator    from './AgentCommConfigurator.jsx';
import PlatformControlConfigurator from './PlatformControlConfigurator.jsx';
// widget-module: remove this line if the module is deleted.
import { WidgetConfigurator }   from '../../modules/widget';

const CONFIGURATORS = Object.freeze({
  terminal:           TerminalConfigurator,
  filesystem:         FilesystemConfigurator,
  web:                WebConfigurator,
  agentcommunication: AgentCommConfigurator,
  platformcontrol:    PlatformControlConfigurator,
  // widget-module: remove this line if the module is deleted.
  widget:             WidgetConfigurator,
});

/**
 * @param {string} toolId
 * @returns {React.ComponentType | null}
 */
export function getConfigurator(toolId) {
  return CONFIGURATORS[toolId] || null;
}

/**
 * @param {string} toolId
 * @returns {boolean}
 */
export function hasConfigurator(toolId) {
  return !!CONFIGURATORS[toolId];
}

export default { getConfigurator, hasConfigurator };
