# Modern File Explorer

A fully functional, modern-designed file explorer built with Vite, React, and Express. Designed to be embeddable in other Vite systems for browsing and selecting files on the local computer.

## Features

- 🗂️ **Modern UI**: Clean, responsive design with Tailwind CSS
- 📁 **Full Navigation**: Browse directories, go back/forward, navigate up
- 🎯 **File Selection**: Single and multi-select support (Ctrl+click)
- 🔍 **File Information**: Display file sizes, dates, and types
- 🎨 **File Icons**: Visual file type indicators
- 📱 **Responsive**: Works on desktop and mobile
- 🔌 **Embeddable**: Easy to integrate into other React/Vite projects
- 🛡️ **Secure**: Cross-platform backend using only Node.js APIs
- ⚡ **Fast**: Built with Vite for optimal performance

## Project Structure

```
file-explorer/
├── backend/           # Express.js server
│   ├── src/
│   │   └── server.ts  # Main server file
│   ├── package.json
│   └── tsconfig.json
└── frontend/          # React frontend
    ├── src/
    │   ├── components/
    │   │   └── FileExplorer.tsx
    │   ├── services/
    │   │   └── api.ts
    │   ├── types/
    │   │   └── index.ts
    │   ├── utils/
    │   │   └── fileUtils.ts
    │   └── index.ts   # Main export for embedding
    ├── package.json
    └── vite.config.ts
```

## Quick Start

### 1. Start the Backend

```bash
cd backend
npm install
npm run dev
```

The server will start on `http://localhost:3001`

### 2. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend will start on `http://localhost:5173`

## API Endpoints

The backend provides the following REST API endpoints:

- `GET /api/browse?path=/some/path` - List directory contents
- `GET /api/file-info?path=/some/file` - Get file information
- `GET /api/cwd` - Get current working directory
- `GET /api/health` - Health check

## Using as an Embeddable Component

### Installation

```bash
# Install the component in your Vite project
npm install @loxia/file-explorer
```

### Basic Usage

```tsx
import React from 'react';
import { FileExplorer } from '@loxia/file-explorer';
import '@loxia/file-explorer/css';

function MyApp() {
  const handleFileSelect = (path: string, item: FileItem) => {
    console.log('Selected:', path, item);
  };

  const handleNavigate = (path: string) => {
    console.log('Navigated to:', path);
  };

  return (
    <div>
      <FileExplorer
        onSelect={handleFileSelect}
        onNavigate={handleNavigate}
        allowMultiSelect={true}
        height="500px"
        width="100%"
        showHidden={false}
      />
    </div>
  );
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialPath` | `string` | `''` | Initial directory path to load |
| `onSelect` | `(path: string, item: FileItem) => void` | - | Called when a file is selected |
| `onNavigate` | `(path: string) => void` | - | Called when navigation occurs |
| `allowMultiSelect` | `boolean` | `false` | Enable multi-selection with Ctrl+click |
| `height` | `string` | `'500px'` | Height of the file explorer |
| `width` | `string` | `'100%'` | Width of the file explorer |
| `className` | `string` | `''` | Additional CSS classes |
| `showHidden` | `boolean` | `false` | Show hidden files (starting with .) |

### Environment Variables

Create a `.env` file in your frontend project:

```
VITE_API_URL=http://localhost:3001/api
```

## Development

### Building for Production

```bash
# Build the backend
cd backend
npm run build

# Build the frontend
cd frontend
npm run build

# Or build as a library for embedding
npm run build:lib
```

### Running Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## Security

- The backend uses only Node.js file system APIs for cross-platform compatibility
- Path traversal attacks are prevented with proper path validation
- No OS-specific commands are executed
- File access is restricted to safe operations (read-only browsing)

## Browser Support

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Troubleshooting

### Common Issues

1. **Backend not starting**: Ensure Node.js 16+ is installed
2. **Files not loading**: Check that the backend is running on the correct port
3. **Permission errors**: Ensure the process has read access to the directories you're browsing
4. **CORS errors**: The backend includes CORS headers for development

### Support

For issues and questions, please create an issue in the repository.