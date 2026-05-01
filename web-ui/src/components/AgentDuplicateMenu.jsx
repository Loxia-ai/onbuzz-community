import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  DocumentDuplicateIcon,
  BoltIcon,
  Cog6ToothIcon
} from '@heroicons/react/24/outline';

/**
 * AgentDuplicateMenu - Dropdown menu for agent duplication options
 *
 * Options:
 * 1. Quick Clone - Instant copy with empty conversation, auto-generated name
 * 2. Clone & Configure - Opens creation modal with pre-filled settings
 */
function AgentDuplicateMenu({ agent, onQuickClone, onCloneWithSettings, disabled = false, iconSize = 'w-4 h-4', buttonClass = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // Calculate menu position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 224; // w-56 = 14rem = 224px
      const menuHeight = 120; // Approximate height of the menu
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Determine if menu should open above or below
      const openAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;

      setMenuPosition({
        top: openAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
        left: Math.max(8, rect.right - menuWidth) // Ensure it doesn't go off-screen left
      });
    }
  }, [isOpen]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target) &&
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      window.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const handleQuickClone = () => {
    setIsOpen(false);
    onQuickClone?.(agent);
  };

  const handleCloneWithSettings = () => {
    setIsOpen(false);
    onCloneWithSettings?.(agent);
  };

  const dropdownMenu = isOpen ? (
    <div
      ref={menuRef}
      className="fixed w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-[9999] py-1"
      style={{
        top: menuPosition.top,
        left: menuPosition.left
      }}
    >
      {/* Quick Clone Option */}
      <button
        onClick={handleQuickClone}
        className="w-full flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <BoltIcon className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
        <div className="text-left">
          <div className="font-medium">Quick Clone</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Fresh start, auto-generated name
          </div>
        </div>
      </button>

      <div className="border-t border-gray-200 dark:border-gray-700 my-1" />

      {/* Clone & Configure Option */}
      <button
        onClick={handleCloneWithSettings}
        className="w-full flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <Cog6ToothIcon className="w-4 h-4 text-blue-500 mr-2 flex-shrink-0" />
        <div className="text-left">
          <div className="font-medium">Clone & Configure</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Customize settings, keep history
          </div>
        </div>
      </button>
    </div>
  ) : null;

  return (
    <>
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className={buttonClass || "p-1.5 rounded hover:bg-white dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 hover:text-blue-600"}
        disabled={disabled}
        title="Clone pilot"
      >
        <DocumentDuplicateIcon className={iconSize} />
      </button>

      {/* Portal the dropdown menu to body */}
      {createPortal(dropdownMenu, document.body)}
    </>
  );
}

export default AgentDuplicateMenu;
