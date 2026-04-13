import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import styles from './SerialBar.module.css';

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]; // eslint-disable-line no-unused-vars
// Note: baud rate is meaningless for USB-CDC devices; kept only for non-CDC fallback.
// The firmware uses the CDC SET_LINE_CODING baud rate as a magic number to switch
// into CPD streaming mode.  921600 triggers the stream; other values do not.
const USB_CDC_BAUD = 921600;

/**
 * Known USB devices: key = "VID:PID" (uppercase), value = friendly label.
 * Used for auto-selection priority and display badge.
 */
const KNOWN_DEVICES = {
  '0483:374B': 'STM32G071B-DISCO (STLINK-V3)',
  '0483:374E': 'STLINK-V3E',
  '0483:374F': 'STLINK-V3MODS',
  '0483:3748': 'STLINK-V2-1',
};

/** Return the friendly label for a port entry, or null. */
function knownLabel(port) {
  const vid = (port.vendorId  ?? '').toUpperCase();
  const pid = (port.productId ?? '').toUpperCase();
  return KNOWN_DEVICES[`${vid}:${pid}`] ?? null;
}

/**
 * SerialBar — toolbar widget for serial port selection and connection.
 * Port list is pushed from the server via WebSocket (PORT_LIST messages).
 * Sends SERIAL_CONNECT / SERIAL_DISCONNECT / GET_PORT_LIST commands via WS.
 * Never auto-connects — user must press Connect explicitly.
 */
export default function SerialBar({ sendMessage }) {
  const serialStatus = useAppStore((s) => s.serialStatus);
  const ports        = useAppStore((s) => s.serialPorts);
  const hexDump      = useAppStore((s) => s.hexDump);
  const setHexDump   = useAppStore((s) => s.setHexDump);

  const [selPort, setSelPort] = useState('');

  // Auto-select when port list changes: prefer known STM32 board over others.
  // Never override a manually chosen port or the currently active port.
  useEffect(() => {
    if (serialStatus.connected) return; // don't disturb active connection
    setSelPort((prev) => {
      // Keep current selection if it still exists in the new list
      if (prev && ports.some((p) => p.path === prev)) return prev;
      // Otherwise pick best candidate
      const priority = ports.find((p) => knownLabel(p));
      return (priority ?? ports[0])?.path ?? '';
    });
  }, [ports, serialStatus.connected]);

  const handleRefresh = useCallback(() => {
    sendMessage({ type: 'GET_PORT_LIST' });
  }, [sendMessage]);

  const handleConnect = useCallback(() => {
    if (!selPort) return;
    sendMessage({ type: 'SERIAL_CONNECT', port: selPort, baudRate: USB_CDC_BAUD });
  }, [sendMessage, selPort]);

  const handleDisconnect = useCallback(() => {
    sendMessage({ type: 'SERIAL_DISCONNECT' });
  }, [sendMessage]);

  const isConnected = serialStatus.connected;

  return (
    <div className={styles.bar}>
      {/* Port selector */}
      <select
        className={styles.select}
        value={selPort}
        onChange={(e) => setSelPort(e.target.value)}
        disabled={isConnected}
        title="Serial port"
      >
        {ports.length === 0
          ? <option value="">— no ports —</option>
          : ports.map((p) => {
              const label = knownLabel(p);
              return (
                <option key={p.path} value={p.path}>
                  {p.path}{label ? `  ★ ${label}` : p.manufacturer ? `  (${p.manufacturer})` : ''}
                </option>
              );
            })
        }
      </select>

      {/* Device badge for the selected port */}
      {(() => {
        if (isConnected) return null;
        const sel = ports.find((p) => p.path === selPort);
        const label = sel ? knownLabel(sel) : null;
        return label
          ? <span className={styles.deviceBadge} title={`VID:${sel.vendorId}  PID:${sel.productId}`}>★ {label}</span>
          : null;
      })()}

      {/* Refresh button */}
      <button
        className={styles.refreshBtn}
        onClick={handleRefresh}
        disabled={isConnected}
        title="Refresh port list"
      >⟳</button>

      {/* Connect / Disconnect */}
      {isConnected ? (
        <button className={styles.disconnectBtn} onClick={handleDisconnect}>
          Disconnect
        </button>
      ) : (
        <button
          className={styles.connectBtn}
          onClick={handleConnect}
          disabled={!selPort}
        >
          Connect
        </button>
      )}

      {/* Status indicator */}
      <span className={isConnected ? styles.statusOn : styles.statusOff}>
        {isConnected
          ? `● ${serialStatus.port}`
          : serialStatus.error
            ? `✕ ${serialStatus.error}`
            : '○ not connected'}
      </span>

      {/* Hex dump toggle — only useful when connected */}
      <button
        className={hexDump ? styles.hexDumpBtnOn : styles.hexDumpBtn}
        onClick={() => setHexDump(!hexDump)}
        title={hexDump ? 'Hex dump ON — click to disable' : 'Hex dump OFF — click to enable (logs raw CPD bytes to Console)'}
      >
        HEX
      </button>
    </div>
  );
}
