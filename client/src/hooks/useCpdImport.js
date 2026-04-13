import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';

// Relative path — works in both Vite dev (proxied) and production (same origin).
const IMPORT_URL = '/api/import-cpd';

/**
 * Hook for importing .cpd binary log files.
 *
 * Features:
 *   - Single or multiple files via file picker dialog
 *   - Drag-and-drop (pass FileList / File[] to importFiles)
 *   - All files are parsed concurrently, then merged and sorted by timestamp
 *   - Progress state is reported through appStore.importStatus
 */
export function useCpdImport() {
  const { appendLog, setImportStatus } = useAppStore();

  /**
   * Upload one or more .cpd files to the server for processing.
   * The server feeds the raw bytes through CpdStreamParser, rebuilds the ring
   * buffer and broadcasts HISTORY — the existing WS handler populates the UI.
   *
   * Multiple files are concatenated in order before upload.
   *
   * @param {File[] | FileList} files
   */
  const importFiles = useCallback(
    async (files) => {
      const fileList = Array.from(files).filter(Boolean);
      if (fileList.length === 0) return;

      const names = fileList.map((f) => f.name).join(', ');
      appendLog(`[Import] Uploading ${fileList.length} file(s): ${names}`);
      setImportStatus({ loading: true, filename: names, done: 0, total: fileList.length, warnings: 0 });

      try {
        // Read all files and concatenate their ArrayBuffers
        const buffers = await Promise.all(fileList.map((f) => f.arrayBuffer()));
        const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const b of buffers) {
          merged.set(new Uint8Array(b), offset);
          offset += b.byteLength;
        }

        const res = await fetch(IMPORT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': names,
          },
          body: merged,
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const { records } = await res.json();

        setImportStatus({ loading: false, done: fileList.length, warnings: 0 });
        appendLog(`[Import] Done — ${records} record(s) from ${fileList.length} file(s)`);
      } catch (err) {
        appendLog(`[Import] Error: ${err.message}`);
        setImportStatus({ loading: false });
      }
    },
    [appendLog, setImportStatus]
  );

  /**
   * Open a native file-picker dialog (single or multiple .cpd files).
   * Appends the input to the document body to ensure Electron opens the dialog.
   */
  const openFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cpd,application/octet-stream';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = (e) => {
      if (e.target.files?.length) importFiles(e.target.files);
      document.body.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
  }, [importFiles]);

  return { openFilePicker, importFiles };
}

