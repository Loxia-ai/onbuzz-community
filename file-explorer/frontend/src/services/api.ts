import { ApiResponse, BrowseResponse, FileItem } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const fullUrl = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      ...options,
    });

    if (!response.ok) {
      throw new ApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    const data: ApiResponse<T> = await response.json();

    if (!data.success) {
      throw new ApiError(data.error || 'Unknown API error');
    }

    return data.data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error'
    );
  }
}

export const fileApi = {
  async browse(path?: string): Promise<BrowseResponse> {
    const searchParams = new URLSearchParams();
    if (path) {
      searchParams.append('path', path);
    }

    return fetchApi<BrowseResponse>(`/browse?${searchParams.toString()}`);
  },

  async getFileInfo(path: string): Promise<FileItem> {
    const searchParams = new URLSearchParams();
    searchParams.append('path', path);

    return fetchApi<FileItem>(`/file-info?${searchParams.toString()}`);
  },

  async getCurrentWorkingDirectory(): Promise<{
    cwd: string;
    platform: string;
    homedir: string;
  }> {
    return fetchApi<{
      cwd: string;
      platform: string;
      homedir: string;
    }>('/cwd');
  },

  async healthCheck(): Promise<{
    status: string;
    timestamp: string;
  }> {
    return fetchApi<{
      status: string;
      timestamp: string;
    }>('/health');
  }
};

export { ApiError };