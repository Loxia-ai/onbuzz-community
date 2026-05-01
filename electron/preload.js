/**
 * Electron Preload Script
 * Minimal — only exposes platform info to the renderer.
 * No Node.js APIs are exposed (the web UI communicates via HTTP/WS).
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true
});
