import React, { useState, useEffect } from 'react';
import { ArrowDownTrayIcon, XMarkIcon, ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useAppStore } from '../stores/appStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';

/**
 * UpdateNotificationBar - Shows when a new version is available
 *
 * Displays a notification bar at the top of the app when an update is available.
 * Offers three actions:
 * - "Not now" - Dismisses until next session
 * - "Don't show again" - Dismisses for this version (or 7 days)
 * - "Update" - Dropdown with auto-update or copy command options
 */
const UpdateNotificationBar = () => {
  const { versionInfo } = useAppStore();
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check if notification should be shown
  useEffect(() => {
    const dismissedData = localStorage.getItem('update-dismissed');
    if (dismissedData) {
      try {
        const { version, until } = JSON.parse(dismissedData);
        // Dismiss if same version OR still within dismiss period
        if (version === versionInfo.latestVersion || Date.now() < until) {
          setDismissed(true);
        }
      } catch (e) {
        // Invalid data, show notification
      }
    }
  }, [versionInfo.latestVersion]);

  // Don't show if no update available or dismissed
  if (!versionInfo.updateAvailable || dismissed) {
    return null;
  }

  const handleNotNow = () => {
    setDismissed(true);
    // Session-only dismiss (no localStorage)
  };

  const handleDontShowAgain = () => {
    // Dismiss for this version OR 7 days, whichever comes first
    localStorage.setItem('update-dismissed', JSON.stringify({
      version: versionInfo.latestVersion,
      until: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    }));
    setDismissed(true);
  };

  const handleAutoUpdate = async () => {
    setShowDropdown(false);
    setUpdating(true);

    try {
      toast.loading('Updating OnBuzz Community...', { id: 'update' });

      const result = await api.performUpdate({
        restartCommand: 'loxia web',
        restartDelay: 5000
      });

      if (result.success) {
        toast.success('Update complete! Restarting...', { id: 'update' });
        // The backend will restart, we just need to wait and refresh
        setTimeout(() => {
          toast.loading('Reconnecting...', { id: 'update' });
        }, 3000);

        // Poll for server restart
        const checkServer = async () => {
          try {
            await api.health();
            toast.success('Loxia restarted successfully!', { id: 'update' });
            window.location.reload();
          } catch (e) {
            setTimeout(checkServer, 2000);
          }
        };
        setTimeout(checkServer, 6000);
      } else {
        throw new Error(result.error || 'Update failed');
      }
    } catch (error) {
      toast.error(`Update failed: ${error.message}. Try copying the command instead.`, { id: 'update' });
      setUpdating(false);
    }
  };

  const handleCopyCommand = async () => {
    setShowDropdown(false);
    try {
      await navigator.clipboard.writeText(versionInfo.updateCommand);
      setCopied(true);
      toast.success('Command copied! Run in terminal, then restart Loxia.');
      setTimeout(() => setCopied(false), 3000);
    } catch (error) {
      toast.error('Failed to copy command');
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showDropdown && !e.target.closest('.update-dropdown')) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showDropdown]);

  return (
    <>
    <div className="fixed top-0 left-0 right-0 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-2 flex items-center justify-between shadow-lg z-[60]">
      <div className="flex items-center gap-3">
        <ArrowDownTrayIcon className="w-5 h-5" />
        <span className="text-sm font-medium">
          Update available: v{versionInfo.currentVersion} → v{versionInfo.latestVersion}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Not now button */}
        <button
          onClick={handleNotNow}
          disabled={updating}
          className="px-3 py-1 text-sm font-medium text-white/80 hover:text-white transition-colors disabled:opacity-50"
        >
          Not now
        </button>

        {/* Don't show again button */}
        <button
          onClick={handleDontShowAgain}
          disabled={updating}
          className="px-3 py-1 text-sm font-medium text-white/80 hover:text-white transition-colors disabled:opacity-50"
        >
          Don't show again
        </button>

        {/* Update dropdown */}
        <div className="relative update-dropdown">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDropdown(!showDropdown);
            }}
            disabled={updating}
            className="px-4 py-1.5 text-sm font-semibold bg-white text-orange-600 rounded-md hover:bg-orange-50 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {updating ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Updating...</span>
              </>
            ) : (
              <>
                <span>Update</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </>
            )}
          </button>

          {/* Dropdown menu */}
          {showDropdown && !updating && (
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
              <button
                onClick={handleAutoUpdate}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                Auto-update
              </button>
              <button
                onClick={handleCopyCommand}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
              >
                {copied ? (
                  <CheckIcon className="w-4 h-4 text-green-500" />
                ) : (
                  <ClipboardIcon className="w-4 h-4" />
                )}
                Copy command
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    {/* Spacer to push content below the fixed bar */}
    <div className="h-10" />
    </>
  );
};

export default UpdateNotificationBar;
