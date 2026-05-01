# File Explorer Integration Guide

## How to Embed in Another Vite Application

### 1. Install the File Explorer

```bash
# Copy the file-explorer components to your project
cp -r file-explorer/frontend/src/components/FileExplorer.tsx your-project/src/components/
cp -r file-explorer/frontend/src/types your-project/src/types/
cp -r file-explorer/frontend/src/utils your-project/src/utils/
cp -r file-explorer/frontend/src/services your-project/src/services/
```

### 2. Basic Usage

```tsx
import FileExplorer from './components/FileExplorer';
import { FileItem } from './types';

function YourApp() {
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<FileItem | null>(null);

  const handleFileSelect = (path: string, item: FileItem) => {
    console.log('User selected:', path);
    setSelectedPath(path);
    setSelectedItem(item);

    // Do something with the selected file
    if (item.type === 'file') {
      // Process the file
      processFile(path);
    }
  };

  const handleNavigate = (path: string) => {
    console.log('Navigated to directory:', path);
    // Track current directory if needed
  };

  return (
    <div>
      <FileExplorer
        onSelect={handleFileSelect}
        onNavigate={handleNavigate}
        initialPath="/starting/directory"  // Optional
        allowMultiSelect={false}
        height="600px"
        showHidden={false}
      />

      {selectedPath && (
        <div>
          <h3>Selected: {selectedPath}</h3>
          <button onClick={() => processFile(selectedPath)}>
            Process Selected File
          </button>
        </div>
      )}
    </div>
  );
}
```

### 3. Advanced Integration with State Management

```tsx
// With Redux or Zustand
import { useStore } from './store';

function FileManager() {
  const { setSelectedFile, setCurrentDirectory } = useStore();

  return (
    <FileExplorer
      onSelect={(path, item) => {
        // Update global state
        setSelectedFile({ path, item });

        // Send to backend API
        api.selectFile(path);
      }}
      onNavigate={(path) => {
        setCurrentDirectory(path);
      }}
    />
  );
}
```

### 4. Getting Selected Files Programmatically

```tsx
function FileExplorerWrapper() {
  const fileExplorerRef = useRef<{ getSelectedItems: () => Set<string> }>();
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  return (
    <>
      <FileExplorer
        ref={fileExplorerRef}
        onSelect={(path, item) => {
          setSelectedPaths(prev => {
            const newSet = new Set(prev);
            newSet.add(path);
            return newSet;
          });
        }}
        allowMultiSelect={true}
      />

      <button onClick={() => {
        // Get all selected paths
        const paths = Array.from(selectedPaths);
        console.log('Selected files:', paths);

        // Send to your application
        processMultipleFiles(paths);
      }}>
        Process Selected Files ({selectedPaths.size})
      </button>
    </>
  );
}
```

### 5. Backend API Integration

If you need to get selected files from the backend:

```javascript
// Add this endpoint to your backend (optional)
app.post('/api/select-file', (req, res) => {
  const { path } = req.body;

  // Store selected file in session or database
  req.session.selectedFile = path;

  res.json({
    success: true,
    data: { selectedPath: path }
  });
});

app.get('/api/selected-file', (req, res) => {
  res.json({
    success: true,
    data: {
      selectedPath: req.session.selectedFile || null
    }
  });
});
```

### 6. Dialog/Modal Integration

```tsx
import { useState } from 'react';
import FileExplorer from './components/FileExplorer';

function FilePickerDialog({ onFileSelected, onClose }) {
  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Select a File</h2>

        <FileExplorer
          onSelect={(path, item) => {
            // Return selected file to parent
            onFileSelected(path, item);
            onClose();
          }}
          height="400px"
        />

        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// Usage
function App() {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  return (
    <>
      <button onClick={() => setShowPicker(true)}>
        Browse Files
      </button>

      {showPicker && (
        <FilePickerDialog
          onFileSelected={(path, item) => {
            setSelectedFile(path);
            console.log('File selected:', path);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {selectedFile && <p>Selected: {selectedFile}</p>}
    </>
  );
}
```

## Available Props

```typescript
interface FileExplorerProps {
  initialPath?: string;           // Starting directory
  onSelect?: (path: string, item: FileItem) => void;  // File selection callback
  onNavigate?: (path: string) => void;  // Directory navigation callback
  allowMultiSelect?: boolean;     // Enable multi-selection
  height?: string;                // Component height
  width?: string;                 // Component width
  className?: string;             // Additional CSS classes
  showHidden?: boolean;           // Show hidden files
}
```

## FileItem Structure

```typescript
interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified: Date;
  extension?: string;
}
```

## Environment Configuration

Create a `.env` file in your project:

```env
VITE_API_URL=http://127.0.0.1:3001/api
```

## Backend Requirements

The file explorer expects these API endpoints:

- `GET /api/health` - Health check
- `GET /api/cwd` - Get current working directory
- `GET /api/browse?path=xxx` - Browse directory contents

Make sure your backend server is running on port 3001 or update the VITE_API_URL accordingly.