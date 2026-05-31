// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useCallback, useState, useRef, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useCpdImport } from './hooks/useCpdImport';
import { useAppStore }  from './store/appStore';
const useSerialConnected = () => useAppStore((s) => s.serialStatus.connected);
import TopologyView     from './components/TopologyView';
import MessageTable     from './components/MessageTable';
import Console          from './components/Console';
import SerialBar        from './components/SerialBar';
import MeasurePanel     from './components/MeasurePanel';
import styles           from './App.module.css';

function StatusBadge() {
  const status = useAppStore((s) => s.wsStatus);
  const colorMap = {
    connected:    '#4caf50',
    connecting:   '#ff9800',
    disconnected: '#f44336',
    error:        '#e91e63',
  };
  const labelMap = {
    connected:    'App: Active',
    connecting:   'App: Connecting…',
    disconnected: 'App: Disconnected',
    error:        'App: Error',
  };
  return (
    <span style={{ color: colorMap[status] ?? '#aaa', fontSize: 12 }}>
      ● {labelMap[status] ?? status}
    </span>
  );
}

function ImportBadge() {
  const { loading, done, total, warnings } = useAppStore((s) => s.importStatus);
  if (loading) {
    return <span className={styles.importBadge}>⏳ Loading…</span>;
  }
  if (done > 0) {
    return (
      <span className={styles.importBadge}>
        ✓ {done} file{done > 1 ? 's' : ''}
        {warnings > 0 && <span className={styles.importWarn}> ⚠ {warnings}</span>}
      </span>
    );
  }
  return null;
}

/**
 * MemoDialog — inline modal for entering a one-line user memo.
 * Submits via the sendMessage WebSocket call.
 */
function MemoDialog({ onClose, sendMessage }) {
  const memoHistory  = useAppStore((s) => s.memoHistory);
  const addMemoHistory = useAppStore((s) => s.addMemoHistory);
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addMemoHistory(trimmed);
    sendMessage({ type: 'WRITE_USER_NOTE', text: trimmed });
    onClose();
  }, [text, sendMessage, onClose, addMemoHistory]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter')  handleSubmit();
    if (e.key === 'Escape') onClose();
  }, [handleSubmit, onClose]);

  return (
    <div className={styles.memoOverlay} onClick={onClose}>
      <div className={styles.memoDialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.memoTitle}>Add Memo</div>
        <input
          ref={inputRef}
          className={styles.memoInput}
          type="text"
          maxLength={80}
          list="memo-history-list"
          placeholder="e.g. Apple 61W + Google Pixel 7 @ 9V"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {memoHistory.length > 0 && (
          <datalist id="memo-history-list">
            {memoHistory.map((h, i) => <option key={i} value={h} />)}
          </datalist>
        )}
        {memoHistory.length > 0 && (
          <div className={styles.memoHistoryList}>
            {memoHistory.map((h, i) => (
              <button
                key={i}
                className={styles.memoHistoryItem}
                onClick={() => { setText(h); inputRef.current?.focus(); }}
                title={h}
              >
                {h}
              </button>
            ))}
          </div>
        )}
        <div className={styles.memoActions}>
          <button className={styles.memoCancel} onClick={onClose}>Cancel</button>
          <button className={styles.memoOk} onClick={handleSubmit} disabled={!text.trim()}>OK</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { sendPing, sendMessage }       = useWebSocket();
  const { openLogsFilePicker, openImportFilePicker, importFiles } = useCpdImport();
  const serialConnected                 = useSerialConnected();
  const replayNote                      = useAppStore((s) => s.replayNote);
  const [dragging, setDragging]     = useState(false);
  const [showTopology, setShowTopology] = useState(true);
  const [showConsole,  setShowConsole]  = useState(false);
  const [showMemo,     setShowMemo]     = useState(false);
  const [showMeasure,  setShowMeasure]  = useState(false);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    // Only clear when leaving the root element entirely
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith('.cpd') || f.type === 'application/octet-stream' || f.type === ''
    );
    if (files.length) importFiles(files);
  }, [importFiles]);

  return (
    <div
      className={styles.app}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Drag-and-drop overlay */}
      {dragging && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayInner}>
            <span className={styles.dropIcon}>📂</span>
            <span>Drop .cpd files here</span>
          </div>
        </div>
      )}

      {/* Title bar — also hosts serial port controls */}
      <header className={styles.titleBar}>
        <span className={styles.title}>
          UCPD-Monitor
          <span className={styles.titleVersion}>v{import.meta.env.VITE_APP_VERSION}</span>
          {replayNote && (
            <span className={styles.titleNoteIndicator} title={replayNote} aria-label={replayNote}>
              &#x1F4DD; {replayNote}
            </span>
          )}
        </span>
        <StatusBadge />
        <ImportBadge />
        <button
          onClick={openLogsFilePicker}
          className={styles.importBtn}
          disabled={serialConnected}
          title={serialConnected ? 'Disconnect DISCO before importing a .cpd file' : 'Open from logs folder'}
        >.cpd Open</button>
        <button
          onClick={openImportFilePicker}
          className={styles.importBtn}
          disabled={serialConnected}
          title={serialConnected ? 'Disconnect DISCO before importing a .cpd file' : 'Import from last used folder'}
        >.cpd Import</button>
        <button onClick={sendPing} className={styles.pingBtn} style={{ display: 'none' }}>Ping</button>
        <button
          className={styles.memoBtn}
          onClick={() => setShowMemo(true)}
          title="Add a one-line memo to the current .cpd log"
        >📝 Memo</button>
        <button
          className={`${styles.panelToggleBtn} ${showTopology ? styles.panelToggleActive : ''}`}
          onClick={() => setShowTopology((v) => !v)}
          title="Toggle Connection View panel"
        >Connection View</button>
        <button
          className={`${styles.panelToggleBtn} ${showConsole ? styles.panelToggleActive : ''}`}
          onClick={() => setShowConsole((v) => !v)}
          title="Toggle Console panel"
        >Console</button>
        <button
          className={`${styles.panelToggleBtn} ${showMeasure ? styles.panelToggleActive : ''}`}
          onClick={() => setShowMeasure((v) => !v)}
          title="Toggle ADC Measurement Stream panel"
        >ADC Stream</button>
        <SerialBar sendMessage={sendMessage} />
      </header>

      {/* Memo dialog */}
      {showMemo && <MemoDialog onClose={() => setShowMemo(false)} sendMessage={sendMessage} />}

      {/* Connection View strip */}
      {showTopology && <TopologyView />}

      {/* Main area: message table */}
      <div className={styles.main}>
        <MessageTable />
      </div>

      {/* Console */}
      {showConsole && (
        <div className={styles.consoleArea}>
          <Console />
        </div>
      )}

      {/* ADC Measurement Stream panel */}
      {showMeasure && <MeasurePanel sendMessage={sendMessage} />}
    </div>
  );
}

