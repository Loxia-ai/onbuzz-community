/**
 * ToolIcon — renders the Heroicon associated with a tool.
 *
 * Input contract:
 *   <ToolIcon iconName="CommandLine" />   (from backend GET /api/tools)
 * OR
 *   <ToolIcon toolId="terminal" />        (legacy fallback — resolves
 *                                          via constants/toolConstants)
 *
 * The backend includes `iconName` on every tool it emits (see
 * `baseTool.js#_getToolIconName`), so the `iconName` path is the
 * canonical one. The `toolId` fallback exists so renderers that don't
 * have the tool record (only the id) stay functional.
 *
 * Icon is always the @heroicons/react/24/outline variant. Unknown names
 * fall back to WrenchScrewdriverIcon so nothing breaks if backend adds
 * a tool the frontend hasn't rebuilt against yet.
 */

import React from 'react';
import * as OutlineIcons from '@heroicons/react/24/outline';
import { TOOL_ICONS } from '../constants/toolConstants';

function resolveIconComponent(iconName) {
  if (!iconName) return OutlineIcons.WrenchScrewdriverIcon;
  // Heroicons export e.g. `CommandLineIcon` — accept either `CommandLine`
  // (backend convention, strips the suffix) or the full `CommandLineIcon`.
  const withSuffix = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`;
  return OutlineIcons[withSuffix] || OutlineIcons.WrenchScrewdriverIcon;
}

function ToolIcon({ iconName, toolId, className = 'w-4 h-4', ...rest }) {
  const resolvedName = iconName || (toolId ? TOOL_ICONS[toolId] : null);
  const IconComponent = resolveIconComponent(resolvedName);
  return <IconComponent className={className} aria-hidden="true" {...rest} />;
}

export default ToolIcon;
