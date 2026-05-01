import React, { useState, useEffect, useRef } from 'react';
import {
  KeyIcon,
  EyeIcon,
  EyeSlashIcon,
  XMarkIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { api } from '../services/api.js';
import toast from 'react-hot-toast';

/**
 * Site icons mapping - map site IDs to their branding
 */
const SITE_ICONS = {
  linkedin: {
    color: 'bg-blue-600',
    textColor: 'text-blue-600',
    label: 'in',
    icon: 'LinkedIn'
  },
  github: {
    color: 'bg-gray-900 dark:bg-gray-100',
    textColor: 'text-gray-900 dark:text-gray-100',
    icon: 'GitHub'
  },
  google: {
    color: 'bg-red-500',
    textColor: 'text-red-500',
    icon: 'Google'
  },
  twitter: {
    color: 'bg-black dark:bg-white',
    textColor: 'text-black dark:text-white',
    icon: 'X'
  }
};

/**
 * CredentialRequestModal - Secure credential input modal
 *
 * Shown when an agent needs credentials for authentication.
 * Credentials are submitted directly to the backend vault,
 * never exposed to the agent conversation.
 */
function CredentialRequestModal({ request, onClose, onSubmit }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveToVault, setSaveToVault] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);

  const usernameRef = useRef(null);

  // Focus username field on mount
  useEffect(() => {
    if (usernameRef.current) {
      usernameRef.current.focus();
    }
  }, []);

  // Countdown timer for request timeout
  useEffect(() => {
    if (!request?.timeout) return;

    const updateRemaining = () => {
      const now = Date.now();
      const remaining = Math.max(0, request.timeout - now);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        toast.error('Credential request timed out');
        onClose();
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [request?.timeout, onClose]);

  // Get site branding
  const siteId = request?.siteId || 'unknown';
  const siteName = request?.siteName || request?.siteId || 'Unknown Site';
  const siteConfig = SITE_ICONS[siteId];

  // Format remaining time
  const formatTime = (ms) => {
    if (!ms) return '';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      toast.error('Please enter both username and password');
      return;
    }

    setIsSubmitting(true);

    try {
      // Submit credentials directly to backend (never to agent)
      const response = await api.submitCredentials({
        requestId: request.requestId,
        siteId: request.siteId,
        username: username.trim(),
        password: password.trim(),
        saveToVault
      });

      if (response.success) {
        toast.success('Credentials submitted securely');
        if (onSubmit) {
          onSubmit(request.requestId);
        }
        onClose();
      } else {
        toast.error(response.error || 'Failed to submit credentials');
      }
    } catch (error) {
      console.error('Credential submission error:', error);
      toast.error('Failed to submit credentials: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle cancel
  const handleCancel = async () => {
    try {
      await api.cancelCredentialRequest(request.requestId);
    } catch (error) {
      console.warn('Failed to cancel credential request:', error);
    }
    onClose();
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            {/* Site Icon */}
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${siteConfig?.color || 'bg-gray-200 dark:bg-gray-700'}`}>
              {siteConfig?.label ? (
                <span className="text-white font-bold text-sm">{siteConfig.label}</span>
              ) : (
                <GlobeAltIcon className="w-5 h-5 text-white" />
              )}
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Sign in to {siteName}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Agent requires authentication
              </p>
            </div>
          </div>

          <button
            onClick={handleCancel}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <XMarkIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Security Notice */}
        <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800">
          <div className="flex items-start space-x-2">
            <ShieldCheckIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 dark:text-blue-200">
              Your credentials are securely encrypted and stored locally.
              The AI agent never sees your actual password.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Username/Email Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {request?.fields?.includes('email') ? 'Email' : 'Username'}
            </label>
            <input
              ref={usernameRef}
              type={request?.fields?.includes('email') ? 'email' : 'text'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={request?.fields?.includes('email') ? 'you@example.com' : 'username'}
              className="input-primary w-full"
              autoComplete="username"
              data-clarity-mask="always"
              required
            />
          </div>

          {/* Password Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-primary pr-10 w-full"
                autoComplete="current-password"
                data-clarity-mask="always"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showPassword ? (
                  <EyeSlashIcon className="w-4 h-4 text-gray-400" />
                ) : (
                  <EyeIcon className="w-4 h-4 text-gray-400" />
                )}
              </button>
            </div>
          </div>

          {/* Save to Vault Checkbox */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="saveToVault"
              checked={saveToVault}
              onChange={(e) => setSaveToVault(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-loxia-600 focus:ring-loxia-500"
            />
            <label htmlFor="saveToVault" className="text-sm text-gray-600 dark:text-gray-400">
              Save credentials for future logins
            </label>
          </div>

          {/* Timeout Warning */}
          {timeRemaining && timeRemaining < 60000 && (
            <div className="flex items-center space-x-2 text-amber-600 dark:text-amber-400">
              <ExclamationTriangleIcon className="w-4 h-4" />
              <span className="text-xs">
                Request expires in {formatTime(timeRemaining)}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !username.trim() || !password.trim()}
              className="flex-1 px-4 py-2 bg-loxia-600 hover:bg-loxia-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <KeyIcon className="w-4 h-4" />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {request?.agentName ? (
              <>Requested by <span className="font-medium">{request.agentName}</span></>
            ) : (
              'Requested by agent'
            )}
            {request?.loginUrl && (
              <> for <a href={request.loginUrl} target="_blank" rel="noopener noreferrer" className="text-loxia-600 hover:underline">{new URL(request.loginUrl).hostname}</a></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default CredentialRequestModal;
