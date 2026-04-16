// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useCallback, useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useCpdImport } from './hooks/useCpdImport';
import { useAppStore }  from './store/appStore';
const useSerialConnected = () => useAppStore((s) => s.serialStatus.connected);
import TopologyView     from './components/TopologyView';
import MessageTable     from './components/MessageTable';
import Console          from './components/Console';
import SerialBar        from './components/SerialBar';
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

export default function App() {
  const { sendPing, sendMessage }       = useWebSocket();
  const { openFilePicker, importFiles } = useCpdImport();
  const serialConnected                 = useSerialConnected();
  const [dragging, setDragging]     = useState(false);
  const [showTopology, setShowTopology] = useState(true);
  const [showConsole,  setShowConsole]  = useState(false);

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
        </span>
        <StatusBadge />
        <ImportBadge />
        <button
          onClick={openFilePicker}
          className={styles.importBtn}
          disabled={serialConnected}
          title={serialConnected ? 'Disconnect DISCO before importing a .cpd file' : undefined}
        >.cpd Import</button>
        <button onClick={sendPing} className={styles.pingBtn} style={{ display: 'none' }}>Ping</button>
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
        <SerialBar sendMessage={sendMessage} />
      </header>

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
    </div>
  );
}

