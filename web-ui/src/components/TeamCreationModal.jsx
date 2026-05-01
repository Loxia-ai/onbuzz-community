import React, { useState, useEffect } from 'react';
import {
  XMarkIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';
import LoadingSpinner from './LoadingSpinner.jsx';

// Preset team colors
const TEAM_COLORS = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Green', value: '#10B981' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Yellow', value: '#EAB308' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Cyan', value: '#06B6D4' }
];

/**
 * TeamCreationModal - Modal for creating or editing a team
 *
 * Props:
 * - team: Optional existing team object for editing mode
 * - onClose: Function to close the modal
 * - onSubmit: Function called with team data { name, description, color }
 * - isLoading: Optional loading state
 */
function TeamCreationModal({ team = null, onClose, onSubmit, isLoading = false }) {
  const isEditMode = !!team;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(TEAM_COLORS[0].value);
  const [error, setError] = useState('');

  // Initialize form when editing
  useEffect(() => {
    if (team) {
      setName(team.name || '');
      setDescription(team.description || '');
      setColor(team.color || TEAM_COLORS[0].value);
    }
  }, [team]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Team name is required');
      return;
    }

    if (trimmedName.length < 2) {
      setError('Team name must be at least 2 characters');
      return;
    }

    onSubmit({
      name: trimmedName,
      description: description.trim(),
      color
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <UserGroupIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {isEditMode ? 'Edit Team' : 'Create Team'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Team Name */}
          <div>
            <label htmlFor="teamName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Team Name *
            </label>
            <input
              id="teamName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Backend Squad"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-loxia-500 focus:border-loxia-500
                       placeholder:text-gray-400"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="teamDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              id="teamDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional team description..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-loxia-500 focus:border-loxia-500
                       placeholder:text-gray-400 resize-none"
            />
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team Color
            </label>
            <div className="flex flex-wrap gap-2">
              {TEAM_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`
                    w-8 h-8 rounded-full transition-all
                    ${color === c.value
                      ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 scale-110'
                      : 'hover:scale-110'}
                  `}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Preview</p>
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {name || 'Team Name'}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-loxia-600 hover:bg-loxia-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
              disabled={isLoading || !name.trim()}
            >
              {isLoading ? (
                <>
                  <LoadingSpinner size="xs" />
                  {isEditMode ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                <>
                  <UserGroupIcon className="w-4 h-4" />
                  {isEditMode ? 'Save Changes' : 'Create Team'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TeamCreationModal;
