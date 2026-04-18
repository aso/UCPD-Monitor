// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
'use strict';

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// ── Embedded server ────────────────────────────────────────────────────────
// Import the server module (does NOT auto-listen when required — only when
// run directly via `node server/index.js`).
const { startServer, shutdown } = require('../server/index.js');

const SERVER_PORT = parseInt(process.env.PORT ?? '3001', 10);
const SERVE_URL   = `http://localhost:${SERVER_PORT}`;

// ── IPC handlers ──────────────────────────────────────────────────────────
ipcMain.handle('open-file-dialog', async () => {
  const logsDir = process.env.UCPD_USER_DATA
    ? path.join(process.env.UCPD_USER_DATA, 'logs')
    : path.join(__dirname, '../logs');
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '.cpd Open — ログフォルダ',
    defaultPath: logsDir,
    filters: [{ name: 'CPD Files', extensions: ['cpd'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return canceled ? [] : filePaths;
});

// open-file-dialog-free: no defaultPath — OS/dialog uses last visited location.
ipcMain.handle('open-file-dialog-free', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '.cpd Import — 前回フォルダから選択',
    filters: [{ name: 'CPD Files', extensions: ['cpd'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return canceled ? [] : filePaths;
});

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
      preload: path.join(__dirname, 'preload.js'),
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
  // Expose writable user-data path to the embedded server (safe in packaged app)
  process.env.UCPD_USER_DATA = app.getPath('userData');
  await startServer(SERVER_PORT);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Auto-updater (production only) ────────────────────────────────────────
if (app.isPackaged) {
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    const win = BrowserWindow.getAllWindows()[0];
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'アップデートが利用可能',
      message: `v${info.version} が利用可能です。今すぐダウンロードしますか？`,
      buttons: ['ダウンロード', 'スキップ'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on('update-downloaded', () => {
    const win = BrowserWindow.getAllWindows()[0];
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'インストール準備完了',
      message: 'アップデートをインストールして再起動しますか？',
      buttons: ['今すぐ再起動', '後で'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err?.message ?? err);
  });

  app.whenReady().then(() => {
    // Delay the first check to avoid racing with window creation
    setTimeout(() => autoUpdater.checkForUpdates(), 5000);
  });
}
