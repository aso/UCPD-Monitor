// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import styles from './SerialBar.module.css';
import appStyles from '../App.module.css';

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

  const [selPort, setSelPort] = useState('');
  // Track the last seen port-list fingerprint so auto-select fires only on changes.
  const prevPortsKeyRef = useRef('');
  // Track the previous port list (ordered) to compute removal position.
  const prevPortsRef = useRef([]);

  // Sync the selector with the active port; auto-select only when the port list changes.
  useEffect(() => {
    if (serialStatus.connected) {
      // Always reflect the actually-connected port — survives browser reload
      if (serialStatus.port) setSelPort(serialStatus.port);
      return;
    }

    // Build a stable fingerprint of the current port paths (order-independent).
    const key = ports.map((p) => p.path).sort().join(',');
    const listChanged = key !== prevPortsKeyRef.current;
    const prevPorts = prevPortsRef.current;
    prevPortsKeyRef.current = key;
    prevPortsRef.current = ports;

    // Auto-select only when the enumerated list has actually changed.
    if (!listChanged) return;

    setSelPort((prev) => {
      // ── Case 1: selected port still present → keep it ──────────────────
      if (prev && ports.some((p) => p.path === prev)) return prev;

      // ── Case 2: selected port was removed (or nothing was selected) ─────
      const knownPorts = ports.filter((p) => knownLabel(p));

      // Sub-case 2a: no known devices at all → empty (shows "No devices" placeholder)
      if (knownPorts.length === 0) return '';

      // Sub-case 2b: exactly one known device → auto-select it
      if (knownPorts.length === 1) return knownPorts[0].path;

      // Sub-case 2c: multiple known devices — downward-roll search from the
      // position the removed port occupied in the *previous* ordered list.
      if (prev) {
        const removedIdx = prevPorts.findIndex((p) => p.path === prev);
        if (removedIdx !== -1) {
          // Search from removedIdx onward (downward) in the new list
          for (let i = removedIdx; i < ports.length; i++) {
            if (knownLabel(ports[i])) return ports[i].path;
          }
          // Not found downward → wrap and search from the top
          for (let i = 0; i < removedIdx && i < ports.length; i++) {
            if (knownLabel(ports[i])) return ports[i].path;
          }
        }
      }

      // Sub-case 2d: fallback — first known device
      return knownPorts[0].path;
    });
  }, [ports, serialStatus.connected, serialStatus.port]);

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
    <>
      <span className={appStyles.separator} />
      {/* Port selector */}
      <select
        className={styles.select}
        value={selPort}
        onChange={(e) => setSelPort(e.target.value)}
        disabled={isConnected}
        title="Serial port"
      >
        {ports.length === 0
          ? <option value="">— no devices —</option>
          : [
              // Show a blank placeholder entry when nothing is auto-selected
              // (multiple known devices, no unambiguous choice).
              ...(selPort === '' ? [<option key="__none__" value="" disabled>— select port —</option>] : []),
              ...ports.map((p) => {
                const label = knownLabel(p);
                return (
                <option key={p.path} value={p.path}>
                  {p.path}{label ? `  ★ ${label}` : p.manufacturer ? `  (${p.manufacturer})` : ''}
                </option>
              );
            }),
            ]
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
    </>
  );
}
