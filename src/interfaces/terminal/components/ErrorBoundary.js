/**
 * ErrorBoundary Component
 * Catches and displays errors from child components
 */

import React from 'react';
import { Box, Text } from 'ink';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // Log to console for debugging
    console.error('ErrorBoundary caught error:', error);
    console.error('Component stack:', errorInfo?.componentStack);

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          reset: this.handleReset,
        });
      }

      // Default error UI
      return React.createElement(
        Box,
        {
          borderStyle: 'round',
          borderColor: 'red',
          paddingX: 1,
          paddingY: 1,
          flexDirection: 'column',
        },
        React.createElement(Text, { bold: true, color: 'red' }, '⚠ Component Error'),
        React.createElement(Text, { color: 'yellow' }, `\n${this.state.error?.message || 'Unknown error'}`),
        React.createElement(
          Text,
          { dimColor: true },
          '\n\nThe component crashed but the app is still running.'
        ),
        this.props.showStack &&
          React.createElement(
            Text,
            { dimColor: true },
            `\n\nStack: ${this.state.error?.stack?.split('\n').slice(0, 3).join('\n')}`
          )
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
