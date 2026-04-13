import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { parseCpdFile, isUndecodedMessage, buildUnknownRecord } from '../parsers/pd_parser';

const SERVER_PORT = import.meta.env.VITE_SERVER_PORT ?? '3001';
const LOG_URL = `http://${window.location.hostname}:${SERVER_PORT}/api/log-unknown`;

/** Batch-POST unknown records to the server log (fire-and-forget). */
function logUnknownBatch(records) {
  if (!records.length) return;
  fetch(LOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  }).catch(() => { /* non-critical */ });
}

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
  const { setMessages, appendLog, setImportStatus, replayFrames } = useAppStore();

  /**
   * Parse a single File and return { frames, errors, filename }.
   */
  const parseOne = useCallback(async (file) => {
    const buffer = await file.arrayBuffer();
    const { frames, errors } = parseCpdFile(buffer);
    return { frames, errors, filename: file.name };
  }, []);

  /**
   * Import one or more File objects.
   * Files are parsed in parallel, then all frames are merged and sorted by ts.
   *
   * @param {File[] | FileList} files
   */
  const importFiles = useCallback(
    async (files) => {
      const fileList = Array.from(files).filter(Boolean);
      if (fileList.length === 0) return;

      const names = fileList.map((f) => f.name).join(', ');
      appendLog(`[Import] Loading ${fileList.length} file(s): ${names}`);
      setImportStatus({ loading: true, filename: names, done: 0, total: fileList.length, warnings: 0 });

      try {
        // Parse all files concurrently
        const results = await Promise.all(fileList.map(parseOne));

        let allFrames = [];
        let totalWarnings = 0;

        results.forEach(({ frames, errors, filename }) => {
          errors.forEach((e) => appendLog(`[Import][${filename}] Warning: ${e}`));
          totalWarnings += errors.length;
          allFrames = allFrames.concat(frames);
          appendLog(`[Import][${filename}] ${frames.length} frames` +
            (errors.length ? `, ${errors.length} warnings` : ''));
        });

        // Collect and log undecoded frames from all imported files
        const unknownRecords = [];
        results.forEach(({ frames, filename }) => {
          frames.forEach((frame) => {
            if (frame.recordType === 'PD_MSG' && isUndecodedMessage(frame.header)) {
              unknownRecords.push(buildUnknownRecord(frame, `file:${filename}`));
            }
          });
        });
        if (unknownRecords.length) {
          logUnknownBatch(unknownRecords);
          appendLog(`[Import] ${unknownRecords.length} undecoded packet(s) logged to server.`);
        }

        if (allFrames.length === 0) {
          appendLog('[Import] No valid frames found in any file.');
          setImportStatus({ loading: false });
          return;
        }

        // Sort all frames by firmware timestamp (ascending)
        allFrames.sort((a, b) => a.ts - b.ts);

        setMessages(allFrames);
        replayFrames(allFrames);
        setImportStatus({ loading: false, done: fileList.length, warnings: totalWarnings });
        appendLog(
          `[Import] Done — ${allFrames.length} frames total from ${fileList.length} file(s)` +
          (totalWarnings ? `, ${totalWarnings} warnings` : '')
        );
      } catch (err) {
        appendLog(`[Import] Error: ${err.message}`);
        setImportStatus({ loading: false });
      }
    },
    [parseOne, setMessages, appendLog, setImportStatus, replayFrames]
  );

  /**
   * Open a native file-picker dialog (single or multiple .cpd files).
   */
  const openFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cpd,application/octet-stream';
    input.multiple = true;
    input.onchange = (e) => {
      if (e.target.files?.length) importFiles(e.target.files);
    };
    input.click();
  }, [importFiles]);

  return { openFilePicker, importFiles };
}

