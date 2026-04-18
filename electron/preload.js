// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a minimal API to the renderer (React app) via window.electronAPI.
 * Only whitelisted channels are accessible — no raw ipcRenderer is exposed.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Open a native file-picker dialog with the default directory set to the
   * UCPD-Monitor logs folder (%APPDATA%\UCPD-Monitor\logs).
   *
   * @returns {Promise<string[]>} Array of absolute file paths (empty if cancelled).
   */
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  /**
   * Open a native file-picker dialog without forcing a default directory.
   * The OS/dialog will use the last visited location.
   *
   * @returns {Promise<string[]>} Array of absolute file paths (empty if cancelled).
   */
  openFileDialogFree: () => ipcRenderer.invoke('open-file-dialog-free'),
});
