/**
 * LoadingSpinner Component
 * Displays an animated spinner for loading states
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOTS_FRAMES = ['.  ', '.. ', '...', '   '];
const BAR_FRAMES = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'];

/**
 * LoadingSpinner Component
 * @param {Object} props
 * @param {string} props.label - Label text to display
 * @param {string} props.type - Spinner type: 'spinner', 'dots', 'bar'
 * @param {string} props.color - Text color
 * @param {number} props.interval - Animation interval in ms
 */
export function LoadingSpinner({
  label = 'Loading',
  type = 'spinner',
  color = 'cyan',
  interval = 80,
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => {
        const frames = type === 'spinner' ? SPINNER_FRAMES : type === 'bar' ? BAR_FRAMES : DOTS_FRAMES;
        return (prev + 1) % frames.length;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [type, interval]);

  const frames = type === 'spinner' ? SPINNER_FRAMES : type === 'bar' ? BAR_FRAMES : DOTS_FRAMES;
  const currentFrame = frames[frame];

  return React.createElement(
    Box,
    {},
    React.createElement(Text, { color }, currentFrame + ' ' + label)
  );
}

/**
 * Inline loading indicator (no box wrapper)
 */
export function InlineSpinner({ type = 'spinner', color = 'cyan' }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => {
        const frames = type === 'spinner' ? SPINNER_FRAMES : type === 'bar' ? BAR_FRAMES : DOTS_FRAMES;
        return (prev + 1) % frames.length;
      });
    }, 80);

    return () => clearInterval(timer);
  }, [type]);

  const frames = type === 'spinner' ? SPINNER_FRAMES : type === 'bar' ? BAR_FRAMES : DOTS_FRAMES;
  return React.createElement(Text, { color }, frames[frame]);
}

export default LoadingSpinner;
