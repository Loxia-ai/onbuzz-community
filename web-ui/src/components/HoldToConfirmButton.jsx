/**
 * HoldToConfirmButton Component
 *
 * A button that requires the user to hold it for a duration to confirm
 * a destructive action. Shows a growing fill animation while holding.
 */

import React, { useState, useRef, useCallback } from 'react';

const HOLD_DURATION_MS = 1500; // Time to hold for confirmation

function HoldToConfirmButton({
  onConfirm,
  children,
  className = '',
  holdDuration = HOLD_DURATION_MS,
  disabled = false,
  title = 'Hold to confirm'
}) {
  const [isHolding, setIsHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdStartRef = useRef(null);
  const animationFrameRef = useRef(null);
  const confirmedRef = useRef(false);

  const updateProgress = useCallback(() => {
    if (!holdStartRef.current || confirmedRef.current) return;

    const elapsed = Date.now() - holdStartRef.current;
    const newProgress = Math.min((elapsed / holdDuration) * 100, 100);
    setProgress(newProgress);

    if (newProgress >= 100) {
      // Confirmed!
      confirmedRef.current = true;
      setIsHolding(false);
      setProgress(0);
      onConfirm?.();
    } else {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
  }, [holdDuration, onConfirm]);

  const startHold = useCallback((e) => {
    if (disabled) return;
    e.preventDefault();

    confirmedRef.current = false;
    holdStartRef.current = Date.now();
    setIsHolding(true);
    setProgress(0);
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  }, [disabled, updateProgress]);

  const endHold = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    holdStartRef.current = null;
    setIsHolding(false);
    setProgress(0);
  }, []);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={endHold}
      onMouseLeave={endHold}
      onTouchStart={startHold}
      onTouchEnd={endHold}
      onTouchCancel={endHold}
      disabled={disabled}
      title={title}
      className={`relative overflow-hidden select-none ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {/* Progress fill */}
      <div
        className="absolute inset-0 bg-red-500/30 dark:bg-red-400/30 transition-none"
        style={{
          width: `${progress}%`,
          transition: isHolding ? 'none' : 'width 0.2s ease-out'
        }}
      />

      {/* Button content */}
      <span className="relative z-10 flex items-center justify-center">
        {children}
      </span>

      {/* Holding indicator ring */}
      {isHolding && (
        <span className="absolute inset-0 border-2 border-red-500 dark:border-red-400 rounded animate-pulse pointer-events-none" />
      )}
    </button>
  );
}

export default HoldToConfirmButton;
