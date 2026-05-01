export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: Date;
  extension?: string;
}

export interface BrowseResponse {
  currentPath: string;
  parentPath: string;
  items: FileItem[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface FileExplorerProps {
  initialPath?: string;
  onSelect?: (path: string, item: FileItem) => void;
  onNavigate?: (path: string) => void;
  allowMultiSelect?: boolean;
  height?: string;
  width?: string;
  className?: string;
  showHidden?: boolean;
}

export interface FileExplorerState {
  currentPath: string;
  items: FileItem[];
  selectedItems: Set<string>;
  loading: boolean;
  error: string | null;
  history: string[];
  historyIndex: number;
}