'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// ── Embedded server ────────────────────────────────────────────────────────
// Import the server module (does NOT auto-listen when required — only when
// run directly via `node server/index.js`).
const { startServer } = require('../server/index.js');

const SERVER_PORT = parseInt(process.env.PORT ?? '3001', 10);
const SERVE_URL   = `http://localhost:${SERVER_PORT}`;

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  900,
    minHeight: 600,
    title: 'STM32 UCPD Monitor',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0d1117',
    show: false,
  });

  win.loadURL(SERVE_URL);
  win.once('ready-to-show', () => win.show());

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

// ── App lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await startServer(SERVER_PORT);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
