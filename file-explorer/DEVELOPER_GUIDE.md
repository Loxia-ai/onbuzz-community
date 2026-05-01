# File Explorer Component - Complete Developer Guide

## 🎯 Overview

A modern, embeddable file explorer component built with React, TypeScript, and Tailwind CSS. Designed for seamless integration into any Vite-based application for browsing and selecting files/directories on the local system.

## 📁 Project Structure

```
file-explorer/
├── backend/                    # Express.js backend server
│   ├── test-server.js         # Main server file (production-ready)
│   ├── package.json
│   └── node_modules/
├── frontend/                   # React/Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   └── FileExplorer.tsx    # Main component
│   │   ├── services/
│   │   │   └── api.ts              # API service layer
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript definitions
│   │   ├── utils/
│   │   │   └── fileUtils.ts        # File utilities & helpers
│   │   ├── App.tsx                 # Demo application
│   │   ├── index.css               # Main styles & Tailwind config
│   │   └── App.css                 # App-specific styles
│   ├── .env                        # Environment variables
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
├── INTEGRATION.md              # Integration guide
└── DEVELOPER_GUIDE.md         # This file

```

## 🎨 CSS & Styling Architecture

### Where Styles Live

1. **`frontend/src/index.css`** - Main stylesheet containing:
   - Tailwind CSS imports (`@tailwind base/components/utilities`)
   - CSS custom properties (CSS variables) for theming
   - Light/Dark mode color schemes
   - Base component styles

2. **Tailwind CSS Classes** - Used inline throughout components:
   - Utility-first approach for rapid styling
   - Responsive design with breakpoint prefixes
   - Theme-aware classes using CSS variables

3. **Theme Variables** (in `index.css`):
   ```css
   --background: Background color
   --foreground: Text color
   --primary: Primary accent color
   --border: Border colors
   --accent: Hover states
   --destructive: Error states
   --muted: Disabled/secondary elements
   ```

### Customizing Colors & Design

To change the color scheme, edit the CSS variables in `frontend/src/index.css`:

```css
:root {
  --primary: 221.2 83.2% 53.3%;        /* Change primary color */
  --background: 0 0% 100%;             /* Change background */
  --accent: 210 40% 96%;                /* Change hover color */
}
```

## 🚀 Quick Start

### 1. Backend Setup
```bash
cd backend
npm install
node test-server.js
# Server runs on http://127.0.0.1:3001
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
# App runs on http://localhost:5174
```

### 3. Environment Configuration
```bash
# frontend/.env
VITE_API_URL=http://127.0.0.1:3001/api
```

## 📦 Component API

### FileExplorer Props

```typescript
interface FileExplorerProps {
  initialPath?: string;           // Starting directory (optional)
  onSelect?: (path: string, item: FileItem) => void;  // Selection callback
  onNavigate?: (path: string) => void;  // Navigation callback
  allowMultiSelect?: boolean;     // Enable multi-selection
  height?: string;                // Component height (default: "500px")
  width?: string;                 // Component width (default: "100%")
  className?: string;             // Additional CSS classes
  showHidden?: boolean;           // Show hidden files (default: false)
}
```

### FileItem Type

```typescript
interface FileItem {
  name: string;                  // File/folder name
  path: string;                  // Full path
  type: 'file' | 'directory';   // Item type
  size?: number;                 // File size in bytes
  lastModified: Date;            // Last modified date
  extension?: string;            // File extension (e.g., ".pdf")
}
```

## 🔌 Backend API Endpoints

### GET `/api/health`
Health check endpoint
- Response: `{ success: true, data: { status: "healthy", timestamp: "..." } }`

### GET `/api/cwd`
Get current working directory
- Response: `{ success: true, data: { cwd: "/path", platform: "linux", homedir: "/home/user" } }`

### GET `/api/browse?path=/some/path`
Browse directory contents
- Query params: `path` (optional, defaults to CWD)
- Response:
```json
{
  "success": true,
  "data": {
    "currentPath": "/current/path",
    "parentPath": "/parent",
    "items": [
      {
        "name": "file.txt",
        "path": "/current/path/file.txt",
        "type": "file",
        "size": 1024,
        "lastModified": "2024-01-01T00:00:00Z",
        "extension": ".txt"
      }
    ]
  }
}
```

## 🔧 Integration Examples

### Basic Integration

```tsx
import FileExplorer from './components/FileExplorer';

function MyApp() {
  const handleFileSelect = (path: string, item: FileItem) => {
    console.log('Selected:', path);
    // Process the selected file
  };

  return (
    <FileExplorer
      onSelect={handleFileSelect}
      height="600px"
    />
  );
}
```

### Advanced Integration with State

```tsx
function FileManager() {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [currentPath, setCurrentPath] = useState('');

  return (
    <>
      <FileExplorer
        onSelect={(path, item) => {
          setSelectedFiles(prev => {
            const newSet = new Set(prev);
            newSet.add(path);
            return newSet;
          });
        }}
        onNavigate={setCurrentPath}
        allowMultiSelect={true}
      />

      <div>
        Current: {currentPath}
        Selected: {Array.from(selectedFiles).join(', ')}
      </div>
    </>
  );
}
```

### Modal/Dialog Pattern

```tsx
function FilePickerModal({ isOpen, onClose, onSelect }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <FileExplorer
          onSelect={(path, item) => {
            onSelect(path, item);
            onClose();
          }}
          height="400px"
        />
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
```

## 🏗️ Building for Production

### Frontend Build
```bash
cd frontend
npm run build
# Output in frontend/dist/
```

### Backend Production
```bash
cd backend
# Use PM2 or similar for production
npm install -g pm2
pm2 start test-server.js --name file-explorer-api
```

## 🔐 Security Considerations

1. **CORS Configuration**: Currently allows all origins (`origin: true`) in development. For production, specify allowed origins:
```javascript
cors({
  origin: ['https://yourapp.com'],
  credentials: true
})
```

2. **Path Traversal**: The backend validates paths to prevent directory traversal attacks

3. **File Access**: Backend only exposes files readable by the Node.js process

## 🎯 Key Features

- ✅ **Cross-platform**: Works on Windows, macOS, Linux (including WSL)
- ✅ **Real-time callbacks**: Instant selection feedback via props
- ✅ **Navigation history**: Back/Forward/Up navigation
- ✅ **Multi-selection**: Support for selecting multiple files
- ✅ **File icons**: Automatic icons based on file type
- ✅ **Responsive design**: Works on all screen sizes
- ✅ **Dark mode ready**: Theme variables support dark mode
- ✅ **TypeScript**: Full type safety
- ✅ **Production ready**: Clean code, no debug logs

## 🚨 Common Issues & Solutions

### Issue: Browser can't connect to backend
**Solution**: Use `127.0.0.1` instead of `localhost` in the API URL (especially in WSL environments)

### Issue: CORS errors
**Solution**: Ensure backend is running and CORS is properly configured

### Issue: Initial path not loading
**Solution**: The component automatically uses the backend's CWD if no `initialPath` is provided

## 📝 Notes for AI Agents/Developers

### Critical Information:
1. **Component is self-contained**: All necessary files are in the components/ directory
2. **Styling uses Tailwind CSS**: No separate CSS files needed for the component
3. **API URL is configurable**: Set via VITE_API_URL environment variable
4. **Component is stateful**: Maintains its own navigation history and selection state
5. **Backend is required**: The component needs the Express server running

### Integration Checklist:
- [ ] Copy component files (FileExplorer.tsx, types/, utils/, services/)
- [ ] Install dependencies (react, tailwindcss, etc.)
- [ ] Configure API URL in .env
- [ ] Start backend server
- [ ] Import and use component with callbacks
- [ ] Customize theme colors if needed

### Key Callbacks:
- `onSelect(path, item)`: Called when file/folder is selected
- `onNavigate(path)`: Called when navigating directories

### State Management:
- Component maintains internal state for navigation history
- Parent component should manage selected files state
- Use callbacks to sync with parent application state

## 📄 License

MIT - Free to use in any project

---

**Last Updated**: 2025-09-29
**Version**: 1.0.0
**Compatibility**: React 18+, Node.js 16+, Vite 4+