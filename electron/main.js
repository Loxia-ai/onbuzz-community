/**
 * Loxia Electron Main Process
 *
 * Boots the existing LoxiaApplication backend and wraps it in a native window.
 * The web UI loads from the backend's Express static server (same as browser mode).
 * CLI usage is unaffected — this file is only used when launched via Electron.
 *
 * Brand support:
 *   LOXIA_BRAND=autopilot  electron electron/main.js   → "Loxia Autopilot" branding
 *   LOXIA_BRAND=onbuzz     electron electron/main.js   → "Loxia OnBuzz" branding
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Catch crashes that would silently kill the app
process.on('uncaughtException', (error) => {
  console.error('[Electron] Uncaught exception:', error);
  try {
    const { dialog } = require('electron');
    dialog.showErrorBox('Loxia - Crash', `${error.message}\n\n${error.stack}`);
  } catch {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[Electron] Unhandled rejection:', reason);
});

// Signal to backend: skip auto-opening the browser
process.env.LOXIA_ELECTRON = '1';
// Forward brand to web UI if not already set
if (!process.env.VITE_BRAND && process.env.LOXIA_BRAND) {
  process.env.VITE_BRAND = process.env.LOXIA_BRAND;
}

// --- Brand Configuration ---
const BRANDS = {
  autopilot: {
    appName: 'Loxia Autopilot',
    trayTooltip: 'Loxia Autopilot',
    icon: 'icon.png' // default — copied from web-ui logo
  },
  onbuzz: {
    appName: 'Loxia OnBuzz',
    trayTooltip: 'Loxia OnBuzz',
    icon: 'icon.png'
  }
};
const brandId = process.env.LOXIA_BRAND || process.env.VITE_BRAND || 'autopilot';
const activeBrand = BRANDS[brandId] || BRANDS.autopilot;

let mainWindow = null;
let tray = null;
let loxiaApp = null;
let backendPort = null;
let isQuitting = false;

// --- Single Instance Lock ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// --- Backend Boot ---

async function bootBackend() {
  try {
    // Resolve path relative to this file — works in both dev and packaged mode
    const indexPath = path.resolve(__dirname, '..', 'src', 'index.js');
    console.log(`[Electron] Loading backend from: ${indexPath}`);
    const { LoxiaApplication } = await import(`file://${indexPath.replace(/\\/g, '/')}`);
    loxiaApp = new LoxiaApplication();

    const options = {
      projectDir: process.cwd(),
      watchConfig: false,
      configPaths: []
    };

    await loxiaApp.initialize(options);

    // Discover the port the server is running on
    const webInterface = loxiaApp.interfaces?.get?.('web');
    if (webInterface) {
      const status = webInterface.getStatus();
      backendPort = status.port;
    }

    if (!backendPort) {
      backendPort = parseInt(process.env.LOXIA_PORT) || 8080;
    }

    console.log(`[Electron] Backend ready on port ${backendPort}`);
    return backendPort;
  } catch (error) {
    console.error('[Electron] Failed to boot backend:', error.message);
    throw error;
  }
}

// --- Wait for Backend Health ---

async function waitForBackend(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      const data = await response.json();
      if (data.status === 'healthy') {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Backend did not become healthy after ${maxAttempts} attempts`);
}

// --- Window Creation ---

function createWindow(port) {
  const iconPath = path.join(__dirname, 'icon.png');

  // Remove default Electron menu bar
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: activeBrand.appName,
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Suppress CSP warning — our renderer only loads localhost content
      disableBlinkFeatures: 'InsecureContentSecurityPolicy'
    },
    show: false // Show after content loads to avoid flash
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.includes(`localhost:${port}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Hide to tray instead of closing (unless quitting)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- System Tray ---

function createTray(port) {
  const iconPath = path.join(__dirname, 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip(activeBrand.trayTooltip);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: `Open in Browser`,
      click: () => shell.openExternal(`http://localhost:${port}`)
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
  try {
    console.log(`[Electron] Booting ${activeBrand.appName} backend...`);
    const port = await bootBackend();
    console.log(`[Electron] Waiting for backend health on port ${port}...`);
    await waitForBackend(port);
    console.log('[Electron] Backend healthy, creating window...');
    createWindow(port);
    createTray(port);
  } catch (error) {
    console.error('[Electron] Startup failed:', error.message, error.stack);
    // Show error dialog so the user sees what happened
    const { dialog } = await import('electron');
    dialog.showErrorBox(
      `${activeBrand.appName} - Startup Error`,
      `Failed to start:\n\n${error.message}\n\nCheck the console for details.`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until Cmd+Q
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon clicked
  if (mainWindow === null && backendPort) {
    createWindow(backendPort);
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (loxiaApp?.shutdown) {
    try {
      await loxiaApp.shutdown();
    } catch (err) {
      console.error('[Electron] Shutdown error:', err.message);
    }
  }
});
