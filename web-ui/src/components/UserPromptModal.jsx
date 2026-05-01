import React, { useState, useEffect, useRef } from 'react';
import {
  QuestionMarkCircleIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline';
import { api } from '../services/api.js';
import toast from 'react-hot-toast';

/**
 * UserPromptModal - Interactive question modal for agent-user communication
 *
 * Shown when an agent needs user input during task execution.
 * Supports multiple questions, options, free text, and web search suggestions.
 */
function UserPromptModal({ request, onClose, onSubmit }) {
  // State for each question's answer
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);

  const firstInputRef = useRef(null);

  // Initialize answers state from questions
  useEffect(() => {
    if (request?.questions) {
      const initialAnswers = {};
      request.questions.forEach(q => {
        initialAnswers[q.id] = {
          selectedOptions: [],
          freeText: '',
          webSearchRequested: false
        };
      });
      setAnswers(initialAnswers);
    }
  }, [request?.questions]);

  // Focus first input on mount
  useEffect(() => {
    if (firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, []);

  // Countdown timer for request timeout
  useEffect(() => {
    if (!request?.timeoutAt) return;

    const updateRemaining = () => {
      const now = Date.now();
      const timeout = new Date(request.timeoutAt).getTime();
      const remaining = Math.max(0, timeout - now);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        toast.error('Prompt request timed out');
        onClose();
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [request?.timeoutAt, onClose]);

  // Format remaining time
  const formatTime = (ms) => {
    if (!ms) return '';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle option selection
  const handleOptionSelect = (questionId, optionId, multiSelect) => {
    setAnswers(prev => {
      const current = prev[questionId] || { selectedOptions: [], freeText: '', webSearchRequested: false };
      let newSelected;

      if (multiSelect) {
        // Toggle selection for multi-select
        if (current.selectedOptions.includes(optionId)) {
          newSelected = current.selectedOptions.filter(id => id !== optionId);
        } else {
          newSelected = [...current.selectedOptions, optionId];
        }
      } else {
        // Single select - replace
        newSelected = [optionId];
      }

      return {
        ...prev,
        [questionId]: {
          ...current,
          selectedOptions: newSelected
        }
      };
    });
  };

  // Handle free text input
  const handleFreeTextChange = (questionId, text) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        freeText: text
      }
    }));
  };

  // Handle web search suggestion click
  const handleWebSearchClick = (questionId) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        webSearchRequested: !prev[questionId]?.webSearchRequested
      }
    }));
    toast('Web search suggestion noted for this question', { icon: '🔍' });
  };

  // Validate answers
  const validateAnswers = () => {
    for (const question of request?.questions || []) {
      const answer = answers[question.id];
      if (question.required !== false) {
        if ((!answer?.selectedOptions?.length) && (!answer?.freeText?.trim())) {
          return { valid: false, error: `Please answer: ${question.message}` };
        }
      }
    }
    return { valid: true };
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    const validation = validateAnswers();
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    setIsSubmitting(true);

    try {
      // Format answers for submission
      const formattedAnswers = Object.entries(answers).map(([questionId, answer]) => ({
        questionId,
        selectedOptions: answer.selectedOptions,
        freeText: answer.freeText?.trim() || null,
        webSearchRequested: answer.webSearchRequested
      }));

      const response = await api.submitPromptResponse({
        requestId: request.requestId,
        answers: formattedAnswers
      });

      if (response.success) {
        toast.success('Response submitted');
        onSubmit?.(formattedAnswers);
        onClose();
      } else {
        toast.error(response.error || 'Failed to submit response');
      }
    } catch (error) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle extend timer (+2 min)
  const handleExtendTimer = async () => {
    try {
      const result = await api.extendPromptTimeout(request.requestId, 120000);
      if (result.success && result.newTimeoutAt) {
        request.timeoutAt = result.newTimeoutAt;
        const now = Date.now();
        const timeout = new Date(result.newTimeoutAt).getTime();
        setTimeRemaining(Math.max(0, timeout - now));
        toast.success('Timer extended by 2 minutes');
      }
    } catch (error) {
      toast.error(`Failed to extend timer: ${error.message}`);
    }
  };

  // Handle stop timer
  const handleStopTimer = async () => {
    try {
      const result = await api.clearPromptTimeout(request.requestId);
      if (result.success) {
        setTimeRemaining(null);
        toast.success('Timer stopped');
      }
    } catch (error) {
      toast.error(`Failed to stop timer: ${error.message}`);
    }
  };

  // Handle cancel
  const handleCancel = async () => {
    try {
      await api.cancelPromptRequest(request.requestId);
      toast('Prompt cancelled');
    } catch (error) {
      // Ignore errors on cancel
    }
    onClose();
  };

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Agent Question
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {request.agentName || 'Agent'} needs your input
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {timeRemaining !== null && (
              <div className="flex items-center gap-2">
                <span className={`text-sm font-mono ${timeRemaining < 60000 ? 'text-red-500' : 'text-amber-500'}`}>
                  {formatTime(timeRemaining)}
                </span>
                <button
                  onClick={handleExtendTimer}
                  className="text-xs text-gray-400 hover:text-loxia-500 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="Add 2 minutes"
                >
                  +2m
                </button>
                <button
                  onClick={handleStopTimer}
                  className="text-xs text-gray-400 hover:text-red-500 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="Stop countdown"
                >
                  Stop
                </button>
              </div>
            )}
            <button
              onClick={handleCancel}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Context message */}
          {request.message && (
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                {request.message}
              </p>
            </div>
          )}

          {/* Questions */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {(request.questions || []).map((question, index) => (
              <div key={question.id} className="space-y-3">
                {/* Question header */}
                <div className="flex items-start justify-between gap-2">
                  <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-bold mr-2">
                      {index + 1}
                    </span>
                    {question.message}
                    {question.required !== false && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                  </label>

                  {/* Web search suggestion icon */}
                  {question.allowWebSearch !== false && (
                    <button
                      type="button"
                      onClick={() => handleWebSearchClick(question.id)}
                      className={`p-1.5 rounded-md transition-colors ${
                        answers[question.id]?.webSearchRequested
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      title="Suggest agent to search web for this question"
                    >
                      <MagnifyingGlassIcon className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {/* Options */}
                {question.options && question.options.length > 0 && (
                  <div className="space-y-2">
                    {question.options.map((option) => {
                      const optionId = option.id || option;
                      const optionLabel = option.label || option;
                      const optionDesc = option.description;
                      const isSelected = answers[question.id]?.selectedOptions?.includes(optionId);

                      return (
                        <button
                          key={optionId}
                          type="button"
                          onClick={() => handleOptionSelect(question.id, optionId, question.multiSelect)}
                          className={`w-full flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        >
                          <div className={`flex-shrink-0 w-5 h-5 rounded-${question.multiSelect ? 'md' : 'full'} border-2 flex items-center justify-center ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500'
                              : 'border-gray-300 dark:border-gray-500'
                          }`}>
                            {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              {optionLabel}
                            </div>
                            {optionDesc && (
                              <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                {optionDesc}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Free text input */}
                {question.allowFreeText !== false && (
                  <div className="mt-3">
                    <textarea
                      ref={index === 0 ? firstInputRef : null}
                      placeholder="Or type your response..."
                      value={answers[question.id]?.freeText || ''}
                      onChange={(e) => handleFreeTextChange(question.id, e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      rows={2}
                    />
                  </div>
                )}
              </div>
            ))}
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {request.questions?.length === 1 ? '1 question' : `${request.questions?.length} questions`}
            {' • '}Click web icon to suggest agent research
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Submitting...
                </>
              ) : (
                'Submit Response'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UserPromptModal;
