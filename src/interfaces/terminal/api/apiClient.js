/**
 * API Client
 * Unified HTTP request mechanism for all backend communication
 * Handles authentication, headers, and error handling consistently
 */

import { ERROR_MESSAGE } from '../config/constants.js';

/**
 * API Client Class
 * Centralized HTTP client with automatic authentication
 */
export class ApiClient {
  constructor(baseUrl, apiKey = null) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /**
   * Set or update the API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Get the current API key
   */
  getApiKey() {
    return this.apiKey;
  }

  /**
   * Clear the API key
   */
  clearApiKey() {
    this.apiKey = null;
  }

  /**
   * Build request headers
   * Automatically includes Authorization header if API key is set
   */
  buildHeaders(additionalHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...additionalHeaders,
    };

    // Add Authorization header if API key is available
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Make HTTP request
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param {string} endpoint - API endpoint path
   * @param {object} options - Request options
   * @param {object} options.body - Request body (for POST, PUT, PATCH)
   * @param {object} options.headers - Additional headers
   * @param {object} options.query - Query parameters
   * @returns {Promise<object>} Response data
   */
  async request(method, endpoint, options = {}) {
    const { body = null, headers = {}, query = null } = options;

    // Build URL with query parameters
    let url = `${this.baseUrl}${endpoint}`;
    if (query) {
      const queryString = new URLSearchParams(query).toString();
      url += `?${queryString}`;
    }

    // Build request options
    const requestOptions = {
      method,
      headers: this.buildHeaders(headers),
    };

    // Add body for POST, PUT, PATCH
    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      requestOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, requestOptions);

      // Parse JSON response
      const data = await response.json().catch(() => ({}));

      // Check if response is OK
      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.response = data;
        throw error;
      }

      return data;
    } catch (error) {
      // Network errors
      if (error.message.includes('fetch') || error.name === 'TypeError') {
        const networkError = new Error(`${ERROR_MESSAGE.NETWORK_ERROR}: ${error.message}`);
        networkError.originalError = error;
        throw networkError;
      }
      // Re-throw API errors
      throw error;
    }
  }

  /**
   * GET request
   */
  async get(endpoint, options = {}) {
    return this.request('GET', endpoint, options);
  }

  /**
   * POST request
   */
  async post(endpoint, body = null, options = {}) {
    return this.request('POST', endpoint, { ...options, body });
  }

  /**
   * PUT request
   */
  async put(endpoint, body = null, options = {}) {
    return this.request('PUT', endpoint, { ...options, body });
  }

  /**
   * PATCH request
   */
  async patch(endpoint, body = null, options = {}) {
    return this.request('PATCH', endpoint, { ...options, body });
  }

  /**
   * DELETE request
   */
  async delete(endpoint, options = {}) {
    return this.request('DELETE', endpoint, options);
  }

  /**
   * Make streaming HTTP request (Server-Sent Events)
   * @param {string} endpoint - API endpoint path
   * @param {object} body - Request body
   * @param {object} options - Request options
   * @param {function} options.onChunk - Callback for each text chunk
   * @param {function} options.onDone - Callback when stream completes
   * @param {function} options.onError - Callback for errors
   * @returns {Promise<object>} Final response data
   */
  async streamRequest(endpoint, body = {}, options = {}) {
    const { onChunk, onDone, onError, headers = {} } = options;

    let url = `${this.baseUrl}${endpoint}`;

    const requestOptions = {
      method: 'POST',
      headers: {
        ...this.buildHeaders(headers),
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ ...body, stream: true })
    };

    try {
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`HTTP ${response.status}: ${errorText}`);
        error.status = response.status;
        if (onError) onError(error);
        throw error;
      }

      // Check if we actually got a stream
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        // Not a stream, parse as regular JSON
        const data = await response.json();
        if (onChunk && data.content) {
          onChunk(data.content);
        }
        if (onDone) onDone(data);
        return data;
      }

      // Validate response body before reading stream
      if (!response.body) {
        const textContent = await response.text().catch(() => '');
        if (onChunk && textContent) onChunk(textContent);
        const fallbackResult = { content: textContent, model: body?.model, finishReason: 'stop' };
        if (onDone) onDone(fallbackResult);
        return fallbackResult;
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let finalData = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'chunk' && parsed.content) {
                fullContent += parsed.content;
                if (onChunk) {
                  onChunk(parsed.content);
                }
              } else if (parsed.type === 'done') {
                finalData = {
                  content: parsed.content || fullContent,
                  usage: parsed.usage,
                  model: parsed.model,
                  finishReason: parsed.finishReason
                };
              } else if (parsed.type === 'error') {
                const error = new Error(parsed.error);
                error.code = parsed.code;
                if (onError) onError(error);
                throw error;
              }
            } catch (parseError) {
              // Skip unparseable lines, but don't throw
              if (parseError.message && !parseError.code) {
                // Only skip JSON parse errors, not our custom errors
                continue;
              }
              throw parseError;
            }
          }
        }
      }

      // Final callback with complete data
      if (onDone) {
        onDone(finalData || { content: fullContent });
      }

      return finalData || { content: fullContent };

    } catch (error) {
      if (error.message.includes('fetch') || error.name === 'TypeError') {
        const networkError = new Error(`${ERROR_MESSAGE.NETWORK_ERROR}: ${error.message}`);
        networkError.originalError = error;
        if (onError) onError(networkError);
        throw networkError;
      }
      throw error;
    }
  }

  /**
   * POST request with streaming response
   * Convenience method for streaming chat completions
   */
  async postStream(endpoint, body = null, options = {}) {
    return this.streamRequest(endpoint, body, options);
  }
}

/**
 * Create an API client instance
 */
export function createApiClient(host = 'localhost', port = 8080, apiKey = null) {
  const baseUrl = `http://${host}:${port}`;
  return new ApiClient(baseUrl, apiKey);
}

export default ApiClient;
