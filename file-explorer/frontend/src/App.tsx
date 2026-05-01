import React, { useState } from 'react';
import FileExplorer from './components/FileExplorer';
import { FileItem } from './types';

function App() {
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [showHelp, setShowHelp] = useState<boolean>(false);

  const handleSelect = (path: string, item: FileItem) => {
    setSelectedFile(item);
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto relative">
        {/* Help icon in top-right corner */}
        <div className="absolute top-0 right-0 z-20">
          <div className="relative">
            <button
              className="w-8 h-8 rounded-full bg-muted hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              onMouseEnter={() => setShowHelp(true)}
              onMouseLeave={() => setShowHelp(false)}
              aria-label="Help"
            >
              ?
            </button>

            {showHelp && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50">
                <h3 className="font-semibold text-gray-900 mb-2">
                  How to use
                </h3>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Click folders to navigate</li>
                  <li>• Double-click to open</li>
                  <li>• Ctrl+click for multi-select</li>
                  <li>• Use ←→↑ buttons for navigation</li>
                  <li>• Path bar shows current location</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main File Explorer */}
          <div className="lg:col-span-2">
            <FileExplorer
              onSelect={handleSelect}
              onNavigate={handleNavigate}
              allowMultiSelect={true}
              height="600px"
              showHidden={false}
            />
          </div>

          {/* Info Panel */}
          <div className="space-y-4">
            {selectedFile && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="font-semibold text-card-foreground mb-2">
                  Selected File
                </h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Name:</span>{' '}
                    <span className="text-muted-foreground">{selectedFile.name}</span>
                  </div>
                  <div>
                    <span className="font-medium">Type:</span>{' '}
                    <span className="text-muted-foreground">{selectedFile.type}</span>
                  </div>
                  {selectedFile.size && (
                    <div>
                      <span className="font-medium">Size:</span>{' '}
                      <span className="text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(2)} KB
                      </span>
                    </div>
                  )}
                  {selectedFile.extension && (
                    <div>
                      <span className="font-medium">Extension:</span>{' '}
                      <span className="text-muted-foreground">{selectedFile.extension}</span>
                    </div>
                  )}
                  <div>
                    <span className="font-medium">Path:</span>{' '}
                    <span className="text-muted-foreground break-all">{selectedFile.path}</span>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

export default App
