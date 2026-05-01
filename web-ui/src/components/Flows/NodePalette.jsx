import React from 'react';
import {
  ArrowRightStartOnRectangleIcon,
  CpuChipIcon,
  ArrowRightEndOnRectangleIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice.js';

// Node type definitions
const NODE_TYPES = [
  {
    type: 'input',
    label: 'Input',
    description: 'Flow entry point',
    icon: ArrowRightStartOnRectangleIcon,
    color: 'green'
  },
  {
    type: 'agent',
    label: 'Agent',
    description: 'AI agent processor',
    icon: CpuChipIcon,
    color: 'blue'
  },
  {
    type: 'output',
    label: 'Output',
    description: 'Flow result',
    icon: ArrowRightEndOnRectangleIcon,
    color: 'amber'
  }
];

// Color classes mapping
const colorClasses = {
  green: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    border: 'border-green-300 dark:border-green-700',
    icon: 'text-green-600 dark:text-green-400',
    hover: 'hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/50'
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    border: 'border-blue-300 dark:border-blue-700',
    icon: 'text-blue-600 dark:text-blue-400',
    hover: 'hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/50'
  },
  amber: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    border: 'border-amber-300 dark:border-amber-700',
    icon: 'text-amber-600 dark:text-amber-400',
    hover: 'hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/50'
  },
  purple: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    border: 'border-purple-300 dark:border-purple-700',
    icon: 'text-purple-600 dark:text-purple-400',
    hover: 'hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/50'
  }
};

/**
 * NodePalette
 *
 * Each tile is BOTH draggable AND tappable — so we don't have to detect
 * what kind of device the user is on. Mouse drag fires HTML5
 * drag-and-drop (FlowCanvas.onDrop reads the dataTransfer payload);
 * touch tap fires onClick (HTML5 drag-and-drop is a no-op on most touch
 * devices, so this is the only path that works there). Earlier code
 * gated on `pointer: coarse` to swap UIs, but Windows touch laptops
 * with a mouse plugged in often report `pointer: coarse: true` and
 * lost the drag affordance entirely. Single rendering path is simpler
 * and works everywhere.
 */
function NodePalette({ onAddNode }) {
  // Hint label only — no rendering changes based on detection.
  const isTouch = useIsTouchDevice();

  const onDragStart = (event, nodeType, label) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-56 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Node Palette
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {isTouch ? 'Tap to add nodes' : 'Drag or tap to add'}
        </p>
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {NODE_TYPES.map((node) => (
          <PaletteNode
            key={node.type}
            node={node}
            onDragStart={onDragStart}
            onTap={typeof onAddNode === 'function' ? () => onAddNode(node.type, node.label) : null}
          />
        ))}
      </div>

      {/* Help */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
          <QuestionMarkCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-gray-700 dark:text-gray-300">Tips</p>
            <ul className="mt-1 space-y-0.5">
              <li>• {isTouch ? 'Tap a tile to add a node' : 'Drag a tile or tap to add'}</li>
              <li>• Connect nodes by dragging handles</li>
              <li>• Click a node to edit; Delete to remove</li>
              {isTouch && <li>• Pinch to zoom; two-finger drag to pan</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaletteNode({ node, onDragStart, onTap }) {
  const colors = colorClasses[node.color];
  const Icon = node.icon;

  // ONE rendering path: a draggable div that also accepts onClick.
  // - Mouse drag → HTML5 dragstart fires, drop lands on canvas via onDrop.
  // - Mouse click without drag → onClick fires (adds at fallback position).
  // - Touch tap → no dragstart on most browsers, onClick fires.
  // - Touch drag-attempt → no-op (HTML5 D&D not supported), onClick fires
  //   on tap release.
  // This means a stationary mousedown+mouseup also adds the node — that's
  // actually the desired UX: any tap-equivalent should produce a node.
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, node.type, node.label)}
      onClick={onTap || undefined}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onTap) {
          e.preventDefault();
          onTap();
        }
      }}
      className={`
        flex items-center gap-3 p-3 rounded-lg border-2 cursor-grab active:cursor-grabbing
        transition-all min-h-[44px] ${colors.border} ${colors.hover}
        bg-white dark:bg-gray-800
        focus:outline-none focus:ring-2 focus:ring-loxia-500 focus:ring-offset-1
      `}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.bg}`}>
        <Icon className={`w-4 h-4 ${colors.icon}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {node.label}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {node.description}
        </p>
      </div>
    </div>
  );
}

export default NodePalette;
